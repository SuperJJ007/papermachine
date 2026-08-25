/**
 * Science transcript rows, settings card, session-header action, and
 * artifact viewer, browser half: registers the `science` locale
 * dictionaries, the four dedicated keyed toolview rows — `run_python` and
 * `run_r` (`ScienceRunRow`, run text plus a clickable reference per captured
 * file), `annotate_artifact` (`ScienceArtifactRow`, the one curated
 * reference), and `publish_outcome` — the Science settings card keyed on the
 * `science-runtime` namespace, the Files toggle, and the
 * `conversation.details.view` entry (id `science`, the artifact viewer) that
 * renders current Science state from the same projection: a top tab strip,
 * exact-version preview, user-only notes, and a jump to the producing chat
 * turn. Producing assistant messages own their compact turn-local trace; no
 * causal view is registered in the artifact panel. The Files toggle's
 * own placement is `../toggle-scope.ts`'s resolved `ToggleScope`: the
 * generic Web default (`session`) registers the right-aligned
 * `conversation.session.header.utilities` entry (`ScienceHeaderAction`,
 * gated to a non-blank Science Session) alongside a `conversation.page.utilities`
 * hand-off for a blank one (`ScienceHeroAction`); the desktop composition's
 * `global` placement instead registers one unconditional
 * `conversation.page.utilities` owner (`ScienceGlobalToggle`) and skips the
 * session-header registration, so the toggle is visible app-wide — before
 * any workspace is selected, before any Session exists, and through every
 * later Session state — with exactly one owner. Distinct Files/Outcomes
 * Details routes complete the workbench alongside sidebar destinations,
 * staged-target composer chips
 * (`conversation.input.accessory`), and a composer-dock kernel status
 * line — every one of these (other than the Files toggle) gated the same way
 * `ScienceHeaderAction` is, so no other Science surface reaches another
 * preset or a Session-less page. The toolview rows
 * are pure functions of the frozen call/result slice, the loaded durable
 * image/text bytes, and (for the Outcome row) the live `science` session
 * projection; the settings card owns its own staging over the bound
 * settings scope; the artifact viewer and the transcript rows share one
 * package-local per-session selection store (selection-store.ts) — Science
 * viewing state ui-conversation's `ChatStoreState` has no reason to carry. A
 * raster region drawn in the artifact viewer stages into the same composer
 * selections store as a Vega-Lite structural target, through the same
 * comment-plus-add control; every comment draft is scoped to its exact
 * artifact identity so switching tabs or versions never bleeds one draft into
 * another, and editing a comment after staging updates the staged selection
 * immediately.
 */
