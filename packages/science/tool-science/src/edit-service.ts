/**
 * Host-owned admission service for artifact-viewer Science edit gestures.
 * @module @deepseek-ai/dsh-tool-science/edit-service
 */

import type { Context } from '@deepseek-ai/cordis'
import { ScienceEditService } from './edit-message.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'science-edit-service'

/** Services required by the Host commit path: the store owns artifact bytes; message-image admission still uses the attachment store. */
export const inject = ['attachments', 'scienceArtifactStore', 'scienceRuntime']

/**
 * Register the process-global Remote where the Host Typert Gateway can resolve it.
 * @param ctx - Host root context shared by the Gateway and live Agent registry.
 */
export function apply(ctx: Context): void {
  new ScienceEditService(ctx)
}
