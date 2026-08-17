/**
 * Restart-scoped user-settings ownership of the Science Runtime's Conda
 * profile map. The Cordis-configured `profiles` field is also the
 * composition `base` of a `science-runtime` settings namespace, and
 * `pythonPrefix`/`rPrefix` are write-only secrets on every browser-facing
 * settings descriptor.
 *
 * Only the `@deepseek-ai/dsh-science-runtime/with-settings` entry reaches
 * this module: it declares `settings` in its Cordis injections, so the
 * provider is ACTIVE before the Runtime is constructed and this registration
 * needs no readiness probe of its own.
 * @module @deepseek-ai/dsh-science-runtime/settings
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'
import { parseProfiles } from './config.ts'
import type { Config, ConfiguredProfile, ScienceEnvironmentProfileConfig } from './config.ts'

/** Namespace carrying only the `science-runtime` Conda profile map. */
export const SCIENCE_RUNTIME_SETTINGS_NAMESPACE = settingsNamespace('science-runtime')

/**
 * Settings schema for the profile map: the same closed per-profile fields
 * {@link parseProfiles} enforces (validated by the `validate` hook, not the
 * schema, exactly as the Cordis `configSchema` does), with both prefix
 * fields write-only so no redacted describe output, wire event, diagnostic,
 * or snapshot ever carries an absolute Host path.
 */
export const scienceRuntimeProfilesSchema: z<Readonly<Record<string, ScienceEnvironmentProfileConfig>>> = z.dict(z.object({
  pythonPrefix: z.string().role('secret'),
  rPrefix: z.string().role('secret'),
}))

/**
 * Register the `science-runtime` namespace on an ACTIVE settings provider and
 * resolve the profile map for one Host lifecycle. The registration takes
 * `applies: 'restart'` and is not watched, so a later settings write changes
 * only the next Host start. An unserviceable stored section throws here — the
 * settings registration is the earliest point that can judge it — which fails
 * the calling Runtime's own load rather than leaving it mounted over
 * configuration it rejects.
 * @param settings - the ACTIVE settings provider this Runtime injected.
 * @param config - this Runtime's Cordis entry configuration, used as the composition `base`.
 * @returns the settings-resolved profile map, immutable for this Host lifecycle.
 */
export function attachRuntimeSettings(
  settings: SettingsProvider,
  config: Config,
): ReadonlyMap<string, ConfiguredProfile> {
  const scope = settings.register(SCIENCE_RUNTIME_SETTINGS_NAMESPACE, scienceRuntimeProfilesSchema, {
    base: config.profiles,
    applies: 'restart',
    validate: (value) => { parseProfiles(value) },
  })
  return parseProfiles(scope.get())
}
