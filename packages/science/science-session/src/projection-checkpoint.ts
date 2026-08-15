/** Strict validation of private persisted Science projection state. */

import { isJsonValue } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { ZodType } from 'zod'
import { encodeScienceProjectionFold } from './projection-fold-codec.ts'
import type { ScienceProjectionState, ScienceProjectionWitnessEvent } from './projection-private.ts'
import { projectionExactKeys, projectionRecord, scienceProjectionSchema } from './projection-schema.ts'
import { projectScienceFold } from './projection-value.ts'
import { replayScienceProjectionWitness, scienceProjectionWitnessEvent } from './projection-witness.ts'

function validProjectionState(value: unknown): value is ScienceProjectionState {
  try {
    if (!isJsonValue(value)) return false
    const candidate = projectionRecord(value)
    if (candidate === undefined || !projectionExactKeys(candidate, ['observedSeq', 'fold', 'witness'])) return false
    const observedSeq = candidate['observedSeq']
    if (!Number.isSafeInteger(observedSeq) || (observedSeq as number) < -1) return false
    if (!Array.isArray(candidate['witness'])) return false
    const witness = candidate['witness'].map((raw): ScienceProjectionWitnessEvent => {
      const event = projectionRecord(raw)
      if (event === undefined || !projectionExactKeys(event, ['seq', 'time', 'type', 'data'])
        || typeof event['type'] !== 'string') throw new Error('malformed projection witness event')
      const normalized = scienceProjectionWitnessEvent(event as unknown as SessionEvent)
      if (normalized === undefined || !isDeepStrictEqual(normalized, event)) {
        throw new Error('non-canonical projection witness event')
      }
      return normalized
    })
    if ((witness.at(-1)?.seq ?? -1) > (observedSeq as number)) return false
    const replayed = replayScienceProjectionWitness(witness)
    if (!isDeepStrictEqual(encodeScienceProjectionFold(replayed), candidate['fold'])) return false
    return scienceProjectionSchema.safeParse(projectScienceFold(replayed)).success
  } catch {
    return false
  }
}

/** Validator for persisted internal Science projection checkpoints. */
export const scienceProjectionStateSchema: ZodType<ScienceProjectionState> = z.custom<ScienceProjectionState>(
  validProjectionState,
  { message: 'invalid Science projection checkpoint state' },
)

/**
 * Extract the committed-event watermark encoded by admitted private state.
 * @param state - checkpoint state already admitted by the Science schema.
 * @returns the last committed Session event observed by the projection.
 */
export function scienceProjectionStateSeq(state: ScienceProjectionState): number {
  return state.observedSeq
}
