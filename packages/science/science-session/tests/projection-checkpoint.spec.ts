import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyScienceProjectionState,
  emptyScienceProjectionState,
  scienceProjectionChanged,
  scienceProjectionSchema,
  scienceProjectionStateSchema,
  scienceProjectionStateSeq,
  viewScienceProjectionState,
} from '../src/projection.ts'
import { replayScience, toClientScienceProjection } from '../src/index.ts'
import type {
  ScienceOutcomePublication,
  ScienceRunStarted,
  ScienceRunTerminal,
} from '../src/index.ts'
import type { ScienceProjectionState } from '../src/projection-private.ts'
import {
  OUTCOME_CALL_ID,
  event,
  legalEvents,
  outcome,
  runStarted,
  runTerminal,
} from './fixtures.ts'

function projectState(events: readonly SessionEvent[]): ScienceProjectionState {
  return events.reduce<ScienceProjectionState>(
    applyScienceProjectionState,
    emptyScienceProjectionState(),
  )
}

function startedEvent(
  overrides: Partial<ScienceRunStarted> = {},
  seq = 4,
  time = 140,
): SessionEvent {
  return event('science/run-started', seq, time, {
    version: 1,
    run: runStarted(overrides),
  })
}

function finishedEvent(
  overrides: Partial<ScienceRunTerminal> = {},
  seq = 5,
  time = 150,
): SessionEvent {
  return event('science/run-finished', seq, time, {
    version: 1,
    run: runTerminal(overrides),
  })
}

function outcomeEvent(
  overrides: Partial<ScienceOutcomePublication> = {},
  seq = 9,
  time = 180,
): SessionEvent {
  return event('science/outcome-published', seq, time, {
    version: 1,
    outcome: outcome(overrides),
  })
}

