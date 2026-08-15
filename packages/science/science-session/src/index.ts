/**
 * Science Session Domain: typed durable facts, strict replay validation, and
 * the optional `science` session projection. This Phase 1 package exposes no
 * mutation service and performs no environment or process work.
 *
 * @module @deepseek-ai/dsh-science-session
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
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

// Type-only re-exports keep event and projection declaration merging visible
// without turning the pure type outlet into a runtime module.
export type * from './types.ts'
export type * from './domain.ts'
export {
  SCIENCE_EVENT_VERSION,
  ScienceChartId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from './ids.ts'
export {
  decodeScienceChart,
  decodeScienceDomainEvent,
  decodeScienceEnvironment,
  decodeScienceMode,
  decodeScienceOutcome,
  decodeScienceRunStarted,
  decodeScienceRunTerminal,
  replayScience,
} from './fold.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'science-session'

/** No hard service dependency; projection composition is optional. */
export const inject: readonly string[] = []

/** Register the Science projection only when the host composes its registry. */
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
}
