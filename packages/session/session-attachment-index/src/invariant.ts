/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-attachment-index`.
 * @module @deepseek-ai/dsh-session-attachment-index/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-attachment-index'

/** Cordis companion plugin name. */
export const name = 'session-attachment-index-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry's owned relationships are enforced
 * synchronously inside the service and proven by its spec. `register()`
 * rejects a key already classified `built-in`/`attachment-free` and rejects
 * a second live registration for the same key at the registration effect
 * itself — checking either relationship here would re-run the same
 * synchronous guard rather than detect drift. The exhaustive policy-table
 * relationship (every `KNOWN_SESSION_EVENT_TYPES` member classified exactly
 * once) is a static-data property with no session or mutable-data
 * counterpart to observe at runtime; its freshness test lives in this
 * package's own test suite instead.
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