describe('Science private projection checkpoint', () => {
  it('retains only pre-mode facts that can constrain later Science replay', () => {
    const unrelated = event('turn/start', 0, 90, { turn: 1 })
    const empty = emptyScienceProjectionState()
    const observed = applyScienceProjectionState(empty, unrelated)
    expect(observed).toEqual({ ...empty, observedSeq: 0 })
    expect(observed.fold).toBe(empty.fold)
    expect(observed.witness).toBe(empty.witness)
    expect(scienceProjectionChanged(empty, observed)).toBe(false)

    for (const type of ['step/start', 'request/header', 'tool/call'] as const) {
      const data = type === 'tool/call'
        ? { turn: 1, step: 1, callId: CallId('pre-mode-call'), name: 'run_python', arguments: '{}' }
        : {}
      const blocked = projectState([event(type, 0, 90, data)])
      expect(blocked.witness).toHaveLength(1)
      expect(applyScienceProjectionState(blocked, legalEvents()[0]!)).toBe(blocked)
    }

    for (const type of ['user/message', 'assistant/message', 'tool/result'] as const) {
      const data = type === 'tool/result'
        ? { turn: 1, step: 1, message: { source: { callId: CallId('pre-mode-result') } } }
        : {}
      const retained = projectState([event(type, 0, 90, data)])
      expect(retained.witness).toHaveLength(1)
      expect(viewScienceProjectionState(retained)).toBeNull()
    }

    const preModeMessage = event('assistant/message', 0, 90, {})
    const modeBound = event('science/mode-bound', 1, 100, legalEvents()[0]!.data)
    const citedMessage = projectState([
      preModeMessage,
      modeBound,
      event('request/header', 2, 110, {}),
      event('tool/call', 3, 120, {
        turn: 1,
        step: 1,
        callId: OUTCOME_CALL_ID,
        name: 'publish_outcome',
        arguments: '{}',
      }),
      outcomeEvent({
        evidence: [{ kind: 'message', seq: 0 }],
        requestHeaderSeq: 2,
        environmentRevisions: [],
        publishedAt: 129,
      }, 4, 130),
    ])
    expect(scienceProjectionStateSchema.safeParse(citedMessage).success).toBe(true)
    expect(citedMessage.witness.map(candidate => candidate.seq)).toEqual([0, 1, 2, 3, 4])
    expect(viewScienceProjectionState(citedMessage)?.outcome?.evidence)
      .toEqual([{ kind: 'message', seq: 0 }])

    const collapsed = projectState([
      event('user/message', 0, 80, {}),
      event('assistant/message', 1, 90, {}),
      event('request/header', 2, 100, {}),
    ])
    expect(collapsed.witness).toEqual([{
      seq: 2,
      time: 100,
      type: 'request/header',
      data: {},
    }])
    expect(scienceProjectionStateSchema.safeParse(collapsed).success).toBe(true)
  })

  it('advances the private watermark without publishing an unchanged Science value', () => {
    const complete = projectState(legalEvents())
    const irrelevant = event('turn/start', 10, 190, { turn: 2 })
    const observed = applyScienceProjectionState(complete, irrelevant)

    expect(observed.observedSeq).toBe(10)
    expect(observed.fold).toBe(complete.fold)
    expect(observed.witness).toBe(complete.witness)
    expect(scienceProjectionStateSeq(observed)).toBe(10)
    expect(scienceProjectionChanged(complete, observed)).toBe(false)
    expect(viewScienceProjectionState(observed)).toEqual(toClientScienceProjection(replayScience([
      ...legalEvents(),
      irrelevant,
    ])))
    expect(scienceProjectionStateSchema.safeParse(observed).success).toBe(true)
  })

  it('rejects checkpoint witnesses that cannot replay to the public value', () => {
    const events = legalEvents()
    const call = (
      seq: number,
      time: number,
      callId: ReturnType<typeof CallId>,
      name: string,
      turn = 1,
      step = 1,
    ): SessionEvent => event('tool/call', seq, time, {
      turn,
      step,
      callId,
      name,
      arguments: '{}',
    })
    const result = (
      seq: number,
      time: number,
      callId: ReturnType<typeof CallId>,
    ): SessionEvent => event('tool/result', seq, time, {
      turn: 1,
      step: 1,
      message: { source: { callId } },
    })

    const terminalEvents = events.slice(0, 6)
    const emptyState = emptyScienceProjectionState()
    const headerOnlyState = projectState([event('request/header', 0, 90, {})])
    const modeState = projectState(events.slice(0, 1))
    const environmentState = projectState(events.slice(0, 2))
    const runningState = projectState(terminalEvents.slice(0, 5))
    const terminalState = projectState(terminalEvents)
    const interruptedState = projectState([
      ...terminalEvents.slice(0, 5),
      event('session/end-seed', 5, 150, {}),
    ])
    const chartedState = projectState(events.slice(0, 8))
    const completeState = projectState(events)
    const messageOnlyState = projectState([
      events[0]!,
      event('request/header', 1, 110, {}),
      event('assistant/message', 2, 120, {}),
      call(3, 125, OUTCOME_CALL_ID, 'publish_outcome'),
      outcomeEvent({
        evidence: [{ kind: 'message', seq: 2 }],
        requestHeaderSeq: 1,
        environmentRevisions: [],
        publishedAt: 129,
      }, 4, 130),
    ])
    const resultCallId = CallId('call-result')
    const toolMessageState = projectState([
      events[0]!,
      event('request/header', 1, 110, {}),
      call(2, 115, resultCallId, 'bash'),
      result(3, 120, resultCallId),
      call(4, 125, OUTCOME_CALL_ID, 'publish_outcome'),
      outcomeEvent({
        evidence: [{ kind: 'message', seq: 3 }],
        requestHeaderSeq: 1,
        environmentRevisions: [],
        publishedAt: 129,
      }, 5, 130),
    ])
    const supportState = projectState([
      events[0]!,
      event('step/start', 1, 105, { turn: 2, step: 1 }),
      event('user/message', 2, 110, {}),
      event('assistant/message', 3, 115, {}),
      event('request/header', 4, 120, {}),
      call(5, 125, resultCallId, 'bash', 2, 1),
      event('step/end', 6, 130, { turn: 2, step: 1 }),
      result(7, 135, resultCallId),
    ])
    const stepGuardState = projectState([
      events[0]!,
      event('request/header', 1, 110, {}),
      event('assistant/message', 2, 120, {}),
      call(3, 125, OUTCOME_CALL_ID, 'publish_outcome'),
      call(4, 126, resultCallId, 'bash', 2, 1),
      event('step/end', 5, 127, { turn: 2, step: 1 }),
      outcomeEvent({
        evidence: [{ kind: 'message', seq: 2 }],
        requestHeaderSeq: 1,
        environmentRevisions: [],
        publishedAt: 129,
      }, 6, 130),
    ])
    const gappedTerminalState = projectState([
      ...terminalEvents.slice(0, 4),
      event('turn/start', 4, 135, { turn: 1 }),
      startedEvent({}, 5, 140),
      finishedEvent({}, 6, 150),
    ])

    for (const [name, state] of [
      ['empty', emptyState],
      ['header only', headerOnlyState],
      ['mode', modeState],
      ['environment', environmentState],
      ['running', runningState],
      ['terminal', terminalState],
      ['interrupted', interruptedState],
      ['charted', chartedState],
      ['complete', completeState],
      ['message only', messageOnlyState],
      ['tool-result message', toolMessageState],
      ['support facts', supportState],
      ['unrelated step end', stepGuardState],
      ['gapped terminal', gappedTerminalState],
    ] satisfies Array<readonly [string, ScienceProjectionState]>) {
      expect(scienceProjectionStateSchema.safeParse(state).success, name).toBe(true)
    }

    const ignoredSeed = applyScienceProjectionState(
      completeState,
      event('session/end-seed', 10, 190, {}),
    )
    const unrelatedTurn = applyScienceProjectionState(
      completeState,
      event('turn/start', 10, 190, { turn: 2 }),
    )
    const duplicateMode = applyScienceProjectionState(
      completeState,
      event('science/mode-bound', 10, 190, events[0]!.data),
    )
    const ignorableMode = applyScienceProjectionState(completeState, {
      ...event('science/mode-bound', 10, 190, events[0]!.data),
      ignorable: true,
    })
    for (const observed of [ignoredSeed, unrelatedTurn, duplicateMode, ignorableMode]) {
      expect(observed).toEqual({ ...completeState, observedSeq: 10 })
      expect(scienceProjectionChanged(completeState, observed)).toBe(false)
    }

    const headerTampered: ScienceProjectionState = {
      ...terminalState,
      fold: {
        ...terminalState.fold,
        runs: [{ ...terminalState.fold.runs[0]!, requestHeaderSeq: 3 }],
      },
    }
    expect(scienceProjectionSchema.safeParse(viewScienceProjectionState(headerTampered)).success).toBe(true)
    expect(scienceProjectionStateSchema.safeParse(headerTampered).success).toBe(false)

    const replaceWitness = (
      state: ScienceProjectionState,
      type: string,
      change: (candidate: ScienceProjectionState['witness'][number]) =>
      ScienceProjectionState['witness'][number],
    ): ScienceProjectionState => ({
      ...state,
      witness: state.witness.map(candidate => candidate.type === type ? change(candidate) : candidate),
    })
    const callData = (
      candidate: ScienceProjectionState['witness'][number],
    ): { turn: number; step: number; callId: ReturnType<typeof CallId>; name: string } =>
      candidate.data as {
        turn: number
        step: number
        callId: ReturnType<typeof CallId>
        name: string
      }

    const invalidStates: Array<readonly [string, unknown]> = [
      ['undefined state', undefined],
      ['missing state keys', {}],
      ['extra state key', { ...completeState, unexpected: true }],
      ['missing observed seq', {
        fold: completeState.fold,
        witness: completeState.witness,
      }],
      ['negative observed seq', { ...completeState, observedSeq: -2 }],
      ['unsafe observed seq', { ...completeState, observedSeq: Number.MAX_SAFE_INTEGER + 1 }],
      ['observed seq behind witness', { ...completeState, observedSeq: 8 }],
      ['invalid fold', { ...completeState, fold: undefined }],
      ['well-formed but replay-inconsistent fold', {
        ...completeState,
        fold: { ...completeState.fold, lastScienceEventSeq: 1 },
      }],
      ['non-array witness', { ...completeState, witness: null }],
      ['malformed witness event', { ...completeState, witness: [null] }],
      ['missing witness event key', {
        ...completeState,
        witness: [{ seq: 0, time: 100, type: 'science/mode-bound' }],
      }],
      ['extra witness event key', {
        ...completeState,
        witness: completeState.witness.map((candidate, index) => index === 0
          ? { ...candidate, unexpected: true }
          : candidate),
      }],
      ['non-string witness type', {
        ...completeState,
        witness: completeState.witness.map((candidate, index) => index === 0
          ? { ...candidate, type: 1 }
          : candidate),
      }],
      ['required Science witness marked ignorable', {
        ...completeState,
        witness: completeState.witness.map((candidate, index) => index === 0
          ? { ...candidate, ignorable: true }
          : candidate),
      }],
      ['negative witness seq', {
        ...completeState,
        witness: completeState.witness.map((candidate, index) => index === 0
          ? { ...candidate, seq: -1 }
          : candidate),
      }],
      ['unsafe witness seq', {
        ...completeState,
        witness: completeState.witness.map((candidate, index) => index === 0
          ? { ...candidate, seq: Number.MAX_SAFE_INTEGER + 1 }
          : candidate),
      }],
      ['unsafe witness time', {
        ...completeState,
        witness: completeState.witness.map((candidate, index) => index === 0
          ? { ...candidate, time: Number.MAX_SAFE_INTEGER + 1 }
          : candidate),
      }],
      ['unknown witness type', {
        ...completeState,
        witness: completeState.witness.map((candidate, index) => index === 0
          ? { ...candidate, type: 'turn/start' }
          : candidate),
      }],
      ['non-canonical request data', replaceWitness(
        terminalState,
        'request/header',
        candidate => ({ ...candidate, data: { provider: 'secret' } }),
      )],
      ['non-canonical call data', replaceWitness(
        terminalState,
        'tool/call',
        candidate => ({ ...candidate, data: { ...callData(candidate), arguments: '{}' } }),
      )],
      ['non-canonical step-end data', replaceWitness(
        supportState,
        'step/end',
        candidate => ({ ...candidate, data: { turn: 2, step: 1, reason: 'done' } }),
      )],
      ['non-canonical tool-result data', replaceWitness(
        toolMessageState,
        'tool/result',
        candidate => ({
          ...candidate,
          data: { message: { source: { callId: resultCallId }, content: [] } },
        }),
      )],
      ['malformed step-end data', replaceWitness(
        supportState,
        'step/end',
        candidate => ({ ...candidate, data: { turn: '2', step: 1 } }),
      )],
      ['malformed tool-call data', replaceWitness(
        supportState,
        'tool/call',
        candidate => ({ ...candidate, data: { ...callData(candidate), name: 1 } }),
      )],
      ['malformed tool-result data', replaceWitness(
        supportState,
        'tool/result',
        candidate => ({ ...candidate, data: { message: { source: { callId: 1 } } } }),
      )],
      ['deleted authorizing call', {
        ...terminalState,
        witness: terminalState.witness.filter(candidate => candidate.type !== 'tool/call'),
      }],
      ['authorizing call id changed', replaceWitness(
        terminalState,
        'tool/call',
        candidate => ({
          ...candidate,
          data: { ...callData(candidate), callId: CallId('call-other') },
        }),
      )],
      ['authorizing call name changed', replaceWitness(
        terminalState,
        'tool/call',
        candidate => ({ ...candidate, data: { ...callData(candidate), name: 'bash' } }),
      )],
      ['authorizing call time changed', replaceWitness(
        terminalState,
        'tool/call',
        candidate => ({ ...candidate, time: 140 }),
      )],
      ['authorizing step ended', {
        ...gappedTerminalState,
        witness: [
          ...gappedTerminalState.witness.slice(0, 4),
          {
            seq: 4,
            time: 135,
            type: 'step/end',
            data: { turn: 1, step: 1 },
          },
          ...gappedTerminalState.witness.slice(4),
        ],
      }],
      ['step-end identity changed', replaceWitness(
        stepGuardState,
        'step/end',
        candidate => ({ ...candidate, data: { turn: 3, step: 1 } }),
      )],
      ['message event type changed', replaceWitness(
        messageOnlyState,
        'assistant/message',
        candidate => ({ ...candidate, type: 'request/header' }),
      )],
      ['message event time changed', replaceWitness(
        messageOnlyState,
        'assistant/message',
        candidate => ({ ...candidate, time: 130 }),
      )],
      ['witness order changed', {
        ...terminalState,
        witness: [
          terminalState.witness[1]!,
          terminalState.witness[0]!,
          ...terminalState.witness.slice(2),
        ],
      }],
      ['witness seq duplicated', {
        ...terminalState,
        witness: terminalState.witness.map((candidate, index) => index === 1
          ? { ...candidate, seq: terminalState.witness[0]!.seq }
          : candidate),
      }],
      ['mode blocker follows a retained pre-mode message', {
        ...headerOnlyState,
        observedSeq: 1,
        witness: [
          { seq: 0, time: 80, type: 'assistant/message', data: {} },
          { seq: 1, time: 90, type: 'request/header', data: {} },
        ],
      }],
      ['irrelevant seed boundary retained', {
        ...modeState,
        witness: [
          ...modeState.witness,
          { seq: 1, time: 110, type: 'session/end-seed', data: {} },
        ],
      }],
      ['fold differs from witness replay', {
        ...completeState,
        fold: {
          ...completeState.fold,
          outcomes: [{
            ...completeState.fold.outcomes[0]!,
            requestHeaderSeq: completeState.fold.outcomes[0]!.requestHeaderSeq + 1,
          }],
        },
      }],
    ]
    for (const [name, state] of invalidStates) {
      expect(scienceProjectionStateSchema.safeParse(state).success, name).toBe(false)
    }
  })
})
