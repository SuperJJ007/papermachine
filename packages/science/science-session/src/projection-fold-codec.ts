/** Conversion between mutable strict replay state and its plain-JSON cache form. */

import { cloneScienceFoldState, type ScienceFoldState } from './fold-state.ts'
import type { ScienceProjectionFoldJson } from './projection-private.ts'

/**
 * Encode strict fold state without `undefined` fields.
 * @param state - accepted mutable replay state.
 * @returns the lossless plain-JSON fold fields.
 */
export function encodeScienceProjectionFold(state: ScienceFoldState): ScienceProjectionFoldJson {
  return {
    mode: state.mode ?? null,
    modeBoundSeq: state.modeBoundSeq ?? null,
    preModeStepStarted: state.preModeStepStarted,
    environments: state.environments,
    runs: state.runs,
    kernels: state.kernels,
    kernelEpochWatermark: state.kernelEpochWatermark,
    artifacts: state.artifacts,
    outcomes: state.outcomes,
    requestHeaders: state.requestHeaders,
    turns: state.turns,
    toolCalls: state.toolCalls,
    settledToolCallSeqs: state.settledToolCallSeqs,
    consumedToolCallSeqs: state.consumedToolCallSeqs,
    messageFacts: state.messageFacts,
    runFacts: state.runFacts.map(fact => ({
      runId: fact.runId,
      startedSeq: fact.startedSeq,
      startedEventTime: fact.startedEventTime,
      terminalSeq: fact.terminalSeq ?? null,
      terminalEventTime: fact.terminalEventTime ?? null,
    })),
    artifactFacts: state.artifactFacts,
    lastScienceTime: state.lastScienceTime ?? null,
    lastScienceEventSeq: state.lastScienceEventSeq ?? null,
  }
}

/**
 * Decode a validated JSON cache value into independently mutable fold state.
 * @param state - admitted plain-JSON fold fields.
 * @param nextSeq - sequence expected by the next strict transition.
 * @returns independently mutable strict replay state.
 */
export function decodeScienceProjectionFold(
  state: ScienceProjectionFoldJson,
  nextSeq = 0,
): ScienceFoldState {
  return cloneScienceFoldState({
    ...state,
    nextSeq,
    mode: state.mode ?? undefined,
    modeBoundSeq: state.modeBoundSeq ?? undefined,
    runFacts: state.runFacts.map(fact => ({
      runId: fact.runId,
      startedSeq: fact.startedSeq,
      startedEventTime: fact.startedEventTime,
      ...(fact.terminalSeq === null ? {} : { terminalSeq: fact.terminalSeq }),
      ...(fact.terminalEventTime === null ? {} : { terminalEventTime: fact.terminalEventTime }),
    })),
    lastScienceTime: state.lastScienceTime ?? undefined,
    lastScienceEventSeq: state.lastScienceEventSeq ?? undefined,
  })
}
