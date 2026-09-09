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
 * No runtime invariant: the two keyed toolview rows, the keyed settings
 * card, the session-header action, the Details entry, and the locale
 * dictionaries are registry-owned registrations whose disposal is proven by
 * the HMR-safety spec. The toolview rows and the Details entry are pure
 * functions of the frozen call/result slice and the durable `science`
 * projection, both owned elsewhere; the Details entry's own attachment
 * loader (science-attachment-loader.ts) holds no state across calls. The
 * header action reads only the Session summary's `agentPreset` field. The
 * settings card stages edits over the `science-runtime` namespace it does
 * not own; the write refusals, revision fencing, and secret redaction it
 * relies on are Host contracts covered by the settings seam and the Science
 * Runtime's own settings ownership. This package emits no cordis event and
 * owns no durable or cross-plugin mutable state.
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
