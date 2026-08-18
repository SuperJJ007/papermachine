// Science Details entry: the artifact panel over the accepted client-safe
// `science` Session projection (packages/science/science-session/src/types.ts).
// Renders a client-safe environment strip, ordered run history, an artifact
// gallery (one entry per logical chart at its latest version), an artifact
// detail with a version rail walking every durable version of the selected
// chart, and the latest Outcome with its evidence references. It builds no
// second projection reader, chart store, or Outcome editor; the one piece of
// local state it owns is the shared ui-science selection store
// (selection-store.ts), keyed on `{ chartId, version }`. Thumbnails load
// through this package's own session-scoped loader
// (science-attachment-loader.ts). The environment section never reports
// capability from configuration alone: a revision whose `status` is not
// `'applied'` (absent binding, `'invalid'`, or `'drifted'`) renders the same
// "failed" text regardless of which of those three applies, so no state can
// read as "Runtime ready" on a merely configured prefix.

import { useEffect, useState } from 'react'
import { ImageLightbox, MessageImage, type ImageLoader, type MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import { IconChevronLeftOutline14, MarkdownText, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.details.view).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: merges the `science` key into SessionProjectionMap for useProjection.
import type {
  ScienceChartId, ScienceClientChartVersion, ScienceClientEnvironmentBinding, ScienceClientInterpreterBinding,
  ScienceClientOutcomePublication, ScienceClientRun,
  ScienceEvidenceRef, ScienceInterpreterCapability, ScienceLanguage,
} from '@deepseek-ai/dsh-science-session/types'
import type { ScienceArtifactSelection, ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceDetailsView.module.css'

/** Business face this entry's registration injects. */
export interface ScienceDetailsInjected {
  /** Session-scoped chart-thumbnail loader (science-attachment-loader.ts). */
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

const LANGUAGE_KEY: Record<ScienceLanguage, 'details.language.python' | 'details.language.r'> = {
  python: 'details.language.python',
  r: 'details.language.r',
}

function capabilityText(capability: ScienceInterpreterCapability, t: TranslateNS<'science'>): string {
  switch (capability) {
    case 'available': return t('details.capability.available')
    case 'unavailable': return t('details.capability.unavailable')
    case 'invalid': return t('details.capability.invalid')
    case 'drifted': return t('details.capability.drifted')
    /* v8 ignore next -- closed capability union */
    default: return assertNever(capability)
  }
}

function runStatusText(status: ScienceClientRun['status'], t: TranslateNS<'science'>): string {
  switch (status) {
    case 'running': return t('details.run.status.running')
    case 'success': return t('details.run.status.success')
    case 'failed': return t('details.run.status.failed')
    case 'timed-out': return t('details.run.status.timedOut')
    case 'cancelled': return t('details.run.status.cancelled')
    case 'interrupted': return t('details.run.status.interrupted')
    /* v8 ignore next -- closed run-status union */
    default: return assertNever(status)
  }
}

function runDotState(status: ScienceClientRun['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'success': return 'done'
    case 'failed': return 'error'
    case 'timed-out':
    case 'cancelled':
    case 'interrupted':
      return 'warning'
    /* v8 ignore next -- closed run-status union */
    default: return assertNever(status)
  }
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

/** Browser-locale timestamp; no fixed format is imposed on the reader's Intl settings. */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

/** Latest accepted version per logical chart, in first-appearance (commit) order. */
function latestCharts(charts: readonly ScienceClientChartVersion[]): ScienceClientChartVersion[] {
  const byId = new Map<string, ScienceClientChartVersion>()
  for (const chart of charts) {
    const current = byId.get(chart.chartId)
    if (current === undefined || chart.version > current.version) byId.set(chart.chartId, chart)
  }
  return [...byId.values()]
}

/** Every durable version of one logical chart, ascending — the version rail's walk order. */
function versionsOf(charts: readonly ScienceClientChartVersion[], chartId: ScienceChartId): ScienceClientChartVersion[] {
  return charts.filter(chart => chart.chartId === chartId).sort((left, right) => left.version - right.version)
}

function InterpreterRow({ language, binding, t }: {
  language: ScienceLanguage
  binding: ScienceClientInterpreterBinding
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.environmentRow}>
      <span className={css.environmentLanguage}>{t(LANGUAGE_KEY[language])}</span>
      <span>{capabilityText(binding.capability, t)}</span>
      {binding.languageVersion !== undefined
        && <span>{t('details.environment.languageVersion', { version: binding.languageVersion })}</span>}
      {binding.fingerprintPreview !== undefined
        && <span className={css.fingerprint}>{t('details.environment.fingerprint', { preview: binding.fingerprintPreview })}</span>}
      {binding.packages !== undefined
        && <span>{t('details.environment.packageCount', { count: binding.packages.length })}</span>}
    </div>
  )
}

function EnvironmentSection({ environment, t }: {
  environment: ScienceClientEnvironmentBinding | null
  t: TranslateNS<'science'>
}) {
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('details.environment.title')}</div>
      {environment === null || environment.status !== 'applied'
        ? <p className={css.notice} role="status">{t('details.environment.failed')}</p>
        : (
          <div className={css.environmentBody}>
            <div className={css.environmentRow}>
              <span>{t('details.environment.profile', { profile: environment.profileId })}</span>
              <span>{t('details.environment.revision', { revision: environment.revision })}</span>
            </div>
            {environment.python !== undefined && <InterpreterRow language="python" binding={environment.python} t={t} />}
            {environment.r !== undefined && <InterpreterRow language="r" binding={environment.r} t={t} />}
          </div>
        )}
    </section>
  )
}

function RunsSection({ runs, t }: { runs: readonly ScienceClientRun[]; t: TranslateNS<'science'> }) {
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('details.runs.title')}</div>
      {runs.length === 0
        ? <p className={css.notice} role="status">{t('details.runs.empty')}</p>
        : (
          <ul className={css.runList}>
            {runs.map(run => (
              <li key={run.runId} className={css.runRow}>
                <StateDot state={runDotState(run.status)} />
                <span className={css.runLanguage}>{t(LANGUAGE_KEY[run.language])}</span>
                <span className={css.runStatus}>{runStatusText(run.status, t)}</span>
                <span className={css.runTime}>{formatTime(run.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
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

/**
 * The header-triggered lightbox: a second, store-driven `ImageLightbox`
 * instance alongside the detail image's own click-to-open `MessageImage`
 * lightbox. `conversation.details.header.actions`' "expand" button
 * (ScienceArtifactHeaderActions.tsx) lives in a sibling render tree with no
 * access to `MessageImage`'s private open state, so it opens this shared
 * store's `lightboxOpen` flag instead; this component resolves the same
 * durable attachment through the same loader when that flag flips.
 */
function HeaderTriggeredLightbox({ chart, loadImage, open, onClose, t }: {
  chart: ScienceClientChartVersion
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

function VersionRail({ versions, selected, onSelect, t }: {
  versions: readonly ScienceClientChartVersion[]
  selected: number
  onSelect: (version: number) => void
  t: TranslateNS<'science'>
}) {
  return (
    <ul className={css.versionRail} aria-label={t('details.artifact.versionRail')}>
      {versions.map(version => (
        <li key={version.version}>
          <button
            type="button"
            className={css.versionItem}
            aria-current={version.version === selected || undefined}
            onClick={() => { onSelect(version.version) }}
          >
            {t('chart.version', { version: version.version })}
          </button>
        </li>
      ))}
    </ul>
  )
}

function ArtifactDetail({ chart, versions, loadImage, useStore, actions, t }: {
  chart: ScienceClientChartVersion
  versions: readonly ScienceClientChartVersion[]
  loadImage: ImageLoader
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  t: TranslateNS<'science'>
}) {
  const lightboxOpen = useStore(s => s.lightboxOpen)
  return (
    <div className={css.detail}>
      <button type="button" className={css.detailBack} onClick={() => { actions.select(null) }}>
        <IconChevronLeftOutline14 size={12} />
        {t('details.artifact.backToGallery')}
      </button>
      <MessageImage attachment={chart.attachment} load={loadImage} variant="single" labels={chartImageLabels(t)} />
      <HeaderTriggeredLightbox
        chart={chart}
        loadImage={loadImage}
        open={lightboxOpen}
        onClose={() => { actions.setLightboxOpen(false) }}
        t={t}
      />
      <div className={css.detailMeta}>
        <span className={css.chartTitle}>{chart.title}</span>
        <span className={css.badge}>{t('chart.version', { version: chart.version })}</span>
      </div>
      {chart.caption !== undefined && <p className={css.caption}>{chart.caption}</p>}
      <div className={css.detailFacts}>
        <span>{t('chart.sourceRun', { runId: chart.runId })}</span>
        <span>{t('chart.dimensions', { width: chart.attachment.width, height: chart.attachment.height, size: formatBytes(chart.attachment.bytes) })}</span>
      </div>
      <VersionRail
        versions={versions}
        selected={chart.version}
        onSelect={(version) => { actions.select({ chartId: chart.chartId, version }) }}
        t={t}
      />
    </div>
  )
}

/** Human-readable byte count, matching the compact style used elsewhere in the transcript. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ArtifactGallery({ charts, loadImage, onSelect, t }: {
  charts: readonly ScienceClientChartVersion[]
  loadImage: ImageLoader
  onSelect: (selection: ScienceArtifactSelection) => void
  t: TranslateNS<'science'>
}) {
  const latest = latestCharts(charts)
  if (latest.length === 0) return <p className={css.notice} role="status">{t('details.charts.empty')}</p>
  return (
    <ul className={css.chartList}>
      {latest.map(chart => (
        <li key={chart.chartId} className={css.chartItem}>
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
            onClick={() => { onSelect({ chartId: chart.chartId, version: chart.version }) }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onSelect({ chartId: chart.chartId, version: chart.version })
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

function ArtifactsSection(props: {
  charts: readonly ScienceClientChartVersion[]
  loadImage: ImageLoader
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  t: TranslateNS<'science'>
}) {
  const { charts, loadImage, useStore, actions, t } = props
  const selected = useStore(s => s.selected)
  const selectedChart = selected === null ? undefined
    : charts.find(chart => chart.chartId === selected.chartId && chart.version === selected.version)

  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('details.charts.title')}</div>
      {selected !== null && selectedChart !== undefined
        ? (
          <ArtifactDetail
            chart={selectedChart}
            versions={versionsOf(charts, selectedChart.chartId)}
            loadImage={loadImage}
            useStore={useStore}
            actions={actions}
            t={t}
          />
        )
        : <ArtifactGallery charts={charts} loadImage={loadImage} onSelect={(selection) => { actions.select(selection) }} t={t} />}
    </section>
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

/**
 * Render the Science Details entry (the artifact panel) from the current
 * `science` projection and the shared selection store.
 * @param props - runtime slot currency, the injected loader, the shared selection store, and the science locale seat.
 * @returns the current-state Science surface for this session.
 */
export function ScienceDetailsView({ sessionId, useSessions, useProjection, useStore, actions, loadImage, t }: ScienceDetailsViewProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const science = useProjection('science')

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
    <div className={css.body}>
      <EnvironmentSection environment={science.environment} t={t} />
      <RunsSection runs={science.runs} t={t} />
      <ArtifactsSection charts={science.charts} loadImage={loadImage} useStore={useStore} actions={actions} t={t} />
      <OutcomeSection outcome={science.outcome} t={t} />
    </div>
  )
}
