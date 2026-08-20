/** Internal mutable state for strict Science replay. */

import type {
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceKernel,
  ScienceModeRef,
  ScienceOutcomePublication,
  ScienceRun,
} from './types.ts'

/**
 * Whether two Science runs belong to the same durable tool-call turn.
 * @param state - strict replay state containing the runs' authorized calls.
 * @param left - one run whose authorizing tool call is indexed in `state`.
 * @param right - another run whose authorizing tool call is indexed in `state`.
 * @returns whether both runs were issued in the same conversation turn.
 * @throws when either run lacks exactly one indexed authorizing call.
 */
export function scienceRunsShareTurn(
  state: ScienceFoldState,
  left: Pick<ScienceRun, 'toolCallId'>,
  right: Pick<ScienceRun, 'toolCallId'>,
): boolean {
  const turnFor = (run: Pick<ScienceRun, 'toolCallId'>): number => {
    const calls = state.toolCalls.filter(call => call.callId === run.toolCallId)
    if (calls.length !== 1) {
      throw new Error(`Science run toolCallId ${JSON.stringify(run.toolCallId)} does not identify one indexed tool/call`)
    }
    const [call] = calls
    /* v8 ignore next -- a length-one local array always has its first element. */
    if (call === undefined) {
      throw new Error(`Science run toolCallId ${JSON.stringify(run.toolCallId)} does not identify one indexed tool/call`)
    }
    return call.turn
  }
  return turnFor(left) === turnFor(right)
}

/** Indexed tool call needed to prove one Science authorization. */
export interface IndexedToolCall {
  readonly seq: number
  readonly time: number
  readonly callId: string
  readonly turn: number
  readonly step: number
  readonly name: string
}

/** Indexed Session fact needed by provenance validation. */
export interface IndexedSessionFact {
  readonly seq: number
  readonly time: number
}

/** Event-envelope facts retained for one Science run. */
export interface IndexedRunFact {
  readonly runId: string
  readonly startedSeq: number
  readonly startedEventTime: number
  readonly terminalSeq?: number
  readonly terminalEventTime?: number
}

/** Event-envelope facts retained for one immutable artifact version. */
export interface IndexedArtifactFact extends IndexedSessionFact {
  readonly artifactId: string
  readonly version: number
}

/** Mutable deterministic replay accumulator used by fold and invariant. */
export interface ScienceFoldState {
  nextSeq: number
  mode: ScienceModeRef | undefined
  modeBoundSeq: number | undefined
  preModeStepStarted: boolean
  environments: ScienceEnvironmentBinding[]
  runs: ScienceRun[]
  /**
   * One entry per kernel instance ever started, in start order. A `started`
   * fact appends an open entry; the matching `exited` fact (or an end-seed
   * `interrupted` derivation) replaces it in place — never a second entry
   * for the same `(language, kernelEpoch)`.
   */
  kernels: ScienceKernel[]
  /** Highest `kernelEpoch` ever admitted by a `started` fact, across both languages; 0 before the first kernel. */
  kernelEpochWatermark: number
  artifacts: ScienceArtifactVersion[]
  outcomes: ScienceOutcomePublication[]
  requestHeaders: IndexedSessionFact[]
  toolCalls: IndexedToolCall[]
  settledToolCallSeqs: number[]
  consumedToolCallSeqs: number[]
  messageFacts: IndexedSessionFact[]
  runFacts: IndexedRunFact[]
  artifactFacts: IndexedArtifactFact[]
  lastScienceTime: number | undefined
  lastScienceEventSeq: number | undefined
}

/**
 * Build an empty strict Science replay accumulator.
 * @returns mutable state positioned before event zero.
 */
export function emptyScienceFoldState(): ScienceFoldState {
  return {
    nextSeq: 0,
    mode: undefined,
    modeBoundSeq: undefined,
    preModeStepStarted: false,
    environments: [],
    runs: [],
    kernels: [],
    kernelEpochWatermark: 0,
    artifacts: [],
    outcomes: [],
    requestHeaders: [],
    toolCalls: [],
    settledToolCallSeqs: [],
    consumedToolCallSeqs: [],
    messageFacts: [],
    runFacts: [],
    artifactFacts: [],
    lastScienceTime: undefined,
    lastScienceEventSeq: undefined,
  }
}

/**
 * Clone one strict replay accumulator before validation or publication.
 * @param state - accepted accumulator to detach.
 * @returns an independently mutable accumulator.
 */
export function cloneScienceFoldState(state: ScienceFoldState): ScienceFoldState {
  return {
    nextSeq: state.nextSeq,
    mode: state.mode,
    modeBoundSeq: state.modeBoundSeq,
    preModeStepStarted: state.preModeStepStarted,
    environments: [...state.environments],
    runs: [...state.runs],
    kernels: [...state.kernels],
    kernelEpochWatermark: state.kernelEpochWatermark,
    artifacts: [...state.artifacts],
    outcomes: [...state.outcomes],
    requestHeaders: [...state.requestHeaders],
    toolCalls: [...state.toolCalls],
    settledToolCallSeqs: [...state.settledToolCallSeqs],
    consumedToolCallSeqs: [...state.consumedToolCallSeqs],
    messageFacts: [...state.messageFacts],
    runFacts: [...state.runFacts],
    artifactFacts: [...state.artifactFacts],
    lastScienceTime: state.lastScienceTime,
    lastScienceEventSeq: state.lastScienceEventSeq,
  }
}
