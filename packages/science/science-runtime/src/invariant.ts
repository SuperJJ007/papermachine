/** Package-owned invariant companion for `@deepseek-ai/dsh-science-runtime`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-science-runtime'

/** Cordis companion plugin name. */
export const name = 'science-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Science Session owns the independently observable
 * event/projection relation; this provider enforces private process lifecycle
 * ordering directly before those facts are appended.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
