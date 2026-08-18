// Science Details entry: the artifact viewer over the accepted client-safe
// `science` Session projection (packages/science/science-session/src/types.ts).
// Viewer-first, not a dashboard: a top tab strip holds one tab per opened
// artifact (logical chart); the active tab shows an in-panel toolbar
// (filename, version stepper, provenance, download, maximize, close tab)
// above the dispatched content, or — one toolbar click away — the
// provenance drill-in (ScienceArtifactProvenance.tsx). With no open tabs the
// panel shows the landing view: a gallery of latest chart versions (opening
// one opens its tab) plus the latest Outcome, kept reachable but secondary
// below the gallery rather than as its own tab, since it carries no version
// history or provenance of its own to navigate. It builds no second
// projection reader, chart store, or Outcome editor; the one piece of local
// state it owns is the shared ui-science selection store
// (selection-store.ts). Thumbnails and content load through this package's
// own session-scoped loader (science-attachment-loader.ts).
//
// The former resident Environment strip and Runs list are gone: Environment
// facts now live only in the provenance drill-in's Environment sub-tab, per
// artifact version (README "Design notes" explains why no session-wide
// "not applied" notice replaces them). The top-level missing-support/unbound
// states below are unrelated to that strip and are unchanged.

import { useEffect, useState } from 'react'
import { ImageLightbox, MessageImage, type ImageLoader, type MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseFill14, IconCloseOutline16,
  IconDownloadOutline16, IconFullscreenOutline16, IconInspectOutline12, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.details.view,
// and its owner share's inspectCall).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ScienceArtifactId, ScienceClientArtifactVersion, ScienceClientOutcomePublication, ScienceClientProjection,
  ScienceEvidenceRef,
} from '@deepseek-ai/dsh-science-session/types'
import { ScienceArtifactProvenance } from './ScienceArtifactProvenance.tsx'
import type { ScienceArtifactView, ScienceOpenArtifact, ScienceProvenanceSubTab, ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceDetailsView.module.css'

/** Business face this entry's registration injects. */
export interface ScienceDetailsInjected {
  /** Session-scoped chart-thumbnail/content loader (science-attachment-loader.ts). */
  loadImage: ImageLoader
}

/** Full props for the Science Details entry. */
export type ScienceDetailsViewProps =
  PropsRuntime<'conversation.details.view'> & InjectFace<ScienceDetailsInjected>
  & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** Closed-union exhaustiveness fence. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

function evidenceText(item: ScienceEvidenceRef, t: TranslateNS<'science'>): string {
  switch (item.kind) {
    case 'run': return t('outcome.evidenceRun', { runId: item.runId })
    case 'chart': return t('outcome.evidenceChart', { chartId: item.chartId, version: item.version })
    case 'message': return t('outcome.evidenceMessage', { seq: item.seq })
    /* v8 ignore next -- closed evidence-kind union */
    default: return assertNever(item)
  }
}

/** Latest accepted version per logical chart, in first-appearance (commit) order. */
function latestCharts(charts: readonly ScienceClientArtifactVersion[]): ScienceClientArtifactVersion[] {
  const byId = new Map<string, ScienceClientArtifactVersion>()
  for (const chart of charts) {
    const current = byId.get(chart.artifactId)
    if (current === undefined || chart.version > current.version) byId.set(chart.artifactId, chart)
  }
  return [...byId.values()]
}

/** Every durable version of one logical chart, ascending — the version stepper's walk order. */
function versionsOf(charts: readonly ScienceClientArtifactVersion[], chartId: ScienceArtifactId): ScienceClientArtifactVersion[] {
  return charts.filter(chart => chart.artifactId === chartId).sort((left, right) => left.version - right.version)
}

/** Human-readable byte count, matching the compact style used elsewhere in the transcript. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function chartImageLabels(t: TranslateNS<'science'>): MessageImageLabels {
  return {
    image: t('chart.title'),
    open: t('chart.open'),
    openNamed: label => t('chart.openNamed', { label }),
    loading: t('chart.loading'),
    loadFailed: t('chart.loadFailed'),
    lightbox: { dialog: t('chart.lightboxOriginal'), close: t('chart.lightboxClose') },
  }
}

/** Trigger a browser save of the durable bytes behind one artifact version through a throwaway `data:`-URI anchor. */
async function downloadChart(chart: ScienceClientArtifactVersion, loadImage: ImageLoader): Promise<void> {
  const url = await loadImage(chart.attachment)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = chart.attachment.name ?? `${chart.logicalName}-v${String(chart.version)}.png`
  anchor.click()
}

/**
 * The toolbar-triggered lightbox: a second, store-driven `ImageLightbox`
 * instance alongside the content image's own click-to-open `MessageImage`
 * lightbox. The toolbar's "maximize" button is a sibling of that image with
 * no access to its private open state, so it opens this shared store's
 * `lightboxOpen` flag instead; this component resolves the same durable
 * attachment through the same loader when that flag flips. A load that
 * rejects (or resolves after the flag already closed) renders nothing — the
 * same silent-degrade the thumbnail's own retry control covers for the
 * ordinary click-to-open path.
 */
function ArtifactLightbox({ chart, loadImage, open, onClose, t }: {
  chart: ScienceClientArtifactVersion
  loadImage: ImageLoader
  open: boolean
  onClose: () => void
  t: TranslateNS<'science'>
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setSrc(null); return }
    let live = true
    void loadImage(chart.attachment).then((url) => { if (live) setSrc(url) }).catch(() => {})
    return () => { live = false }
  }, [open, chart.attachment, loadImage])

  if (!open || src === null) return null
  return (
    <ImageLightbox
      src={src}
      alt={chart.attachment.name ?? t('chart.title')}
      labels={{ dialog: t('chart.lightboxOriginal'), close: t('chart.lightboxClose') }}
      onClose={onClose}
    />
  )
}

