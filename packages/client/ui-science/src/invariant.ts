/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-science`.
 * @module @deepseek-ai/dsh-client-ui-science/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-science'

/** Cordis companion plugin name. */
export const name = 'client-ui-science-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the two keyed toolview rows and locale dictionaries
 * are registry-owned registrations whose disposal is proven by the
 * HMR-safety spec. They emit no cordis events and own no cross-plugin
 * mutable state; every render is a pure function of the frozen call/result
 * slice and the durable `science` projection, both owned elsewhere.
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
