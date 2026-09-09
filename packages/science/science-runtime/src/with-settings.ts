/**
 * Science Runtime entry that resolves its Conda profile map through the
 * restart-scoped `science-runtime` user-settings namespace, with the Cordis
 * `profiles` map as the composition `base`. Independently loadable as
 * `@deepseek-ai/dsh-science-runtime/with-settings`.
 *
 * It differs from the root entry only in declaring `settings` among its
 * Cordis injections. That declaration is what makes the binding
 * deterministic: Cordis constructs this Runtime only once the settings
 * provider is ACTIVE, so the namespace registration cannot depend on which
 * entry's module finished importing first. A composition that declares this
 * entry without a settings provider leaves it PENDING on the unmet
 * injection instead of silently falling back to the Cordis map.
 *
 * Deployments that own their profile map in configuration alone mount the
 * root `@deepseek-ai/dsh-science-runtime` entry instead.
 * @module @deepseek-ai/dsh-science-runtime/with-settings
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { Config } from './config.ts'
import { ScienceRuntime, inject } from './index.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'science-runtime-with-settings'

/** The root entry's required services plus the user-settings capability. */
export const settingsInject = [...inject, 'settings']

/** Science Runtime provider bound to the `science-runtime` settings namespace. */
export class ScienceRuntimeWithSettings extends ScienceRuntime {
  static override inject = settingsInject

  /**
   * Register the namespace and snapshot its resolved profile map once, while
   * the injected provider is guaranteed ACTIVE. An unserviceable stored
   * section throws here and fails this entry's load.
   * @param ctx - Cordis context whose `settings` this entry's injections made ACTIVE.
   * @param config - the strict local prefix configuration, also the settings composition `base`.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.bindSettings(ctx.settings)
  }
}

export default ScienceRuntimeWithSettings
