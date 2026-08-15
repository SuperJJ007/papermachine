/** Incremental fail-soft Science projection cache transition. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { emptyScienceFoldState } from './fold-state.ts'
import { decodeScienceProjectionFold, encodeScienceProjectionFold } from './projection-fold-codec.ts'
import type { ScienceProjectionState } from './projection-private.ts'
import {
  preventsScienceModeBinding,
  relevantScienceProjectionWitness,
} from './projection-witness.ts'
import { applyScienceEvent } from './transition.ts'

/**
 * Build the empty private Science projection cache state.
 * @returns state positioned before event zero.
 */
export function emptyScienceProjectionState(): ScienceProjectionState {
  return { observedSeq: -1, fold: encodeScienceProjectionFold(emptyScienceFoldState()), witness: [] }
}

/**
 * Increment one persisted Science projection state without replaying prior facts.
 * Every event advances `observedSeq`; invalid events retain the prior fold and witness.
 * @param state - private state after all earlier committed events.
 * @param event - next committed Session event.
 * @returns private state that observes `event`.
 */
export function applyScienceProjectionState(
  state: ScienceProjectionState,
  event: SessionEvent,
): ScienceProjectionState {
  const observed: ScienceProjectionState = event.seq === state.observedSeq
    ? state
    : { ...state, observedSeq: event.seq }
  try {
    let fold = decodeScienceProjectionFold(state.fold)
    const redacted = relevantScienceProjectionWitness(fold, event)
    if (redacted === undefined) return observed
    let witness = state.witness
    if (fold.mode === undefined && preventsScienceModeBinding(redacted)) {
      fold = emptyScienceFoldState()
      witness = []
    }
    fold.nextSeq = event.seq
    applyScienceEvent(fold, redacted as SessionEvent)
    const next: ScienceProjectionState = {
      observedSeq: event.seq,
      fold: encodeScienceProjectionFold(fold),
      witness: [...witness, redacted],
    }
    return next
  } catch {
    return observed
  }
}
