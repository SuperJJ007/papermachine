/**
 * Science transcript rows, settings card, session-header action, and
 * artifact viewer, browser half: registers the `science` locale
 * dictionaries, the two dedicated keyed toolview rows — `save_chart` and
 * `publish_outcome` — the Science settings card keyed on the
 * `science-runtime` namespace, the `conversation.session.header.actions`
 * entry that opens the routed Details column, and the
 * `conversation.details.view` entry (id `science`, the artifact viewer) that
 * renders current Science state from the same projection: a top tab strip
 * over opened artifacts, an in-panel toolbar, dispatched content, and — one
 * toolbar click away — the provenance drill-in, entirely inside this one
 * Details entry (no separate `conversation.view` tab or
 * `conversation.details.header.actions` registration). The toolview rows
 * are pure functions of the frozen call/result slice, the loaded durable
 * image bytes, and (for the Outcome row) the live `science` session
 * projection; the settings card owns its own staging over the bound
 * settings scope; the artifact viewer and the transcript row share one
 * package-local per-session selection store (selection-store.ts) — Science
 * viewing state ui-conversation's `ChatStoreState` has no reason to carry.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: resolves ctx.locale and ctx.slots on ClientContext.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: resolves ctx.settingsScope on ClientContext.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the keyed settings.plugin.item slot's declaration. Cross-plugin
// collaboration goes through cordis services; a value import fails the
// client bundle purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: the conversation.session.header.actions and
// conversation.details.view slots' declarations, and the Details seam's
// inspectCall owner callback (same cross-plugin rule).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: brings the `science` SessionProjectionMap merge into this program.
import type {} from '@deepseek-ai/dsh-science-session/types'
import { createScienceImageLoader } from './science-attachment-loader.ts'
import { ScienceChartRow } from './ScienceChartRow.tsx'
import { ScienceOutcomeRow } from './ScienceOutcomeRow.tsx'
import { ScienceSettingsCard } from './ScienceSettingsCard.tsx'
import { ScienceHeaderAction } from './ScienceHeaderAction.tsx'
import { ScienceDetailsView, type ScienceDetailsInjected } from './ScienceDetailsView.tsx'
import { createScienceSelectionStore } from './selection-store.ts'
import { SCIENCE_RUNTIME_NS, ScienceSettingsCardController } from './settings-card-controller.ts'
import type { ScienceRuntimeSettingsSection } from './settings-card-controller.ts'
import { en, NS, zh, type ScienceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated chart/Outcome rows', settings card's, header action's, and artifact viewer's copy. */
    science: ScienceKey
  }
}

/** Details entry id this package registers (matches the header action's `openDetailsView` argument). */
const SCIENCE_DETAILS_ID = 'science'

/**
 * Required services: the locale, slot, and session registries, plus
 * `connection` and `remote` — `ctx.settingsScope.bind()`'s own documented
 * precondition (`SettingsScopeBinder.bind`, `dsh-client-ui-settings`) is that
 * the CALLER injects both: `bind()` runs `ctx.get('connection')` and
 * `ctx.get('remote')` on this plugin's own context and registers the
 * forwarded-invalidation subscription on this plugin's own fiber, so this
 * plugin — not `settingsScope`'s provider, which declares no injections of
 * its own and resolves the transport per caller — owns that precondition.
 * `sessions` resolves the Details entry's own attachment loader (its owner
 * share carries nothing beyond the Details seam's own callbacks, per
 * `DetailsViewOwnerProps`).
 */
export const inject = ['locale', 'slots', 'connection', 'remote', 'settingsScope', 'sessions']

/**
 * Client plugin body: register dictionaries, the two keyed toolview rows,
 * the keyed Science settings card, the session-header action, and the
 * artifact viewer (Science Details entry).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-science: dictionaries')

  // Package-local per-session store: which artifacts are open, which one is
  // active, and its content/provenance view — shared by the artifact viewer
  // and the transcript row. Created once for this fiber and shared by
  // reference across every registration below that declares it as `store:`
  // — the framework resolves one live instance per (this handle, session) pair.
  const scienceSelectionStore = createScienceSelectionStore()

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register(
      { name: 'tool.call.toolview', key: 'save_chart', locale: NS, store: scienceSelectionStore },
      ScienceChartRow,
    )
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

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: SCIENCE_DETAILS_ID,
    order: 0,
    locale: NS,
  }, ScienceHeaderAction))

  // Registration-time text (the entry's tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration; components read the standard `t` seat instead.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.details.view', () => ctx.slots.register({
    name: 'conversation.details.view',
    id: SCIENCE_DETAILS_ID,
    order: 10,
    label: () => t('details.label'),
    locale: NS,
    store: scienceSelectionStore,
    inject: (sessionId: SessionId): ScienceDetailsInjected => ({
      loadImage: createScienceImageLoader(ctx.sessions, sessionId),
    }),
  }, ScienceDetailsView))
}
