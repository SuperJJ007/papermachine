/**
 * Browser composition for Science transcript cells, Turn-end artifacts,
 * the Trajectory Process, the Files Details entry, settings, composer
 * selections, and kernel status. Process Tool rows are collapsed visual
 * cells; artifact presentation values accumulate in Turn data and render
 * once after the Assistant reply. Science contributes `trajectory.view`
 * id `process` through ui-trajectory's extension point and registers its
 * own reactive visibility source. The artifact viewer, Turn-tail cards, and
 * composer controls share package-local per-Session stores; none of their
 * visual state enters the Session log or model requests.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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
// conversation.details.view slots' declarations, the Details seam's
// inspectCall owner callback, and IConversation.registerTranscriptDetailVisibility's
// source type (same cross-plugin rule).
import type { TranscriptDetailVisibilitySource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectoryViewVisibilitySource } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: brings the `science` SessionProjectionMap merge into this program.
import type {} from '@deepseek-ai/dsh-science-session/types'
// Type-only: pulls the generated Science Remote namespace into ClientContext.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createScienceImageLoader, createScienceTextLoader } from './science-attachment-loader.ts'
import { ScienceAnnotationRow } from './ScienceAnnotationRow.tsx'
import { ScienceExecutionRow, type ScienceExecutionRowInjected } from './ScienceExecutionRow.tsx'
import { ScienceOutcomeRow, type ScienceOutcomeInjected } from './ScienceOutcomeRow.tsx'
import { ScienceSettingsCard } from './ScienceSettingsCard.tsx'
import { ScienceHeaderAction } from './ScienceHeaderAction.tsx'
import { ScienceHeroAction } from './ScienceHeroAction.tsx'
import { ScienceGlobalToggle } from './ScienceGlobalToggle.tsx'
import { ScienceEmptyDetails } from './ScienceEmptyDetails.tsx'
import { ScienceComposerChips } from './ScienceComposerChips.tsx'
import { ScienceComposerSelections } from './composer-selections.ts'
import { scienceElementLabel } from './science-element-label.ts'
import { ScienceDestinations } from './ScienceDestinations.tsx'
import { ScienceKernelStatus } from './ScienceKernelStatus.tsx'
import { ScienceTurnArtifacts, type ScienceTurnArtifactsInjected } from './ScienceTurnArtifacts.tsx'
import { scienceTurnArtifactsDefinition, selectScienceTurnArtifacts } from './science-turn-artifacts.ts'
import { ScienceTraceView, type ScienceTraceInjected } from './ScienceTraceView.tsx'
import { ScienceDetailsView, type ScienceDetailsInjected } from './ScienceDetailsView.tsx'
import { ScienceDetailsTabs } from './ScienceDetailsTabs.tsx'
import { ScienceDetailsHeader } from './ScienceDetailsHeader.tsx'
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

/**
 * The Process's visibility source: a Session qualifies once it names
 * the `science` preset OR its `science` projection has resolved (a
 * subagent, or a preset switch after creation, may bind one without the
 * preset field itself ever being `science`). `subscribe` re-derives its
 * per-Session projection subscriptions every time the sessions list
 * changes, so a preset assignment (the list itself), a Session appearing or
 * leaving, or that Session's science projection binding/updating each reach
 * the callback — the tab strip's `views.subscribe` folds this in beside the
 * `conversation.view` slot ledger (ui-conversation's `apply.ts`), so a
 * flip here re-lists the tabs on its own, without waiting for an unrelated
 * ledger mutation.
 * @param ctx - client root context (reads `ctx.sessions`).
 * @returns the registrable {@link ViewVisibilitySource}.
 */
function createTraceVisibilitySource(ctx: ClientContext): TrajectoryViewVisibilitySource {
  return {
    visible: sessionId =>
      ctx.sessions.list.getSnapshot().byId[sessionId]?.agentPreset === 'science'
      || (ctx.sessions.binding(sessionId)?.session.projections.faceOf('science').getSnapshot() ?? null) !== null,
    subscribe: (callback) => {
      const bindingDisposers = new Map<SessionId, () => void>()
      const syncBindings = (): void => {
        const ids = new Set(ctx.sessions.list.getSnapshot().ids)
        for (const [id, dispose] of bindingDisposers) {
          if (!ids.has(id)) { dispose(); bindingDisposers.delete(id) }
        }
        for (const id of ids) {
          if (bindingDisposers.has(id)) continue
          const face = ctx.sessions.binding(id)?.session.projections.faceOf('science')
          if (face === undefined) continue
          bindingDisposers.set(id, face.subscribe(callback))
        }
      }
      syncBindings()
      const disposeList = ctx.sessions.list.subscribe(() => { callback(); syncBindings() })
      return () => {
        disposeList()
        for (const dispose of bindingDisposers.values()) dispose()
        bindingDisposers.clear()
      }
    },
  }
}

