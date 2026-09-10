import { ArtifactToolbar, ArtifactLightbox } from './ScienceArtifactToolbar.tsx'
import { ArtifactNotes } from './ScienceArtifactNotes.tsx'
/** Native Science artifact tab body, session projection and exact-version navigation. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceTranscriptSnapshot as ConversationSnapshot } from './ScienceArtifactProvenance.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.details.view,
// and its owner share's inspectCall).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ScienceArtifactId, ScienceArtifactMediaType, ScienceArtifactNote, ScienceArtifactNotesProjection,
  ScienceChartOp, ScienceClientArtifactVersion, ScienceClientProjection, ScienceClientRun,
} from '@deepseek-ai/dsh-science-session/types'
import type {
  ScienceArtifactNoteReceipt, ScienceChartEditReceipt, ScienceChartPreviewReceipt, ScienceEditSelection, ScienceEditTarget,
  ScienceSaveArtifactAsReceipt, ScienceSaveArtifactAsRequest,
} from '@deepseek-ai/dsh-tool-science/types'
import { ArtifactContent } from './ArtifactContent.tsx'
import type { ScienceChartSaveOutcome } from './ScienceChartEditPanel.tsx'
import { ScienceArtifactProvenance } from './ScienceArtifactProvenance.tsx'
import { foldIntermediateVersions } from './intermediate-versions.ts'
import type { ScienceIntermediateVersionFact } from './intermediate-versions.ts'
import type { ScienceLibraryArtifact, ScienceLibraryHealth } from './library-artifact.ts'
import { scienceTabId } from './selection-store.ts'
import type { ScienceArtifactView, ScienceProvenanceSubTab, ScienceSelectionStore } from './selection-store.ts'
import type { ScienceImageLoader, TextLoader } from './science-attachment-loader.ts'
import type { ScienceChartStateLoader } from './science-chart-state-loader.ts'
import type {
  LoadScienceVersions, ScienceRenderableVersion, ScienceStoredRenderableVersion, ScienceVersionSummaryMap,
} from './version-summaries.ts'
import { toRenderableVersion, useScienceVersionSummaries } from './version-summaries.ts'
import css from './ScienceDetailsView.module.css'

/** Business face this entry's registration injects. */
export interface ScienceDetailsInjected {
  /** Session-scoped raw-bytes image artifact loader (science-artifact-url-loader.ts). */
  loadImage: ScienceImageLoader
  /** Session-scoped raw-bytes text artifact loader (science-artifact-url-loader.ts). */
  loadText: TextLoader
  /** Session-scoped live chart-object state reader for one open PNG version (science-chart-state-loader.ts). */
  loadChartState: ScienceChartStateLoader
  /**
   * Batch-read current library facts (title, caption, content origin,
   * media type, byte count, health) for a caller-chosen set of versions
   * (D9 — see `version-summaries.ts`).
   */
  loadVersions: LoadScienceVersions
  /**
   * Read the project-level latest-artifact library, plus store↔session
   * reconciliation health. `health` is declared optional here rather than
   * inherited verbatim from `ISession['readScienceLibrary']`: that
   * injected-runtime type has not yet widened to name it (`dsh-client-runtime`
   * is a different package's territory), but the real Host always includes
   * it — `ISession['readScienceLibrary']`'s narrower return is structurally
   * assignable to this wider local one, so nothing here narrows what the wire
   * actually sends; a build wired against the not-yet-widened runtime type
   * simply reads `health` as possibly `undefined` until that type catches up.
   */
  loadLibrary: () => Promise<RemoteResult<{ projectId: string; artifacts: ScienceLibraryArtifact[]; health?: ScienceLibraryHealth }>>
  /** Add selected artifact elements to the main conversation composer. */
  addToConversation: (targets: readonly ScienceEditSelection[]) => void
  /** Remove one exact target from the main conversation composer. */
  removeFromConversation: (target: ScienceEditSelection) => void
  /** Observable exact targets currently staged in the main composer. */
  hooks: { composerSelections: ObservableSnapshot<readonly ScienceEditSelection[]> }
  inspectCall: (callId: string) => void
  /** Switch to chat and center the generating assistant node. */
  returnToConversation: (anchorKey: string) => void
  /** Select the detailed trajectory subview before inspecting one call. */
  /** Add one user-only note to an exact visible artifact version. */
  addArtifactNote: (request: { artifactId: ScienceArtifactId; version: number; text: string }) => Promise<
    | { readonly ok: true; readonly value: ScienceArtifactNoteReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Remove one active user-only note. */
  removeArtifactNote: (request: { artifactId: ScienceArtifactId; noteSeq: number }) => Promise<
    | { readonly ok: true; readonly value: ScienceArtifactNoteReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Apply deterministic chart operations to one exact chart version through the `applyChartOps` Remote. */
  applyChartOps: (request: { artifactId: ScienceArtifactId; version: number; ops: readonly ScienceChartOp[] }) => Promise<
    | { readonly ok: true; readonly value: ScienceChartEditReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Render deterministic chart operations without committing a version. */
  previewChartOps: (request: { artifactId: ScienceArtifactId; version: number; ops: readonly ScienceChartOp[] }) => Promise<
    | { readonly ok: true; readonly value: ScienceChartPreviewReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Duplicate one committed artifact version into a brand-new logical artifact, through the `saveArtifactAs` Remote. */
  saveArtifactAs: (request: ScienceSaveArtifactAsRequest) => Promise<RemoteResult<ScienceSaveArtifactAsReceipt>>
}

/** Full props for the Science Details entry. */
export type ScienceDetailsViewProps =
  PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<ScienceDetailsInjected>
  & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** Every durable version of one logical artifact, ascending — the version stepper's walk order. */
function versionsOf<T extends ScienceClientArtifactVersion>(artifacts: readonly T[], artifactId: ScienceArtifactId): T[] {
  return artifacts.filter(artifact => artifact.artifactId === artifactId).sort((left, right) => left.version - right.version)
}

/** `ArtifactToolbar`'s default `intermediateVersions`: a single-version stepper (the library preview tab) never folds. */

/** Resolve store-owned producer identity against the current session projection. */
function resolveProducingCall(
  chart: ScienceStoredRenderableVersion,
  science: ScienceClientProjection,
  currentSessionId: SessionId,
): {
  run: ScienceClientRun | undefined
  producingCallId: string | undefined
  sourceSessionTitle: string | undefined
} {
  const producer = chart.producer
  if (producer.sessionId !== currentSessionId) {
    return {
      run: undefined,
      producingCallId: undefined,
      sourceSessionTitle: producer.sessionTitle ?? producer.sessionId,
    }
  }
  const run = science.runs.find(candidate => producer.runId !== undefined
    ? String(candidate.runId) === producer.runId
    : producer.toolCallId !== undefined && String(candidate.toolCallId) === producer.toolCallId)
  return {
    run,
    producingCallId: producer.toolCallId ?? run?.toolCallId,
    sourceSessionTitle: undefined,
  }
}

/**
 * Build the same-turn intermediate-draft fold facts for one artifact's
 * versions (C2). Content origin and producer session/turn all come from the
 * exact store version summary. A version whose summary has not loaded stays
 * walkable instead of being folded on a session-projection guess.
 * @param versions - every version of one artifact, from `versionsOf`.
 * @param summaries - current store facts, keyed by `versionId` (`useScienceVersionSummaries`).
 * @returns the version numbers {@link foldIntermediateVersions} folds out of the stepper's default walk.
 */
function intermediateVersionsOf(
  versions: readonly ScienceClientArtifactVersion[], summaries: ScienceVersionSummaryMap,
): ReadonlySet<number> {
  const facts: ScienceIntermediateVersionFact[] = []
  for (const version of versions) {
    const summary = summaries.get(version.versionId)
    if (summary === undefined) continue
    facts.push({
      version: version.version,
      origin: summary.contentOrigin,
      producerSessionId: summary.producer.sessionId,
      ...(summary.producer.turn === undefined ? {} : { turn: summary.producer.turn }),
    })
  }
  return foldIntermediateVersions(facts)
}

function previewChart(ref: {
  artifactId: string
  logicalName: string
  title: string
  caption?: string
  versionId: string
  version: number
  mediaType: ScienceArtifactMediaType
  byteCount: number
  createdAt: number
}): ScienceRenderableVersion {
  return {
    artifactId: ref.artifactId as ScienceArtifactId, logicalName: ref.logicalName, version: ref.version,
    versionId: ref.versionId, sha256: '', title: ref.title, ...ref.caption === undefined ? {} : { caption: ref.caption },
    mediaType: ref.mediaType, byteCount: ref.byteCount, contentOrigin: 'run-auto', createdAt: ref.createdAt,
  }
}

function ReadOnlyPreview({ chart, loadImage, loadText, t }: {
  chart: ScienceRenderableVersion
  loadImage: ScienceImageLoader
  loadText: TextLoader
  t: TranslateNS<'science'>
}) {
  return <ArtifactContent
    chart={chart} loadImage={loadImage} loadText={loadText} selectionTarget={undefined}
    /* v8 ignore next -- read-only previews deliberately expose an inert selection hook */
    onSelectTarget={() => {}}
    /* v8 ignore next -- read-only previews never stage selection targets */
    isTargetAdded={() => false}
    /* v8 ignore next -- read-only previews have no target comments */
    targetComment={() => ''}
    /* v8 ignore next -- read-only previews cannot add targets */
    onAddTarget={() => {}}
    /* v8 ignore next -- read-only previews cannot remove targets */
    onRemoveTarget={() => {}}
    // A preview's `chart.versionId` is never a genuinely addressable store
    // version (a workspace file's path, or a library row shown outside its
    // own open-tab flow), so the edit panel never mounts here — resolving
    // `null` locally skips a request this build already knows would find
    // nothing to edit.
    /* v8 ignore next -- read-only previews never carry an addressable chart, so this loader is never awaited by a test assertion */
    loadChartState={() => Promise.resolve(null)}
    /* v8 ignore next -- read-only previews never carry an addressable chart, so Save is never invoked */
    onSaveChartOps={() => Promise.resolve({ ok: false, error: '' })}
    t={t}
  />
}

/** Loaders, mutations, and presentation supplied to every artifact tab. */
type ArtifactControls = Pick<ScienceDetailsViewProps,
  | 'loadImage' | 'loadText' | 'loadChartState' | 'addToConversation' | 'removeFromConversation'
  | 'useComposerSelections'
  | 'addArtifactNote' | 'removeArtifactNote' | 'saveArtifactAs' | 'applyChartOps' | 'previewChartOps'
  | 'returnToConversation' | 'inspectCall'
  | 'actions' | 't'>

/**
 * Localize a `saveArtifactAs` RPC failure for the toolbar's inline form.
 * @param code - the Remote failure's stable rejection class.
 * @param t - the Science namespace translator.
 * @returns localized notice text for the save-as form.
 */
function saveAsErrorText(code: string, t: TranslateNS<'science'>): string {
  switch (code) {
    case 'SAVE_AS_SOURCE_NOT_FOUND': return t('toolbar.saveAsSourceNotFound')
    case 'SAVE_AS_NAME_CONFLICT': return t('toolbar.saveAsNameConflict')
    default: return t('toolbar.saveAsFailed')
  }
}

/**
 * Build one `onSaveAs` closure for a toolbar: duplicates the named source
 * version and, on success, switches the active tab to the new artifact's
 * first version — the Files panel picks up the new artifact on its own next
 * mount (it always re-reads `loadLibrary` fresh), so no explicit
 * invalidation signal is needed here.
 * @param saveArtifactAs - the injected `saveArtifactAs` Remote call.
 * @param actions - the selection store's action bag (for `openTab`).
 * @param t - the Science namespace translator.
 * @returns a `(sourceVersionId) => (newLogicalName) => outcome` curried handler.
 */
function createSaveAsHandler(
  saveArtifactAs: ScienceDetailsInjected['saveArtifactAs'],
  actions: ScienceDetailsViewProps['actions'],
  t: TranslateNS<'science'>,
) {
  return (sourceVersionId: string) => (newLogicalName: string): Promise<{ ok: true } | { ok: false; message: string }> =>
    saveArtifactAs({ sourceVersionId, newLogicalName }).then((result) => {
      if (!result.ok) return { ok: false, message: saveAsErrorText(result.error.code, t) }
      actions.openTab({ artifactId: result.value.artifactId, version: result.value.version })
      return { ok: true }
    })
}

/** One open tab's body: the toolbar plus dispatched content, or — one toolbar click away — the provenance drill-in. */
function ArtifactTab({
  currentSessionId, rawArtifacts, summaries, chart, notes, view, science, snapshot, provenanceSubTab,
  loadImage, loadText, loadChartState,
  addToConversation, removeFromConversation, useComposerSelections,
  addArtifactNote, removeArtifactNote, saveArtifactAs, applyChartOps, previewChartOps,
  returnToConversation, inspectCall, actions, t,
}: {
  currentSessionId: SessionId
  /** The session-log identity list, used to derive the stepper's sibling version numbers and their C2 fold facts. */
  rawArtifacts: readonly ScienceClientArtifactVersion[]
  /** Current store facts for every version of `chart`'s artifact, keyed by `versionId` — this tab's own C2 fold input. */
  summaries: ScienceVersionSummaryMap
  chart: ScienceStoredRenderableVersion
  notes: readonly ScienceArtifactNote[]
  view: ScienceArtifactView
  /** The current session's Science projection — the provenance drill-in's run/call read path. */
  science: ScienceClientProjection
  snapshot: ConversationSnapshot
  provenanceSubTab: ScienceProvenanceSubTab
} & ArtifactControls) {
  const versions = versionsOf(rawArtifacts, chart.artifactId)
  const intermediateVersions = intermediateVersionsOf(versions, summaries)
  const saveAs = createSaveAsHandler(saveArtifactAs, actions, t)
  const [target, setTarget] = useState<ScienceEditTarget | undefined>(undefined)
  const [previewSrc, setPreviewSrc] = useState<string>()
  const staged = useComposerSelections(value => value)
  useEffect(() => {
    setTarget(undefined)
    setPreviewSrc(undefined)
  }, [chart.artifactId, chart.version])

  // B4: when the model (or another client) commits a newer version of this
  // exact open tab's artifact WHILE the tab is open, step the tab to it
  // automatically. Tracked against the latest version last observed for this
  // artifactId (not against chart.version, the tab's currently shown
  // version) so opening a tab deliberately at an older version, or the
  // toolbar's own manual stepper walking back through history, never gets
  // yanked forward — only a genuine increase in the known latest triggers
  // this. A chart panel with a pending (unsaved) direct edit reports it
  // through onPendingChartEditsChange below and suppresses this: stepping
  // out from under an in-progress edit would either discard it silently or
  // surface a confusing CHART_STALE_VERSION on Save, and the existing
  // stale-version notice already covers that case once the user does Save.
  const [hasPendingChartEdits, setHasPendingChartEdits] = useState(false)
  // `versions` always includes `chart` itself, so `versions.at(-1)` is never
  // empty in practice; `Math.max` over both stays correct even if that ever
  // stopped holding, with no separate empty-versions fallback to maintain.
  const latestVersion = Math.max(chart.version, ...versions.map(candidate => candidate.version))
  const knownLatest = useRef({ artifactId: chart.artifactId, version: latestVersion })
  useEffect(() => {
    if (knownLatest.current.artifactId !== chart.artifactId) {
      knownLatest.current = { artifactId: chart.artifactId, version: latestVersion }
      return
    }
    if (hasPendingChartEdits) return
    if (latestVersion > knownLatest.current.version) {
      actions.setTabVersion({ artifactId: chart.artifactId, version: latestVersion })
    }
    knownLatest.current = { artifactId: chart.artifactId, version: latestVersion }
  }, [latestVersion, hasPendingChartEdits, chart.artifactId, actions])

  const selectTarget = (next: ScienceEditTarget): void => {
    setTarget(next)
  }
  const selectionFor = (next: ScienceEditTarget): ScienceEditSelection | undefined => staged.find(selection =>
    selection.artifactId === chart.artifactId && selection.version === chart.version
    && JSON.stringify(selection.target) === JSON.stringify(next))

  // Scoped to this exact open tab's artifact/version: a successful apply
  // steps the tab to the committed human-edit version so the viewer renders
  // the kernel's real output, matching the toolbar's own version stepper.
  const saveChartOps = (ops: readonly ScienceChartOp[]): Promise<ScienceChartSaveOutcome> =>
    applyChartOps({ artifactId: chart.artifactId, version: chart.version, ops }).then((result) => {
      if (!result.ok) return { ok: false, error: result.error.message }
      actions.setTabVersion({ artifactId: chart.artifactId, version: result.value.version })
      return { ok: true, failedOps: result.value.failedOps }
    })
  const previewOps = useCallback((ops: readonly ScienceChartOp[]) => previewChartOps({
    artifactId: chart.artifactId, version: chart.version, ops,
  }).then(result => result.ok
    ? { ok: true as const, pngBase64: result.value.pngBase64, failedOps: result.value.failedOps }
    : { ok: false as const, error: result.error.message }), [previewChartOps, chart.artifactId, chart.version])

  if (view === 'provenance') {
    const { run, producingCallId, sourceSessionTitle } = resolveProducingCall(chart, science, currentSessionId)
    return (
      <ScienceArtifactProvenance
        chart={chart}
        run={run}
        producingCallId={producingCallId}
        environment={science.environment}
        snapshot={snapshot}
        subTab={provenanceSubTab}
        onSubTabChange={(subTab) => { actions.setProvenanceSubTab(subTab) }}
        onBack={() => { actions.setView('content') }}
        inspectCall={inspectCall}
        returnToConversation={returnToConversation}
        {...sourceSessionTitle === undefined ? {} : { sourceSessionTitle }}
        t={t}
      />
    )
  }

  return (
    <>
      <ArtifactToolbar
        chart={chart}
        versions={versions}
        intermediateVersions={intermediateVersions}
        onBack={() => { actions.showLibrary() }}
        onStepVersion={(version) => { actions.setTabVersion({ artifactId: chart.artifactId, version }) }}
        onOpenProvenance={() => { actions.setView('provenance') }}
        onMaximize={() => { actions.setLightboxOpen(true) }}
        onCloseTab={() => { actions.closeTab(`artifact:${chart.artifactId}`) }}
        sessionId={currentSessionId}
        onSaveAs={saveAs(chart.versionId)}
        t={t}
      />
      <ArtifactContent
        // Keyed by exact artifact identity: forces a full remount (comment
        // drafts and an in-progress raster
        // drag) on every tab switch or version step, so a typed-but-unstaged
        // comment for one artifact/version never pre-fills another's field
        // that happens to share the same spec path or region coordinates.
        key={`${chart.artifactId}:${String(chart.version)}`}
        chart={chart}
        loadImage={loadImage}
        loadText={loadText}
        loadChartState={loadChartState}
        {...previewSrc === undefined ? {} : { previewSrc }}
        selectionTarget={target}
        onSelectTarget={selectTarget}
        isTargetAdded={next => selectionFor(next) !== undefined}
        targetComment={next => selectionFor(next)?.comment ?? ''}
        onAddTarget={(next, comment) => { addToConversation([{
          artifactId: chart.artifactId,
          logicalName: chart.logicalName,
          version: chart.version,
          target: next,
          ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
        }]) }}
        onRemoveTarget={(next) => {
          const selection = selectionFor(next)
          /* v8 ignore next -- ArtifactContent only offers Remove for a target that is already staged. */
          if (selection !== undefined) removeFromConversation(selection)
        }}
        onSaveChartOps={saveChartOps}
        onPreviewChartOps={previewOps}
        onPreviewSrc={setPreviewSrc}
        onPendingChartEditsChange={setHasPendingChartEdits}
        t={t}
      />
      <ArtifactNotes chart={chart} notes={notes} addArtifactNote={addArtifactNote} removeArtifactNote={removeArtifactNote} t={t} />
    </>
  )
}

function ArtifactViewer({
  science, notes, currentSessionId, snapshot, loadVersions,
  useStore, artifactId, libraryItem, ...controls
}: {
  artifactId: string
  libraryItem: ScienceLibraryArtifact | undefined
  science: ScienceClientProjection
  notes: ScienceArtifactNotesProjection
  currentSessionId: SessionId
  snapshot: ConversationSnapshot
} & ArtifactControls & Pick<ScienceDetailsViewProps, 'loadVersions' | 'useStore'>) {
  const { loadImage, loadText, t } = controls
  const openArtifacts = useStore(s => s.openArtifacts)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const activeTabId = `artifact:${artifactId}`
  const [view, setView] = useState<ScienceArtifactView>('content')
  const [provenanceSubTab, setProvenanceSubTab] = useState<ScienceProvenanceSubTab>('code')
  const actions = { ...controls.actions, setView, setProvenanceSubTab, setLightboxOpen }
  useEffect(() => { setLightboxOpen(false); setView('content') }, [artifactId])
  const artifacts = science.artifacts

  // `showLibrary` deliberately leaves open tabs intact while clearing the
  // active id; every non-null active id still names one open tab.
  const activeTab = openArtifacts.find(tab => scienceTabId(tab) === activeTabId)
  const activeArtifactTab = activeTab?.kind === 'artifact' ? activeTab : undefined
  // A live in-session artifact takes precedence over a same-id/version
  // library preview (matches the previous single-array `.find` order).
  const activeRawArtifact = artifacts.find(candidate =>
    candidate.artifactId === activeArtifactTab?.artifactId && candidate.version === activeArtifactTab.version)
  const activeLibraryItem = activeRawArtifact === undefined && activeArtifactTab !== undefined
    ? libraryItem
    : undefined
  const activeLibraryChart = activeLibraryItem !== undefined
    && activeLibraryItem.latest.ordinal === activeArtifactTab?.version
    ? previewChart({
      artifactId: activeLibraryItem.artifactId,
      logicalName: activeLibraryItem.logicalName,
      title: activeLibraryItem.title ?? activeLibraryItem.logicalName,
      ...(activeLibraryItem.caption === undefined ? {} : { caption: activeLibraryItem.caption }),
      versionId: activeLibraryItem.latest.versionId,
      version: activeLibraryItem.latest.ordinal,
      mediaType: activeLibraryItem.latest.mediaType,
      byteCount: activeLibraryItem.latest.byteCount,
      createdAt: activeLibraryItem.latest.createdAt,
    })
    : undefined
  // D9: current library facts for every version of the active live artifact,
  // batched once per artifact — a Hook, so it runs on every render
  // (including the two early-return branches below) with an empty request
  // while nothing is active.
  const visibleVersionIds = activeRawArtifact === undefined
    ? activeLibraryChart === undefined ? [] : [activeLibraryChart.versionId]
    : versionsOf(artifacts, activeRawArtifact.artifactId).map(version => version.versionId)
  const summaries = useScienceVersionSummaries(loadVersions, visibleVersionIds)
  const renderChart = activeRawArtifact === undefined ? undefined : toRenderableVersion(activeRawArtifact, summaries)
  const activeLibrarySummary = activeLibraryChart === undefined ? undefined : summaries.get(activeLibraryChart.versionId)
  const libraryProvenanceChart = activeLibraryChart === undefined || activeLibrarySummary === undefined
    ? undefined
    : { ...activeLibraryChart, producer: activeLibrarySummary.producer }
  const libraryProvenance = libraryProvenanceChart === undefined
    ? undefined
    : resolveProducingCall(libraryProvenanceChart, science, currentSessionId)
  const saveAs = createSaveAsHandler(controls.saveArtifactAs, actions, t)

  // T3 reconciliation: only a library-opened tab (never a live in-session
  // one) carries a `latest.health` mark at all — see `scienceLibrary`'s
  // response shape (`dsh-host-apiproxy`).
  const libraryContentUnavailable = activeLibraryChart !== undefined
    && libraryItem?.latest.health?.missingContent === true
  const resolvedChart = activeLibraryChart ?? renderChart

  return (
    <div className={css.body}>
      {activeRawArtifact === undefined && activeLibraryChart === undefined
        ? <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
        : activeLibraryChart !== undefined ? (
          view === 'provenance'
            ? libraryProvenanceChart === undefined || libraryProvenance === undefined
              ? <p className={css.notice} role="status">{t('artifact.loading')}</p>
              : <ScienceArtifactProvenance
                chart={libraryProvenanceChart}
                run={libraryProvenance.run}
                producingCallId={libraryProvenance.producingCallId}
                environment={science.environment}
                snapshot={snapshot}
                subTab={provenanceSubTab}
                onSubTabChange={actions.setProvenanceSubTab}
                onBack={() => { actions.setView('content') }}
                inspectCall={controls.inspectCall}
                returnToConversation={controls.returnToConversation}
                {...libraryProvenance.sourceSessionTitle === undefined
                  ? {}
                  : { sourceSessionTitle: libraryProvenance.sourceSessionTitle }}
                t={t}
              />
            : <><ArtifactToolbar chart={activeLibraryChart} versions={[activeLibraryChart]} onBack={() => { actions.showLibrary() }}
              /* v8 ignore next -- the library RPC supplies only the latest version, so both step controls are disabled */
              onStepVersion={() => {}} onOpenProvenance={() => { actions.setView('provenance') }}
              onMaximize={() => { actions.setLightboxOpen(true) }}
              onCloseTab={() => { actions.closeTab(`artifact:${activeLibraryChart.artifactId}`) }}
              sessionId={currentSessionId} onSaveAs={saveAs(activeLibraryChart.versionId)}
              t={t} contentUnavailable={libraryContentUnavailable} />
            {libraryContentUnavailable
              ? <p className={css.notice} role="status">{t('library.reconcile.detailMissingContent')}</p>
              : <ReadOnlyPreview chart={activeLibraryChart} loadImage={loadImage} loadText={loadText} t={t} />}</>
        ) : renderChart === undefined ? (
          <p className={css.notice} role="status">{t('artifact.loading')}</p>
        ) : (
          <ArtifactTab
            currentSessionId={currentSessionId}
            rawArtifacts={artifacts}
            summaries={summaries}
            chart={renderChart}
            notes={notes.filter(note => note.artifactId === renderChart.artifactId)}
            view={view}
            science={science}
            snapshot={snapshot}
            provenanceSubTab={provenanceSubTab}
            {...controls}
            actions={actions}
          />
        )}
      {resolvedChart?.mediaType === 'image/png' && <ArtifactLightbox
        key={resolvedChart.versionId}
        chart={resolvedChart as ScienceRenderableVersion & { mediaType: 'image/png' }}
        loadImage={loadImage} open={lightboxOpen} onClose={() => { actions.setLightboxOpen(false) }} t={t} />}
    </div>
  )
}

/**
 * Client-safe projection rendered for a current Session that has not (yet)
 * bound Science mode (`useProjection('science')` returns `null` — a blank
 * Session, or one where the first `science/mode-bound` event has not
 * appended yet). Every field the artifact library and its viewer read
 * (`artifacts`, `runs`, `kernels`) is empty; `mode`/`environment`/`outcome`/
 * `metrics` are inert placeholders that no Details component under this
 * projection reads — `ArtifactViewer`'s no-tab landing view sources the
 * library entirely from the `loadLibrary` RPC (project-wide, grouped by
 * conversation), independent of this session's own projection.
 */
const EMPTY_SCIENCE_PROJECTION: ScienceClientProjection = {
  mode: { modeId: 'science', presetId: 'science', modeRevision: '' },
  environment: null,
  runs: [],
  kernels: [],
  artifacts: [],
  trace: { turns: [], calls: [] },
  outcome: null,
  metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, kernelCount: 0, outcomeRevision: 0 },
  lastScienceEventSeq: -1,
}

/**
 * Render the Science Details entry (the artifact viewer) from the current
 * `science` projection and the shared selection store.
 * @param props - runtime slot currency, the injected loaders, the shared
 * selection store, the Details-seam jump handoff, and the science locale seat.
 * @returns the current-state Science surface for this session.
 */
export function ScienceDetailsView({
  sessionId, useProjection, useStore, useChat, useTabInfo, actions,
  ...controls
}: ScienceDetailsViewProps) {
  const science = useProjection('science')
  const notes = useProjection('scienceArtifactNotes') ?? []
  const { tab } = useTabInfo()
  const artifactId = decodeURIComponent(new URL(tab.contentId).pathname.slice(1))
  const [libraryItem, setLibraryItem] = useState<ScienceLibraryArtifact>()
  const requested = (tab.navigation.params as { version?: number } | undefined)?.version
  const selected = useStore(state => state.openArtifacts.find(item => item.kind === 'artifact' && item.artifactId === artifactId))
  useEffect(() => {
    if (requested !== undefined) actions.openTab({ artifactId: artifactId as ScienceArtifactId, version: requested })
    let cancelled = false
    setLibraryItem(undefined)
    void controls.loadLibrary().then((result) => {
      if (cancelled || !result.ok) return
      const item = result.value.artifacts.find(item => item.artifactId === artifactId)
      if (item === undefined) return
      setLibraryItem(item)
      if (requested === undefined && selected === undefined) {
        actions.openTab({ artifactId: artifactId as ScienceArtifactId, version: item.latest.ordinal })
      }
    })
    return () => { cancelled = true }
  }, [artifactId, requested, tab.navigation.revision, actions, controls.loadLibrary])
  // The provenance drill-in's Messages sub-tab reads conversation nodes
  // (the generating user/assistant text) and the internal Chat Node index
  // (the producing call's arguments/result) — comparing just `nodes`/`chat`
  // keeps the returned snapshot reference stable across unrelated streaming
  // events (composer, queue, running-call byte updates) instead of on every one.
  const chat = useChat(value => value)
  const snapshot = { ...chat.legacy, chat }


  if (science === undefined) {
    return (
      <div className={css.body}>
        <p className={css.notice} role="status">{controls.t('details.missingSupport')}</p>
      </div>
    )
  }

  return (
    <ArtifactViewer snapshot={snapshot} artifactId={artifactId} libraryItem={libraryItem}
      science={science ?? EMPTY_SCIENCE_PROJECTION} notes={notes} currentSessionId={sessionId}
      useStore={useStore} actions={{ ...actions,
        setTabVersion: (selection) => {
          actions.setTabVersion(selection)
          tab.actions.openResource(tab.contentId, { params: { version: selection.version } })
        },
        showLibrary: () => { tab.actions.openTab('guide') },
        closeTab: (id) => { actions.closeTab(id); tab.actions.close() },
        openTab: (selection) => {
          actions.openTab(selection)
          tab.actions.openResource(`dsh-resource://science-artifact/${encodeURIComponent(selection.artifactId)}`, { params: { version: selection.version } })
        },
      }} {...controls}
    />
  )
}
