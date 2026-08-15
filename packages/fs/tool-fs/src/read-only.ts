/**
 * Read-only model-facing filesystem entry: `read` plus conditional
 * `read_image`, sharing the root package's exact `Config` schema and read
 * limits. It registers no `write` or `edit` tool and never constructs
 * {@link FsSandboxController}. Independently loadable as
 * `@deepseek-ai/dsh-tool-fs/read-only`.
 * @module @deepseek-ai/dsh-tool-fs/read-only
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveReadCaps } from './config.ts'
import { applyReadTool } from './read.ts'
import { applyReadImageTool } from './read-image.ts'

export { Config }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs-read-only'

/** Services required by the read-only filesystem tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Register only `read`, plus `read_image` while `attachments` is mounted; never `write` or `edit`. */
export function apply(ctx: Context, config: Config): void {
  applyReadTool(ctx, resolveReadCaps(config))
  // Same composition-conditional gate as the root entry: without a mounted
  // attachment store the deployment cannot durably commit image bytes.
  ctx.inject(['attachments'], (imageCtx) => {
    applyReadImageTool(imageCtx)
  })
}
