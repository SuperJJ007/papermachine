/**
 * Model-facing read, read_image, write, and edit tools over `ctx.fs`. This package owns schemas, validation,
 * read windows, formatting, and observation events, never a concrete provider. An optional
 * event policy supplies mutation guards; without one the tools use unconditional provider calls.
 * @module @deepseek-ai/dsh-tool-fs
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-user-approval'
import { Config, resolveReadCaps } from './config.ts'
import { applyReadTool } from './read.ts'
import { applyWriteTool } from './write.ts'
import { applyEditTool } from './edit.ts'
import { applyReadImageTool } from './read-image.ts'
import { FsSandboxController } from './sandbox.ts'

export { Config }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs'

/** Services required by the filesystem tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Register the full `read`/`write`/`edit` filesystem tool suite, plus `read_image` while `attachments` is mounted. */
export function apply(ctx: Context, config: Config): void {
  applyReadTool(ctx, resolveReadCaps(config))
  // read_image is composition-conditional: without a mounted attachment store
  // the deployment cannot durably commit image bytes, so the tool never
  // registers; the execute body keeps a defensive re-check for direct callers.
  ctx.inject(['attachments'], (imageCtx) => {
    applyReadImageTool(imageCtx)
  })
  // One escalation API shared by both mutating tools: advertisement gating,
  // per-call policy resolution, and denial-marker mapping, all keyed off whether
  // the mounted ctx.fs confines (ctx.fs.sandboxMode).
  const sandbox = new FsSandboxController(ctx)
  applyWriteTool(ctx, sandbox)
  applyEditTool(ctx, sandbox)
}
