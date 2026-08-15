/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-science`.
 * @module @deepseek-ai/dsh-tool-science/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-science'

/** Cordis companion plugin name. */
export const name = 'tool-science-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Science Session invariant owns the durable
 * event/projection relationship. This package only calls `ctx.scienceRuntime`
 * and registers model-facing prompt, context, and tool contributions; it owns
 * no additional authoritative mutable relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
