/**
 * Science transcript rows and settings card, browser half: registers the
 * `science` locale dictionaries, the two dedicated keyed toolview rows —
 * `save_chart` and `publish_outcome` — and the Science settings card keyed
 * on the `science-runtime` namespace. The toolview rows are pure functions of
 * the frozen call/result slice, the loaded durable image bytes, and (for the
 * Outcome row) the live `science` session projection; the settings card owns
 * its own staging over the bound settings scope.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: resolves ctx.locale and ctx.slots on ClientContext.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: resolves ctx.settingsScope on ClientContext.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the keyed settings.plugin.item slot's declaration. Cross-plugin
// collaboration goes through cordis services; a value import fails the
// client bundle-purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: brings the `science` SessionProjectionMap merge into this program.
import type {} from '@deepseek-ai/dsh-science-session/types'
import { ScienceChartRow } from './ScienceChartRow.tsx'
import { ScienceOutcomeRow } from './ScienceOutcomeRow.tsx'
import { ScienceSettingsCard } from './ScienceSettingsCard.tsx'
import { SCIENCE_RUNTIME_NS, ScienceSettingsCardController } from './settings-card-controller.ts'
import type { ScienceRuntimeSettingsSection } from './settings-card-controller.ts'
import { en, NS, zh, type ScienceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated chart/Outcome rows' and settings card's copy. */
    science: ScienceKey
  }
}

/**
 * Required services: the locale and tool-toolview registries, plus
 * `connection` and `remote` — `ctx.settingsScope.bind()`'s own documented
 * precondition (`SettingsScopeBinder.bind`, `dsh-client-ui-settings`) is that
 * the CALLER injects both: `bind()` runs `ctx.get('connection')` and
 * `ctx.get('remote')` on this plugin's own context and registers the
 * forwarded-invalidation subscription on this plugin's own fiber, so this
 * plugin — not `settingsScope`'s provider, which declares no injections of
 * its own and resolves the transport per caller — owns that precondition.
 */
export const inject = ['locale', 'slots', 'connection', 'remote', 'settingsScope']

/**
 * Client plugin body: register dictionaries, the two keyed toolview rows,
 * and the keyed Science settings card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-science: dictionaries')
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'save_chart', locale: NS }, ScienceChartRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'publish_outcome', locale: NS }, ScienceOutcomeRow)
  })

  const settingsCard = new ScienceSettingsCardController(
    ctx.settingsScope.bind<ScienceRuntimeSettingsSection>({ namespace: SCIENCE_RUNTIME_NS }),
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SCIENCE_RUNTIME_NS,
    locale: NS,
    inject: () => settingsCard.inject(),
  }, ScienceSettingsCard))
}
