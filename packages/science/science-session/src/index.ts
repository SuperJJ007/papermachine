/**
 * Science Session Domain: typed durable facts, strict replay validation, and
 * the optional `science` session projection. The project artifact store
 * (`@deepseek-ai/dsh-science-artifact-store`) is the sole authority for an
 * artifact version's provenance; `science/artifact-saved` carries only the
 * store reference and the title/caption presentation snapshot the model or
 * user saw when the event committed. This package
 * exposes no mutation service of its own and performs no environment
 * or process work; `@deepseek-ai/dsh-science-runtime` and
 * `@deepseek-ai/dsh-tool-science` own every durable append.
 *
 * @module @deepseek-ai/dsh-science-session
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only side-effect import: activates domain.ts's SessionEventMap merge
// for this file's own type-checking (the `export type *` re-export below
// does not have that effect).
import type {} from './domain.ts'
import { toClientScienceProjection } from './projection-value.ts'

// Type-only re-exports keep event and projection declaration merging visible
// without turning the pure type outlet into a runtime module.
export type * from './types.ts'
export type * from './domain.ts'
export {
  SCIENCE_EVENT_VERSION,
  SCIENCE_PROJECTION_STATE_VERSION,
  SCIENCE_PRESET_ID,
  ScienceArtifactId,
  ScienceEnvironmentProfileId,
  ScienceProjectId,
  ScienceRunId,
  ScienceScratchKey,
  ScienceVersionId,
} from './ids.ts'
export {
  MAX_CHART_ELEMENTS,
  MAX_CHART_HITS,
  MAX_CHART_OPS,
  MAX_CHART_STATE_BYTES,
} from './codec.ts'
export {
  applyScienceEvent,
  decodeScienceArtifact,
  decodeScienceChartState,
  decodeScienceDomainEvent,
  decodeScienceEnvironment,
  decodeScienceKernelState,
  decodeScienceMode,
  decodeScienceOutcome,
  decodeScienceRunStarted,
  decodeScienceRunTerminal,
  foldScience,
  projectScienceFold,
  replayScience,
} from './fold.ts'
export type { ScienceFoldState } from './fold.ts'
export { toClientScienceProjection }
export { applyScienceArtifactNotes, MAX_SCIENCE_ARTIFACT_NOTE_LENGTH } from './artifact-notes.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'science-session'

/** No hard service dependency; projection composition is optional. */
export const inject: readonly string[] = []

/**
 * Unavailable during P1; P2 owns this implementation.
 * @param _ctx - Input reserved for P2.
 * @throws Always rejects execution while the migration is pending.
 */
export function apply(_ctx: Context): void {
  // FIXME(replant): P2: Science checkpoint admission.
  throw new Error('Science migration pending — P2: Science checkpoint admission')
}
