/** Canonical sparse witness used to verify persisted Science checkpoints. */

import { isJsonValue } from '@deepseek-ai/dsh-session'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import { emptyScienceFoldState } from './fold-state.ts'
import type { ScienceFoldState } from './fold-state.ts'
import type { ScienceProjectionWitnessEvent } from './projection-private.ts'
import { applyScienceEvent } from './transition.ts'

function projectionWitnessEvent(
  event: Pick<SessionEvent, 'seq' | 'time' | 'type'>,
  data: unknown,
): ScienceProjectionWitnessEvent {
  if (!Number.isSafeInteger(event.seq) || event.seq < 0
    || !Number.isSafeInteger(event.time) || event.time < 0
    || !isJsonValue(data)) throw new Error('invalid projection witness event')
  return { seq: event.seq, time: event.time, type: event.type, data: data as JsonValue }
}

function validExecutionCoordinate(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function validCoreIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Redact one Session event to the facts consumed by strict Science replay.
 * @param event - committed event to inspect.
 * @returns its canonical witness form, or `undefined` when unsupported.
 */
export function scienceProjectionWitnessEvent(event: SessionEvent): ScienceProjectionWitnessEvent | undefined {
  switch (event.type) {
    case 'science/mode-bound':
    case 'science/environment-bound':
    case 'science/run-started':
    case 'science/run-finished':
    case 'science/chart-saved':
    case 'science/outcome-published':
      if (event.ignorable === true) throw new Error('Science projection witness cannot omit required-event semantics')
      return projectionWitnessEvent(event, event.data)
    case 'step/start':
    case 'request/header':
    case 'user/message':
    case 'assistant/message':
    case 'session/end-seed':
      return projectionWitnessEvent(event, {})
    case 'step/end':
      if (!validExecutionCoordinate(event.data.turn) || !validExecutionCoordinate(event.data.step)) {
        throw new Error('invalid step/end projection witness')
      }
      return projectionWitnessEvent(event, { turn: event.data.turn, step: event.data.step })
    case 'tool/call':
      if (!validExecutionCoordinate(event.data.turn)
        || !validExecutionCoordinate(event.data.step)
        || !validCoreIdentity(event.data.callId)
        || !validCoreIdentity(event.data.name)) throw new Error('invalid tool/call projection witness')
      return projectionWitnessEvent(event, {
        turn: event.data.turn,
        step: event.data.step,
        callId: event.data.callId,
        name: event.data.name,
      })
    case 'tool/result':
      if (!validCoreIdentity(event.data.message.source.callId)) {
        throw new Error('invalid tool/result projection witness')
      }
      return projectionWitnessEvent(event, {
        message: { source: { callId: event.data.message.source.callId } },
      })
    default:
      return undefined
  }
}

/**
 * Test whether a pre-mode event permanently prevents mode binding.
 * @param event - canonical witness event.
 * @returns whether this event blocks a later binding.
 */
export function preventsScienceModeBinding(event: Pick<ScienceProjectionWitnessEvent, 'type'>): boolean {
  return event.type === 'step/start' || event.type === 'request/header' || event.type === 'tool/call'
}

/**
 * Test whether strict replay can need an event before mode is bound.
 * @param event - committed event to inspect.
 * @returns whether the pre-mode witness may retain it.
 */
export function scienceEventRelevantBeforeMode(event: SessionEvent): boolean {
  return event.type.startsWith('science/')
    || preventsScienceModeBinding(event)
    || event.type === 'user/message'
    || event.type === 'assistant/message'
    || event.type === 'tool/result'
}

/**
 * Test whether accepted pre-mode state makes Science binding impossible.
 * @param state - current strict accumulator.
 * @returns whether a permanent blocker has already been folded.
 */
export function scienceModeBindingBlocked(state: ScienceFoldState): boolean {
  return state.preModeStepStarted || state.requestHeaders.length > 0 || state.toolCalls.length > 0
}

/**
 * Test whether an event contributes facts needed by the public value or strict proof.
 * @param state - current strict accumulator.
 * @param event - next committed event.
 * @returns whether the sparse witness must retain the event.
 */
export function scienceProjectionEventRelevant(state: ScienceFoldState, event: SessionEvent): boolean {
  if (state.mode === undefined) {
    return !scienceModeBindingBlocked(state) && scienceEventRelevantBeforeMode(event)
  }
  if (event.type === 'step/start') return false
  if (event.type === 'step/end') {
    return state.toolCalls.some(call => call.turn === event.data.turn
      && call.step === event.data.step
      && !state.settledToolCallSeqs.includes(call.seq))
  }
  if (event.type === 'session/end-seed') return state.runs.some(run => run.status === 'running')
  return event.type.startsWith('science/')
    || event.type === 'request/header'
    || event.type === 'user/message'
    || event.type === 'assistant/message'
    || event.type === 'tool/call'
    || event.type === 'tool/result'
}

/**
 * Redact an event only when the current fold can still consume its facts.
 * @param state - current strict accumulator.
 * @param event - next committed event.
 * @returns the canonical retained event, or `undefined` when irrelevant.
 */
export function relevantScienceProjectionWitness(
  state: ScienceFoldState,
  event: SessionEvent,
): ScienceProjectionWitnessEvent | undefined {
  return scienceProjectionEventRelevant(state, event)
    ? scienceProjectionWitnessEvent(event)
    : undefined
}

/**
 * Strictly replay a canonical sparse witness into the shared fold authority.
 * @param witness - admitted canonical witness events in sequence order.
 * @returns the reconstructed strict accumulator.
 */
export function replayScienceProjectionWitness(
  witness: readonly ScienceProjectionWitnessEvent[],
): ScienceFoldState {
  const state = emptyScienceFoldState()
  let previousSeq = -1
  for (const [index, candidate] of witness.entries()) {
    if (candidate.seq <= previousSeq) throw new Error('projection witness seq must strictly increase')
    const event = candidate as SessionEvent
    if (!scienceProjectionEventRelevant(state, event)) {
      throw new Error('projection witness retains an irrelevant event')
    }
    if (state.mode === undefined && preventsScienceModeBinding(candidate) && index !== 0) {
      throw new Error('projection witness must collapse to its first mode blocker')
    }
    previousSeq = candidate.seq
    state.nextSeq = candidate.seq
    applyScienceEvent(state, event)
  }
  return state
}
