/** Science projection registration functions assembled from the strict fold. */

import { decodeScienceProjectionFold } from './projection-fold-codec.ts'
import type { ScienceProjectionState } from './projection-private.ts'
import { scienceProjectionSchema } from './projection-schema.ts'
import { projectScienceClientFold } from './projection-value.ts'
import type { ScienceClientProjection } from './types.ts'

export { scienceProjectionStateSchema, scienceProjectionStateSeq } from './projection-checkpoint.ts'
export { applyScienceProjectionState, emptyScienceProjectionState } from './projection-state.ts'
export { scienceProjectionSchema }
export type { ScienceProjectionState } from './projection-private.ts'

/**
 * Derive the public projection value from trusted live private state.
 * @param state - admitted or same-process private projection state.
 * @returns the client-safe Science value.
 */
export function viewScienceProjectionState(state: ScienceProjectionState): ScienceClientProjection | null {
  return projectScienceClientFold(decodeScienceProjectionFold(state.fold))
}

/**
 * Test whether an internal transition changed the public Science value.
 * @param previous - private state before one committed event.
 * @param next - private state after that event.
 * @returns whether change listeners should receive the public value.
 */
export function scienceProjectionChanged(
  previous: ScienceProjectionState,
  next: ScienceProjectionState,
): boolean {
  if (previous.fold.lastScienceEventSeq === null && next.fold.lastScienceEventSeq === null) return false
  if (previous.fold.lastScienceEventSeq !== next.fold.lastScienceEventSeq
    || previous.fold.toolCalls.length !== next.fold.toolCalls.length
    || previous.fold.turns.length !== next.fold.turns.length) return true
  const previousTurn = previous.fold.turns.at(-1)
  const nextTurn = next.fold.turns.at(-1)
  return previousTurn?.endSeq !== nextTurn?.endSeq || previousTurn?.endTime !== nextTurn?.endTime
}
