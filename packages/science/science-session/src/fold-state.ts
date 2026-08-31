/** Internal mutable state for strict Science replay. */

import type { CallId } from '@deepseek-ai/dsh-llm'
import type {
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceKernel,
  ScienceModeRef,
  ScienceOutcomePublication,
  ScienceRun,
} from './types.ts'

/** Indexed tool call needed to prove one Science authorization. */
export interface IndexedToolCall {
  readonly seq: number
  readonly time: number
  readonly callId: CallId
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
export function cloneScienceFoldState(
  state: { readonly [K in keyof ScienceFoldState]: Readonly<ScienceFoldState[K]> },
): ScienceFoldState {
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
