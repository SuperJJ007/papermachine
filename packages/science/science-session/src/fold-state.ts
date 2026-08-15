/** Internal mutable state for strict Science replay. */

import type {
  ScienceChartVersion,
  ScienceEnvironmentBinding,
  ScienceModeRef,
  ScienceOutcomePublication,
  ScienceRun,
} from './types.ts'

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

/** Event-envelope facts retained for one immutable chart version. */
export interface IndexedChartFact extends IndexedSessionFact {
  readonly chartId: string
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
  charts: ScienceChartVersion[]
  outcomes: ScienceOutcomePublication[]
  requestHeaders: IndexedSessionFact[]
  toolCalls: IndexedToolCall[]
  settledToolCallSeqs: number[]
  consumedToolCallSeqs: number[]
  messageFacts: IndexedSessionFact[]
  runFacts: IndexedRunFact[]
  chartFacts: IndexedChartFact[]
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
    charts: [],
    outcomes: [],
    requestHeaders: [],
    toolCalls: [],
    settledToolCallSeqs: [],
    consumedToolCallSeqs: [],
    messageFacts: [],
    runFacts: [],
    chartFacts: [],
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
    charts: [...state.charts],
    outcomes: [...state.outcomes],
    requestHeaders: [...state.requestHeaders],
    toolCalls: [...state.toolCalls],
    settledToolCallSeqs: [...state.settledToolCallSeqs],
    consumedToolCallSeqs: [...state.consumedToolCallSeqs],
    messageFacts: [...state.messageFacts],
    runFacts: [...state.runFacts],
    chartFacts: [...state.chartFacts],
    lastScienceTime: state.lastScienceTime,
    lastScienceEventSeq: state.lastScienceEventSeq,
  }
}