/**
 * Transcript process-detail chrome (context-injection rows, turn-timing
 * stats) stays hidden for every Science Session: Science's own transcript
 * cells and Turn-end artifact groups are the denser presentation, and this
 * detail remains reconstructable from the durable log. Same reactive
 * predicate as the Process, inverted — a Session qualifies for hiding
 * exactly when it qualifies for the Process.
 * @param ctx - client root context (reads `ctx.sessions`).
 * @returns the registrable {@link TranscriptDetailVisibilitySource}.
 */
function createTranscriptDetailVisibilitySource(ctx: ClientContext): TranscriptDetailVisibilitySource {
  const trace = createTraceVisibilitySource(ctx)
  return {
    visible: sessionId => !trace.visible(sessionId),
    subscribe: callback => trace.subscribe(callback),
  }
}

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
export const inject = ['locale', 'slots', 'connection', 'remote', 'remote.scienceEdits', 'settingsScope', 'sessions', 'conversation', 'conversationEvents', 'trajectorySubviews']

/**
 * Client plugin body: register dictionaries, the two keyed toolview rows,
 * the keyed Science settings card, the session-header action, and the
 * artifact viewer (Science Details entry).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-science: dictionaries')
  ctx.conversationEvents.register(scienceTurnArtifactsDefinition)

  // Package-local per-session store: which artifacts are open, which one is
  // active, and its content/provenance view — shared by the artifact viewer
  // and the transcript row. Created once for this fiber and shared by
  // reference across every registration below that declares it as `store:`
  // — the framework resolves one live instance per (this handle, session) pair.
  const scienceSelectionStore = createScienceSelectionStore()
  // "Return to the artifact library" per mounted session, bound by the
  // `conversation.details.view` registration below while its entry is
  // rendered (see its `inject`) — the sidebar destination reaches the exact
  // live per-session store instance the Details entry renders from this way,
  // since `sidebar.destinations` is root-scoped and cannot declare a
  // session-scoped `store:` of its own. Absent for a session whose Details
  // entry has never rendered (nothing to reset yet — opening it fresh
  // already lands on the library, the store's own init state).
  const libraryReturners = new Map<SessionId, () => void>()
  const composerSelections = new ScienceComposerSelections()
  const ComposerChipsEntry = (props: PropsRuntime<'conversation.input.accessory'> & PropsLocale<'science'>) => {
    const science = props.useProjection('science')
    if (science === null || science === undefined) return null
    return createElement(ScienceComposerChips, {
      selections: composerSelections.store(props.sessionId),
      artifacts: science.artifacts,
      remove: (index) => { composerSelections.remove(props.sessionId, index) },
      t: props.t,
    })
  }

  ctx.slots.inject('sidebar.destinations', () => ctx.slots.register({
    name: 'sidebar.destinations', id: 'science', order: 0, locale: NS,
    inject: () => ({
      // Sidebar "Artifacts" always lands on the artifact library: reveal
      // (or keep revealed) the Science Details entry, then force it back to
      // the library's artifacts page regardless of what it was showing —
      // an open artifact tab, the files page, or the library already.
      openScience: (sessionId: SessionId) => {
        ctx.conversation.openDetailsView(sessionId, SCIENCE_DETAILS_ID)
        libraryReturners.get(sessionId)?.()
      },
    }),
  }, ScienceDestinations))

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register(
      { name: 'tool.call.toolview', key: 'annotate_artifact', locale: NS, store: scienceSelectionStore },
      ScienceAnnotationRow,
    )
    yield ctx.slots.register(
      {
        name: 'tool.call.toolview', key: 'run_python', locale: NS, store: scienceSelectionStore,
        inject: (): ScienceExecutionRowInjected => ({ cancel: () => { void ctx.conversation.cancel() } }),
      },
      ScienceExecutionRow,
    )
    yield ctx.slots.register(
      {
        name: 'tool.call.toolview', key: 'run_r', locale: NS, store: scienceSelectionStore,
        inject: (): ScienceExecutionRowInjected => ({ cancel: () => { void ctx.conversation.cancel() } }),
      },
      ScienceExecutionRow,
    )
    yield ctx.slots.register({
      name: 'tool.call.toolview', key: 'publish_outcome', locale: NS,
      inject: (sessionId: SessionId): ScienceOutcomeInjected => ({
        loadScienceImage: createScienceImageLoader(ctx.sessions, sessionId),
      }),
    }, ScienceOutcomeRow)
  })

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectScienceTurnArtifacts,
    locale: NS,
    store: scienceSelectionStore,
    inject: (sessionId: SessionId): ScienceTurnArtifactsInjected => ({
      loadImage: createScienceImageLoader(ctx.sessions, sessionId),
      openArtifact: () => { ctx.conversation.openDetailsView(sessionId, SCIENCE_DETAILS_ID) },
    }),
  }, ScienceTurnArtifacts))

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

  ctx.effect(() => ctx.conversation.registerTranscriptDetailVisibility(createTranscriptDetailVisibilitySource(ctx)),
    'ui-science: transcript process-detail visibility')

  // Registration-time text reads through the bound translator; components
  // read the standard `t` seat instead.
  const t = ctx.locale.bind(NS)
  ctx.conversationEvents.registerUserInput('science-edit', (message) => {
    const source = message.source
    if (source.kind !== 'science-edit') throw new Error('Science input requires a science-edit source')
    return {
      content: [{ type: 'text', text: source.instruction }, ...message.content.filter(block => block.type === 'image')],
      references: source.targets.map(({ logicalName, version, target, comment }) => {
        const label = target.kind === 'element'
          ? scienceElementLabel(target.elementKind, target.label, t,
            target.elementId.startsWith('axes[') && target.axes !== null ? target.axes + 1 : undefined, target.current, target.elementId)
          : t('edit.regionTarget', { x: Math.round(target.x * 100), y: Math.round(target.y * 100) })
        return `${logicalName} v${String(version)} · ${label}${comment ? `: ${comment}` : ''}`
      }),
    }
  })
  ctx.effect(() => ctx.trajectorySubviews.registerVisibility('process', createTraceVisibilitySource(ctx)),
    'ui-science: process visibility')
  ctx.slots.inject('trajectory.view', () => ctx.slots.register({
    name: 'trajectory.view', id: 'process', order: 0, label: () => t('trace.view'), locale: NS,
    store: scienceSelectionStore,
    inject: (sessionId: SessionId): ScienceTraceInjected => ({
      openArtifact: () => { ctx.conversation.openDetailsView(sessionId, SCIENCE_DETAILS_ID) },
    }),
  }, ScienceTraceView))
  ctx.slots.inject('conversation.details.view', () => ctx.slots.register({
    name: 'conversation.details.view',
    id: SCIENCE_DETAILS_ID,
    order: 10,
    label: '',
    // The default Details entry for any current Session (blank or Science-
    // unbound included): the artifact library it renders is the one Details
    // surface product-wide, so it is what shows without an explicit selection.
    primary: true,
    locale: NS,
    store: scienceSelectionStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof scienceSelectionStore>): ScienceDetailsInjected => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`science details: session ${sessionId} is unavailable`)
      // Bind this session's "return to library" action for the sidebar
      // destination (see `libraryReturners` above) while this entry — this
      // exact live store instance — is resolved.
      ctx.effect(() => {
        const returnToLibrary = (): void => {
          actions.showLibrary()
          actions.setLibraryPage('artifacts')
        }
        libraryReturners.set(sessionId, returnToLibrary)
        return () => {
          if (libraryReturners.get(sessionId) === returnToLibrary) libraryReturners.delete(sessionId)
        }
      }, `ui-science: library-return binding for ${sessionId}`)
      return {
        loadImage: createScienceImageLoader(ctx.sessions, sessionId),
        loadText: createScienceTextLoader(ctx.sessions, sessionId),
        loadLibrary: () => binding.session.readScienceLibrary(),
        loadWorkspaceFiles: path => binding.session.readWorkspaceFiles(path),
        loadWorkspaceFile: path => binding.session.readWorkspaceFile(path),
        addToConversation: (targets) => { composerSelections.add(sessionId, targets) },
        removeFromConversation: (target) => { composerSelections.removeSelection(sessionId, target) },
        composerSelections: composerSelections.store(sessionId),
        returnToConversation: (anchorKey) => { ctx.conversation.openChatAt(sessionId, anchorKey) },
        selectDetailed: () => { ctx.trajectorySubviews.select(sessionId, 'detailed') },
        addArtifactNote: request => ctx.remote.scienceEdits.addArtifactNote(sessionId, request),
        removeArtifactNote: request => ctx.remote.scienceEdits.removeArtifactNote(sessionId, request),
        applyChartOps: request => ctx.remote.scienceEdits.applyChartOps(sessionId, request),
        previewChartOps: request => ctx.remote.scienceEdits.previewChartOps(sessionId, request),
      }
    },
  }, ScienceDetailsView))
  ctx.slots.inject('conversation.details.header.tabs', () => ctx.slots.register({
    name: 'conversation.details.header.tabs', key: SCIENCE_DETAILS_ID, locale: NS,
    store: scienceSelectionStore,
  }, ScienceDetailsTabs))
  ctx.slots.inject('conversation.details.header.actions', () => ctx.slots.register({
    name: 'conversation.details.header.actions', key: SCIENCE_DETAILS_ID, locale: NS,
    store: scienceSelectionStore,
  }, ScienceDetailsHeader))
}
