/** P1 refuses Science execution until the P2 runtime composition is accepted. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

/** Loader name for the temporary Science execution refusal. */
export const name = 'science-replant-pending'

/**
 * Reject a turn before a model request can run under the incomplete preset.
 * @param ctx - The standing Science preset scope.
 */
export function apply(ctx: Context): void {
  // FIXME(replant): P2 replaces this refusal with the restricted Science tool composition.
  ctx.on('agent/pre-step', () => {
    throw new Error('Science execution is unavailable while the runtime migration is pending (P2).')
  })
}