/**
 * Content renderer dispatch, keyed by durable attachment media type — the
 * seam a later non-image artifact phase extends without touching the tab
 * strip or toolbar.
 */
function ArtifactContent({ chart, loadImage, t }: {
  chart: ScienceClientArtifactVersion
  loadImage: ImageLoader
  t: TranslateNS<'science'>
}) {
  switch (chart.attachment.mediaType) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return (
        <div className={css.content}>
          <MessageImage attachment={chart.attachment} load={loadImage} variant="single" labels={chartImageLabels(t)} />
          {chart.caption !== undefined && <p className={css.caption}>{chart.caption}</p>}
          <div className={css.contentFacts}>
            <span>{t('chart.sourceRun', { runId: chart.runId })}</span>
            <span>
              {t('chart.dimensions', {
                width: chart.attachment.width, height: chart.attachment.height, size: formatBytes(chart.attachment.bytes),
              })}
            </span>
          </div>
        </div>
      )
    /* v8 ignore next -- closed ImageMediaType union; every current member renders as an image */
    default: return assertNever(chart.attachment.mediaType)
  }
}

function ArtifactToolbar({ chart, versions, onStepVersion, onOpenProvenance, onMaximize, onCloseTab, loadImage, t }: {
  chart: ScienceClientArtifactVersion
  versions: readonly ScienceClientArtifactVersion[]
  onStepVersion: (version: number) => void
  onOpenProvenance: () => void
  onMaximize: () => void
  onCloseTab: () => void
  loadImage: ImageLoader
  t: TranslateNS<'science'>
}) {
  // `chart` is always one of `versions` (the caller resolves it from the same
  // chartId's version list), so `index` is never -1 — no defensive branch for it.
  const index = versions.findIndex(candidate => candidate.version === chart.version)
  const prev = index > 0 ? versions[index - 1] : undefined
  const next = index < versions.length - 1 ? versions[index + 1] : undefined

  return (
    <div className={css.toolbar}>
      <div className={css.toolbarTitle}>
        <span className={css.chartTitle}>{chart.title}</span>
        <span className={css.chartLogicalName}>{chart.logicalName}</span>
      </div>
      <div className={css.toolbarControls}>
        <div className={css.stepper}>
          <button
            type="button" className={css.stepperButton} disabled={prev === undefined}
            aria-label={t('toolbar.versionPrev')}
            // `disabled` already blocks activation at the boundary; omitting
            // the handler entirely (rather than a no-op runtime guard) keeps
            // every branch here reachable by a real click.
            onClick={prev === undefined ? undefined : () => { onStepVersion(prev.version) }}
          >
            <IconChevronLeftOutline14 size={12} />
          </button>
          <span className={css.stepperLabel}>{t('chart.version', { version: chart.version })}</span>
          <button
            type="button" className={css.stepperButton} disabled={next === undefined}
            aria-label={t('toolbar.versionNext')}
            onClick={next === undefined ? undefined : () => { onStepVersion(next.version) }}
          >
            <IconChevronRightOutline14 size={12} />
          </button>
        </div>
        <button type="button" className={css.toolbarAction} aria-label={t('details.artifact.provenance')} onClick={onOpenProvenance}>
          <IconInspectOutline12 size={12} />
        </button>
        <button
          type="button" className={css.toolbarAction} aria-label={t('toolbar.download')}
          onClick={() => { void downloadChart(chart, loadImage).catch(() => {}) }}
        >
          <IconDownloadOutline16 size={14} />
        </button>
        <button type="button" className={css.toolbarAction} aria-label={t('details.artifact.expand')} onClick={onMaximize}>
          <IconFullscreenOutline16 size={14} />
        </button>
        <button type="button" className={css.toolbarAction} aria-label={t('toolbar.closeTab')} onClick={onCloseTab}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
    </div>
  )
}

