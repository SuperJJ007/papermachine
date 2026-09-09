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
import { SCIENCE_PROJECTION_STATE_VERSION } from './ids.ts'
import { applyScienceArtifactNotes, scienceArtifactNotesSchema } from './artifact-notes.ts'
import {
  applyScienceProjectionState,
  emptyScienceProjectionState,
  scienceProjectionChanged,
  scienceProjectionSchema,
  scienceProjectionStateSchema,
  scienceProjectionStateSeq,
  viewScienceProjectionState,
} from './projection.ts'
import type { ScienceProjectionState } from './projection-private.ts'
import type { ScienceArtifactNotesProjection } from './types.ts'
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
 * Register the Science projection when the host composes the projection
 * registry. No attachment extractor exists any more: `science/artifact-saved`
 * carries no artifact bytes, and the project artifact store — not the
 * session-scoped attachment store — owns artifact bytes.
 * @param ctx - host context that may carry `ctx.sessionProjections`.
 */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'science', ScienceProjectionState>({
      key: 'science',
      stateSchema: scienceProjectionStateSchema,
      checkpointStateSchema: scienceProjectionStateSchema,
      checkpointStateSeq: scienceProjectionStateSeq,
      init: emptyScienceProjectionState,
      apply: applyScienceProjectionState,
      wire: { viewSchema: scienceProjectionSchema, view: viewScienceProjectionState },
      viewChanged: scienceProjectionChanged,
      stateVersion: SCIENCE_PROJECTION_STATE_VERSION,
    })
    projectionCtx.sessionProjections.register<'scienceArtifactNotes', ScienceArtifactNotesProjection>({
      key: 'scienceArtifactNotes',
      stateSchema: scienceArtifactNotesSchema,
      init: () => [],
      apply: applyScienceArtifactNotes,
      wire: { viewSchema: scienceArtifactNotesSchema, view: state => state },
      stateVersion: 1,
    })
  })
}
