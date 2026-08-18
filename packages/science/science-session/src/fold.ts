/** Public fail-loud replay API for durable Science Session events. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  decodeScienceArtifact,
  decodeScienceDomainEvent,
  decodeScienceEnvironment,
  decodeScienceMode,
  decodeScienceOutcome,
  decodeScienceRunStarted,
  decodeScienceRunTerminal,
} from './codec.ts'
import { emptyScienceFoldState } from './fold-state.ts'
import type { ScienceFoldState } from './fold-state.ts'
import { projectScienceFold } from './projection-value.ts'
import { applyScienceEvent } from './transition.ts'
import type { ScienceProjection } from './types.ts'

export {
  decodeScienceArtifact,
  decodeScienceDomainEvent,
  decodeScienceEnvironment,
  decodeScienceMode,
  decodeScienceOutcome,
  decodeScienceRunStarted,
  decodeScienceRunTerminal,
}

/**
 * Strictly replay a complete contiguous event log into internal state.
 * @param events - complete log or contiguous prefix starting at zero.
 * @returns the accepted strict replay accumulator.
 */
export function foldScience(events: readonly SessionEvent[]): ScienceFoldState {
  const state = emptyScienceFoldState()
  for (const event of events) applyScienceEvent(state, event)
  return state
}

/**
 * Strictly replay a complete contiguous event log into its public Science value.
 * @param events - complete event log or contiguous prefix starting at zero.
 * @returns the public projection, or `null` before Science mode is bound.
 */
export function replayScience(events: readonly SessionEvent[]): ScienceProjection | null {
  return projectScienceFold(foldScience(events))
}

// The package root re-exports these three for a caller that must advance
// the fold incrementally as new events append (a capture walk saving many
// versions in one pass, for example): `foldScience` once up front, then
// `applyScienceEvent` per newly appended event, then `projectScienceFold`
// on demand — the same three-step composition `replayScience` runs in one
// shot for a caller that already holds the complete log. `emptyScienceFoldState`
// stays internal: `foldScience` is the only sanctioned way to produce a
// starting accumulator, since it is also the only one that leaves
// `nextSeq` at zero.
export { applyScienceEvent } from './transition.ts'
export { projectScienceFold } from './projection-value.ts'
export type { ScienceFoldState } from './fold-state.ts'
