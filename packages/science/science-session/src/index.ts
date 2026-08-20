/**
 * Science Session Domain: typed durable facts, strict replay validation, the
 * optional `science` session projection, and the sole
 * `ctx.sessionAttachments` extractor for `science/artifact-saved`. This
 * package exposes no mutation service of its own and performs no environment
 * or process work; `@deepseek-ai/dsh-science-runtime` and
 * `@deepseek-ai/dsh-tool-science` own every durable append.
 *
 * @module @deepseek-ai/dsh-science-session
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-attachment-index'
import type {} from '@deepseek-ai/dsh-session-projection'
import { decodeScienceDomainEvent } from './codec.ts'
// Type-only side-effect import: activates domain.ts's SessionEventMap and
// SessionAttachmentExtractorMap merges for this file's own type-checking
// (the `export type *` re-export below does not have that effect).
import type {} from './domain.ts'
import { SCIENCE_PROJECTION_STATE_VERSION } from './ids.ts'
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
import { toClientScienceProjection } from './projection-value.ts'

// Type-only re-exports keep event and projection declaration merging visible
// without turning the pure type outlet into a runtime module.
export type * from './types.ts'
export type * from './domain.ts'
export {
  SCIENCE_EVENT_VERSION,
  ScienceArtifactId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from './ids.ts'
export {
  applyScienceEvent,
  decodeScienceArtifact,
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
  scienceRunsShareTurn,
} from './fold.ts'
export type { ScienceFoldState } from './fold.ts'
export { toClientScienceProjection }

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'science-session'

/** No hard service dependency; projection composition is optional. */
export const inject: readonly string[] = []

/**
 * Register the Science projection and the `science/artifact-saved` attachment
 * extractor, each only when the host composes its respective registry.
 * @param ctx - host context that may carry `ctx.sessionProjections` and/or `ctx.sessionAttachments`.
 */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'science', ScienceProjectionState>({
      key: 'science',
      schema: scienceProjectionSchema,
      checkpointStateSchema: scienceProjectionStateSchema,
      checkpointStateSeq: scienceProjectionStateSeq,
      init: emptyScienceProjectionState,
      apply: applyScienceProjectionState,
      view: viewScienceProjectionState,
      viewChanged: scienceProjectionChanged,
      stateVersion: SCIENCE_PROJECTION_STATE_VERSION,
    })
  })
  ctx.inject(['sessionAttachments'], (attachmentCtx) => {
    attachmentCtx.sessionAttachments.register('science/artifact-saved', (event) => {
      const decoded = decodeScienceDomainEvent(event)
      /* v8 ignore next 3 -- the registry only invokes this extractor for
       * science/artifact-saved events, and the decoder echoes the input type. */
      if (decoded === undefined || decoded.type !== 'science/artifact-saved') {
        throw new Error('science-session: extractor received an event that is not a valid science/artifact-saved fact')
      }
      return [decoded.data.artifact.attachment]
    })
  })
}
