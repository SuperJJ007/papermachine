/** Science UI assembled through public Sidebar, Conversation and generated Remote services. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-science-session/types'
import { ScienceDetailsView, type ScienceDetailsInjected } from './ScienceDetailsView.tsx'
import { ScienceLibrary } from './ScienceLibrary.tsx'
import { scienceEditMessageDefinition } from './science-edit-message.ts'
import { ScienceLibraryAction, ScienceArtifactTitle, ScienceArtifactMenu, ScienceLibraryFooter, ScienceLibraryTitle } from './sidebar-entries.tsx'
import { ScienceAnnotationRow } from './ScienceAnnotationRow.tsx'
import { ScienceExecutionRow } from './ScienceExecutionRow.tsx'
import { ScienceOutcomeRow } from './ScienceOutcomeRow.tsx'
import { ScienceTurnArtifacts } from './ScienceTurnArtifacts.tsx'
import { ScienceTraceView } from './ScienceTraceView.tsx'
import { ScienceKernelStatus } from './ScienceKernelStatus.tsx'
import { ScienceSettingsCard } from './ScienceSettingsCard.tsx'
import { ScienceComposerDock } from './ScienceComposerDock.tsx'
import { ScienceComposerSelections } from './composer-selections.ts'
import { createScienceSelectionStore } from './selection-store.ts'
import { createScienceImageUrlLoader, createScienceTextUrlLoader } from './science-artifact-url-loader.ts'
import { createScienceChartStateLoader } from './science-chart-state-loader.ts'
import { createLoadScienceVersions } from './version-summaries.ts'
import { scienceTurnArtifactsDefinition, selectScienceTurnArtifacts } from './science-turn-artifacts.ts'
import { SCIENCE_RUNTIME_NS, ScienceSettingsCardController, type ScienceRuntimeSettingsSection } from './settings-card-controller.ts'
import { en, zh, NS, type ScienceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { science: ScienceKey }
  interface ResourceProtocolMap { 'science-artifact': { readonly artifactId: string } }
}
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap { 'science-artifact': { readonly version?: number } }
}

/** Services required for the complete Science browser composition. */
export const inject = ['slots', 'locale', 'remote', 'remote.science', 'remote.scienceEdits', 'connection', 'sessions', 'conversation', 'uiConversation', 'settingsScope', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs', 'resources']

/** @param ctx - Browser plugin context. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'science: dictionaries')
  const t = ctx.locale.bind(NS)
  const store = createScienceSelectionStore()
  const selections = new ScienceComposerSelections()
  const openArtifact = (id: SessionId) => (selection: { artifactId: string; version: number }): void => {
    ctx.sidebarRight.openResourceIn(id, `dsh-resource://science-artifact/${encodeURIComponent(selection.artifactId)}`, { params: { version: selection.version } })
  }
  ctx.uiConversation.events.register(scienceTurnArtifactsDefinition)
  ctx.effect(() => {
    let dispose = ctx.uiConversation.events.register(scienceEditMessageDefinition(t))
    const unsubscribe = ctx.locale.subscribe(() => {
      dispose()
      dispose = ctx.uiConversation.events.register(scienceEditMessageDefinition(t))
    })
    return () => { unsubscribe(); dispose() }
  }, 'science: localized edit messages')
  ctx.effect(() => ctx.resources.register({
    protocol: 'science-artifact',
    async *open(address) {
      yield Promise.resolve({ ok: true as const, value: { artifactId: decodeURIComponent(new URL(address).pathname.slice(1)) } })
    },
  }), 'science: artifact resource identity')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: 'science-artifact', kind: 'science-artifact', patterns: ['dsh-resource://science-artifact/*'],
    title: () => t('artifact.title'),
  }), 'science: artifact tab type')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: 'science-library', kind: 'science-library',
    title: () => t('library.home'),
    guide: [{ order: 0, title: () => t('library.home') }],
  }), 'science: library page type')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: 'science-artifact', locale: NS, store,
    inject: (id): ScienceDetailsInjected => ({
      loadImage: createScienceImageUrlLoader(id), loadText: createScienceTextUrlLoader(id),
      loadChartState: createScienceChartStateLoader(ctx.remote, id), loadVersions: createLoadScienceVersions(ctx.remote, id),
      loadLibrary: () => ctx.remote.science.scienceLibrary(id),
      addToConversation: (targets) => { selections.add(id, targets) },
      removeFromConversation: (target) => { selections.removeSelection(id, target) },
      hooks: { composerSelections: selections.store(id) },
      returnToConversation: (focus) => { ctx.conversation.openView(id, 'chat', focus) },
      inspectCall: (callId) => { ctx.conversation.openView(id, 'trajectory', callId) },
      addArtifactNote: request => ctx.remote.scienceEdits.addArtifactNote(id, request),
      removeArtifactNote: request => ctx.remote.scienceEdits.removeArtifactNote(id, request),
      applyChartOps: request => ctx.remote.scienceEdits.applyChartOps(id, request),
      previewChartOps: request => ctx.remote.scienceEdits.previewChartOps(id, request),
      saveArtifactAs: request => ctx.remote.scienceEdits.saveArtifactAs(id, request),
    }),
  }, ScienceDetailsView))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: 'science-artifact',
    inject: id => ({ loadLibrary: () => ctx.remote.science.scienceLibrary(id) }),
  }, ScienceArtifactTitle))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: 'science-library', locale: NS,
  }, ScienceLibraryTitle))
  ctx.slots.inject('sidebar.right.tab.menu.item', () => ctx.slots.register({
    name: 'sidebar.right.tab.menu.item', id: 'science-library', locale: NS,
    inject: id => ({ openLibrary: () => { ctx.sidebarRight.openTabIn(id, 'science-library') } }),
  }, ScienceArtifactMenu))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: 'science-library', locale: NS, store,
    inject: id => ({ loadLibrary: () => ctx.remote.science.scienceLibrary(id), loadImage: createScienceImageUrlLoader(id) }),
  }, ScienceLibrary))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'science-library', locale: NS,
    inject: () => ({ openLibrary: (id: SessionId) => { ctx.uiWorkspace.openSession(id); ctx.sidebarRight.openTabIn(id, 'science-library') } }),
  }, ScienceLibraryFooter))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'science-library', locale: NS,
    inject: id => ({ openLibrary: () => { ctx.sidebarRight.openTabIn(id, 'science-library') } }),
  }, ScienceLibraryAction))
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'annotate_artifact', locale: NS }, ScienceAnnotationRow)
    for (const key of ['run_python', 'run_r']) yield ctx.slots.register({
      name: 'tool.call.toolview', key, locale: NS,
      inject: (id: SessionId) => ({ cancel: () => { void ctx.remote.session.cancel({ sessionId: id }) } }),
    }, ScienceExecutionRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'publish_outcome', locale: NS,
      inject: id => ({ loadScienceImage: createScienceImageUrlLoader(id), loadVersions: createLoadScienceVersions(ctx.remote, id) }),
    }, ScienceOutcomeRow)
  })
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', select: selectScienceTurnArtifacts, locale: NS, store,
    inject: id => ({ loadImage: createScienceImageUrlLoader(id), openArtifact: openArtifact(id) }),
  }, ScienceTurnArtifacts))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'science', order: 20, label: () => t('trace.view'), locale: NS, store,
    inject: id => ({ openArtifact: openArtifact(id), loadVersions: createLoadScienceVersions(ctx.remote, id) }),
  }, ScienceTraceView))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'science-targets', locale: NS,
    inject: id => ({ hooks: { targets: selections.store(id) }, remove: (index: number) => { selections.remove(id, index) } }),
  }, ScienceComposerDock))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'science-kernels', locale: NS }, ScienceKernelStatus))
  ctx.effect(() => ctx.conversation.registerSubmissionHandler((submission) => {
    const targets = selections.store(submission.sessionId).getSnapshot()
    if (targets.length === 0) return undefined
    if (submission.attachmentIds.length > 0) return Promise.resolve({ kind: 'error', text: t('edit.imagesUnsupported') })
    return ctx.remote.scienceEdits.submit(submission.sessionId, { targets, instruction: submission.text }).then((result) => {
      if (!result.ok) return { kind: 'error' as const, text: result.error.message }
      selections.clear(submission.sessionId)
      return { kind: 'success' as const }
    })
  }), 'science: edit submission')
  const settingsScope = ctx.settingsScope.bind<ScienceRuntimeSettingsSection>({ namespace: SCIENCE_RUNTIME_NS })
  const settings = new ScienceSettingsCardController(settingsScope)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: SCIENCE_RUNTIME_NS, locale: NS, inject: () => settings.inject(),
  }, ScienceSettingsCard))
}
