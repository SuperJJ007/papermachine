/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-science-artifact-store`.
 * @module @deepseek-ai/dsh-science-artifact-store/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-science-artifact-store'

/** Cordis companion plugin name. */
export const name = 'science-artifact-store-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: schema-version rejection and blob digest
 * verification are open- and read-time checks proven by this package's unit
 * tests, and the append linearization point is a single SQLite write
 * transaction whose atomicity SQLite itself guarantees — there is no owned
 * in-process relation across live events or mutable data to assert here.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