import type { ClientContext, ConversationNode, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
// Type-only: resolves ctx.locale and ctx.slots on ClientContext.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: resolves ctx.settingsScope on ClientContext.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the keyed settings.plugin.item slot's declaration. Cross-plugin
// collaboration goes through cordis services; a value import fails the
// client bundle purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: the conversation.session.header.utilities and
// conversation.details.view slots' declarations, and the Details seam's
// inspectCall owner callback (same cross-plugin rule).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: brings the `science` SessionProjectionMap merge into this program.
import type {} from '@deepseek-ai/dsh-science-session/types'
// Type-only: pulls the generated Science Remote namespace into ClientContext.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createScienceImageLoader, createScienceTextLoader } from './science-attachment-loader.ts'
import { ScienceArtifactRow } from './ScienceArtifactRow.tsx'
import { ScienceRunRow } from './ScienceRunRow.tsx'
import { ScienceOutcomeRow } from './ScienceOutcomeRow.tsx'
import { ScienceSettingsCard } from './ScienceSettingsCard.tsx'
import { ScienceHeaderAction } from './ScienceHeaderAction.tsx'
import { ScienceHeroAction } from './ScienceHeroAction.tsx'
import { ScienceGlobalToggle } from './ScienceGlobalToggle.tsx'
import { ScienceEmptyDetails } from './ScienceEmptyDetails.tsx'
import { ScienceComposerChips } from './ScienceComposerChips.tsx'
import { ScienceComposerSelections } from './composer-selections.ts'
import { ScienceDestinations } from './ScienceDestinations.tsx'
import { ScienceKernelStatus } from './ScienceKernelStatus.tsx'
import { ScienceDetailsView, type ScienceDetailsInjected } from './ScienceDetailsView.tsx'
import { ScienceOutcomeDetails } from './ScienceOutcomeDetails.tsx'
import { ScienceTurnTrace } from './ScienceTurnTrace.tsx'
import { scienceTurnTraceDefinition, selectScienceTurnTrace } from './science-turn-trace.ts'
import { createScienceSelectionStore } from './selection-store.ts'
import { readToggleScope } from './toggle-scope.ts'
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
const SCIENCE_OUTCOMES_ID = 'science-outcomes'

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
export const inject = ['locale', 'slots', 'connection', 'remote', 'remote.scienceEdits', 'settingsScope', 'sessions', 'conversation', 'conversationEvents']

/**
 * Client plugin body: register dictionaries, the two keyed toolview rows,
 * the keyed Science settings card, the session-header action, and the
 * artifact viewer (Science Details entry).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-science: dictionaries')

  // Package-local per-session store: which artifacts are open, which one is
  // active and whether its lightbox is open — shared by the artifact viewer
  // and the transcript row. Created once for this fiber and shared by
  // reference across every registration below that declares it as `store:`
  // — the framework resolves one live instance per (this handle, session) pair.
  const scienceSelectionStore = createScienceSelectionStore()
  const composerSelections = new ScienceComposerSelections()
  const ComposerChipsEntry = (props: PropsRuntime<'conversation.input.accessory'> & PropsLocale<'science'>) => {
    const science = props.useProjection('science')
    if (science === null || science === undefined) return null
    return createElement(ScienceComposerChips, {
      selections: composerSelections.store(props.sessionId),
      remove: (index) => { composerSelections.remove(props.sessionId, index) },
      t: props.t,
    })
  }

  ctx.slots.inject('sidebar.destinations', () => ctx.slots.register({
    name: 'sidebar.destinations', id: 'science', order: 0, locale: NS,
    inject: () => ({
      openScience: (sessionId: SessionId, destination: 'files' | 'outcomes') => {
        ctx.conversation.openDetailsView(sessionId, destination === 'files' ? SCIENCE_DETAILS_ID : SCIENCE_OUTCOMES_ID)
      },
    }),
  }, ScienceDestinations))

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register(
      { name: 'tool.call.toolview', key: 'annotate_artifact', locale: NS, store: scienceSelectionStore },
      ScienceArtifactRow,
    )
    yield ctx.slots.register(
      { name: 'tool.call.toolview', key: 'run_python', locale: NS, store: scienceSelectionStore },
      ScienceRunRow,
    )
    yield ctx.slots.register(
      { name: 'tool.call.toolview', key: 'run_r', locale: NS, store: scienceSelectionStore },
      ScienceRunRow,
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

  // Files-toggle placement (../toggle-scope.ts): `global` mounts the one
  // unconditional `conversation.page.utilities` owner and skips the
  // session-header registration entirely, so the desktop composition's
  // toggle has exactly one owner from before any workspace is selected
  // through every later Session state. `session` (the generic Web default)
  // keeps the existing hand-off — the session header owns a non-blank
  // Session, the page-level action covers only a blank Science Session.
  const toggleScope = readToggleScope()
  if (toggleScope === 'global') {
    ctx.slots.inject('conversation.page.utilities', () => ctx.slots.register({
      name: 'conversation.page.utilities', id: SCIENCE_DETAILS_ID, order: 0, locale: NS,
    }, ScienceGlobalToggle))
  } else {
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: SCIENCE_DETAILS_ID,
      order: 10,
      locale: NS,
    }, ScienceHeaderAction))

    ctx.slots.inject('conversation.page.utilities', () => ctx.slots.register({
      name: 'conversation.page.utilities', id: SCIENCE_DETAILS_ID, order: 0, locale: NS,
    }, ScienceHeroAction))
  }

  ctx.slots.inject('details.files', () => ctx.slots.register({
    name: 'details.files', locale: NS,
  }, ScienceEmptyDetails))

  ctx.slots.inject('conversation.input.accessory', () => ctx.slots.register({
    name: 'conversation.input.accessory', id: 'science-targets', order: 0, locale: NS,
  }, ComposerChipsEntry))

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'science-kernels', order: 10, locale: NS,
  }, ScienceKernelStatus))

  ctx.effect(() => ctx.conversation.registerSubmissionHandler((submission) => {
    const targets = composerSelections.store(submission.sessionId).getSnapshot()
    if (targets.length === 0) return undefined
    if (submission.imageIds.length > 0) {
      return Promise.resolve({ kind: 'error', text: ctx.locale.bind(NS)('edit.imagesUnsupported') })
    }
    return ctx.remote.scienceEdits.submit(submission.sessionId, {
      targets,
      instruction: submission.text,
    }).then((result) => {
      if (!result.ok) return { kind: 'error' as const, text: result.error.message }
      composerSelections.clear(submission.sessionId)
      return { kind: 'success' as const }
    })
  }), 'ui-science: composer edit submission')

  ctx.conversationEvents.register(scienceTurnTraceDefinition)
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectScienceTurnTrace,
    locale: NS,
    store: scienceSelectionStore,
    inject: (sessionId: SessionId) => ({
      openArtifact: () => { ctx.conversation.openDetailsView(sessionId, SCIENCE_DETAILS_ID) },
    }),
  }, ScienceTurnTrace))

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
      loadText: createScienceTextLoader(ctx.sessions, sessionId),
      addToConversation: (targets) => { composerSelections.add(sessionId, targets) },
      removeFromConversation: (target) => { composerSelections.removeSelection(sessionId, target) },
      composerSelections: composerSelections.store(sessionId),
      returnToConversation: (seq) => {
        ctx.conversation.openView(sessionId, 'chat')
        requestAnimationFrame(() => {
          const snapshot = ctx.sessions.binding(sessionId)?.session.getSnapshot()
          const assistant = snapshot?.nodes.find((node): node is Extract<ConversationNode, { kind: 'assistant' }> =>
            node.kind === 'assistant' && node.seq === seq)
          const turn = assistant?.turn
          if (turn === undefined) return
          const target = document.querySelector<HTMLElement>(`[data-turn-tail="${String(turn)}"]`)
          target?.scrollIntoView({ block: 'center' })
        })
      },
      addArtifactNote: request => ctx.remote.scienceEdits.addArtifactNote(sessionId, request),
      removeArtifactNote: request => ctx.remote.scienceEdits.removeArtifactNote(sessionId, request),
      commitStyleEdit: request => ctx.remote.scienceEdits.commitStyleEdit(sessionId, request),
    }),
  }, ScienceDetailsView))
  ctx.slots.inject('conversation.details.view', () => ctx.slots.register({
    name: 'conversation.details.view', id: SCIENCE_OUTCOMES_ID, order: 11,
    label: () => t('outcome.title'), locale: NS,
  }, ScienceOutcomeDetails))
}