function TabStrip({ tabs, charts, activeChartId, onActivate, onClose, t }: {
  tabs: readonly ScienceOpenArtifact[]
  charts: readonly ScienceClientArtifactVersion[]
  activeChartId: ScienceArtifactId | null
  onActivate: (chartId: ScienceArtifactId) => void
  onClose: (chartId: ScienceArtifactId) => void
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.tabStrip} role="tablist" aria-label={t('toolbar.openArtifacts')}>
      {tabs.map((tab) => {
        const chart = charts.find(candidate => candidate.artifactId === tab.chartId && candidate.version === tab.version)
        const label = chart?.title ?? tab.chartId
        const active = tab.chartId === activeChartId
        return (
          <div key={tab.chartId} className={active ? `${css.tab} ${css.tabActive}` : css.tab}>
            <button type="button" role="tab" aria-selected={active} className={css.tabButton} onClick={() => { onActivate(tab.chartId) }}>
              {label}
            </button>
            <button
              type="button" className={css.tabClose} aria-label={t('toolbar.closeNamedTab', { title: label })}
              onClick={() => { onClose(tab.chartId) }}
            >
              <IconCloseFill14 size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function ArtifactGallery({ charts, loadImage, onOpen, t }: {
  charts: readonly ScienceClientArtifactVersion[]
  loadImage: ImageLoader
  onOpen: (selection: { chartId: ScienceArtifactId; version: number }) => void
  t: TranslateNS<'science'>
}) {
  const latest = latestCharts(charts)
  if (latest.length === 0) return <p className={css.notice} role="status">{t('details.charts.empty')}</p>
  return (
    <ul className={css.chartList}>
      {latest.map(chart => (
        <li key={chart.artifactId} className={css.chartItem}>
          {/* A real <button> wrapping MessageImage's own thumbnail <button>
              is invalid HTML that also breaks click delivery (a nested
              button swallows clicks meant for its ancestor, even from a
              sibling outside the inner button — proven by this exact
              structure in this package's own tests); a div with a button
              role is the same pattern ScienceChartRow's row uses. */}
          {/* An explicit label: without it this role="button" wrapper's
              accessible name is computed from its contents, which include
              MessageImage's own button — so the wrapper would announce (and
              match by role+name as) whatever state that thumbnail is in. */}
          <div
            className={css.galleryButton}
            role="button"
            aria-label={t('details.artifact.select', { title: chart.title, version: chart.version })}
            tabIndex={0}
            onClick={() => { onOpen({ chartId: chart.artifactId, version: chart.version }) }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onOpen({ chartId: chart.artifactId, version: chart.version })
            }}
          >
            <MessageImage attachment={chart.attachment} load={loadImage} variant="tile" labels={chartImageLabels(t)} />
            <div className={css.chartMeta}>
              <span className={css.chartTitle}>{chart.title}</span>
              <span className={css.chartLogicalName}>{chart.logicalName}</span>
              <span className={css.badge}>{t('chart.version', { version: chart.version })}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function OutcomeSection({ outcome, t }: {
  outcome: ScienceClientOutcomePublication | null
  t: TranslateNS<'science'>
}) {
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('outcome.title')}</div>
      {outcome === null
        ? <p className={css.notice} role="status">{t('details.outcome.empty')}</p>
        : (
          <div className={css.outcomeBody}>
            <div className={css.outcomeHead}>
              <span className={css.outcomeTitle}>{outcome.title}</span>
              <span className={css.badge}>{t('outcome.revision', { revision: outcome.revision })}</span>
            </div>
            <MarkdownText text={outcome.summaryMarkdown} />
            {outcome.evidence.length > 0 && (
              <ul className={css.evidenceList}>
                {outcome.evidence.map((item, index) => <li key={index}>{evidenceText(item, t)}</li>)}
              </ul>
            )}
          </div>
        )}
    </section>
  )
}

/** No open tabs: a gallery of latest chart versions (opening one opens its tab), plus the Outcome kept reachable below it. */
function LandingView({ charts, outcome, loadImage, onOpenTab, t }: {
  charts: readonly ScienceClientArtifactVersion[]
  outcome: ScienceClientOutcomePublication | null
  loadImage: ImageLoader
  onOpenTab: (selection: { chartId: ScienceArtifactId; version: number }) => void
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.landing}>
      <section className={css.section}>
        <div className={css.sectionLabel}>{t('details.charts.title')}</div>
        <ArtifactGallery charts={charts} loadImage={loadImage} onOpen={onOpenTab} t={t} />
      </section>
      <OutcomeSection outcome={outcome} t={t} />
    </div>
  )
}

/** One open tab's body: the toolbar plus dispatched content, or — one toolbar click away — the provenance drill-in. */
function ArtifactTab({ science, chart, view, provenanceSubTab, snapshot, loadImage, useStore, actions, inspectCall, t }: {
  science: ScienceClientProjection
  chart: ScienceClientArtifactVersion
  view: ScienceArtifactView
  provenanceSubTab: ScienceProvenanceSubTab
  snapshot: ConversationSnapshot
  loadImage: ImageLoader
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  inspectCall: (callId: string) => void
  t: TranslateNS<'science'>
}) {
  const lightboxOpen = useStore(s => s.lightboxOpen)
  const versions = versionsOf(science.artifacts, chart.artifactId)

  if (view === 'provenance') {
    const run = science.runs.find(candidate => candidate.runId === chart.runId)
    if (run === undefined) return <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
    return (
      <ScienceArtifactProvenance
        chart={chart}
        run={run}
        environment={science.environment}
        snapshot={snapshot}
        subTab={provenanceSubTab}
        onSubTabChange={(subTab) => { actions.setProvenanceSubTab(subTab) }}
        onBack={() => { actions.setView('content') }}
        inspectCall={inspectCall}
        t={t}
      />
    )
  }

  return (
    <>
      <ArtifactToolbar
        chart={chart}
        versions={versions}
        onStepVersion={(version) => { actions.setTabVersion({ chartId: chart.artifactId, version }) }}
        onOpenProvenance={() => { actions.setView('provenance') }}
        onMaximize={() => { actions.setLightboxOpen(true) }}
        onCloseTab={() => { actions.closeTab(chart.artifactId) }}
        loadImage={loadImage}
        t={t}
      />
      <ArtifactContent chart={chart} loadImage={loadImage} t={t} />
      <ArtifactLightbox chart={chart} loadImage={loadImage} open={lightboxOpen} onClose={() => { actions.setLightboxOpen(false) }} t={t} />
    </>
  )
}

function ArtifactViewer({ science, snapshot, loadImage, useStore, actions, inspectCall, t }: {
  science: ScienceClientProjection
  snapshot: ConversationSnapshot
  loadImage: ImageLoader
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  inspectCall: (callId: string) => void
  t: TranslateNS<'science'>
}) {
  const openArtifacts = useStore(s => s.openArtifacts)
  const activeChartId = useStore(s => s.activeChartId)
  const view = useStore(s => s.view)
  const provenanceSubTab = useStore(s => s.provenanceSubTab)

  // Every selection-store action maintains one invariant
  // (selection-store.client.spec.ts): activeChartId is null iff
  // openArtifacts is empty, otherwise it names an entry in openArtifacts —
  // so `activeTab === undefined` here means exactly "no open tabs", the
  // landing view's gate, without a second, separately-tracked emptiness
  // check on `openArtifacts.length`.
  const activeTab = openArtifacts.find(tab => tab.chartId === activeChartId)
  if (activeTab === undefined) {
    return (
      <div className={css.body}>
        <LandingView
          charts={science.artifacts}
          outcome={science.outcome}
          loadImage={loadImage}
          onOpenTab={(selection) => { actions.openTab(selection) }}
          t={t}
        />
      </div>
    )
  }

  // The one remaining way `activeChart` resolves to undefined is the
  // durable projection not having this exact (chartId, version) pair — a
  // stale tab, handled below as "artifact unavailable".
  const activeChart = science.artifacts.find(candidate =>
    candidate.artifactId === activeTab.chartId && candidate.version === activeTab.version)

  return (
    <div className={css.body}>
      <TabStrip
        tabs={openArtifacts}
        charts={science.artifacts}
        activeChartId={activeChartId}
        onActivate={(chartId) => { actions.activateTab(chartId) }}
        onClose={(chartId) => { actions.closeTab(chartId) }}
        t={t}
      />
      {activeChart === undefined
        ? <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
        : (
          <ArtifactTab
            science={science}
            chart={activeChart}
            view={view}
            provenanceSubTab={provenanceSubTab}
            snapshot={snapshot}
            loadImage={loadImage}
            useStore={useStore}
            actions={actions}
            inspectCall={inspectCall}
            t={t}
          />
        )}
    </div>
  )
}

/**
 * Render the Science Details entry (the artifact viewer) from the current
 * `science` projection and the shared selection store.
 * @param props - runtime slot currency, the injected loader, the shared
 * selection store, the Details-seam jump handoff, and the science locale seat.
 * @returns the current-state Science surface for this session.
 */
export function ScienceDetailsView({
  sessionId, useSessions, useSession, useProjection, useStore, actions, inspectCall, loadImage, t,
}: ScienceDetailsViewProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const science = useProjection('science')
  const snapshot = useSession(s => s)

  if (science === undefined) {
    return (
      <div className={css.body}>
        <p className={css.notice} role="status">{t('details.missingSupport')}</p>
      </div>
    )
  }

  if (science === null) {
    return (
      <div className={css.body}>
        {preset !== undefined && <p className={css.preset}>{t('details.preset', { preset })}</p>}
        <p className={css.notice} role="status">{t('details.unbound')}</p>
      </div>
    )
  }

  return (
    <ArtifactViewer
      science={science} snapshot={snapshot} loadImage={loadImage}
      useStore={useStore} actions={actions} inspectCall={inspectCall} t={t}
    />
  )
}
