// Outcome toolview registrant: the keyed toolview hole for `publish_outcome`.
// Reads the tagged, versioned presentation value from the frozen result
// slice for the published title, Markdown summary, and evidence list; a
// cited chart's thumbnail resolves from the live `science` session
// projection (never from the presentation value itself), so an older
// Outcome row always shows the chart as it exists now, and a missing or
// unavailable projection/attachment reports the gap visibly instead of
// inventing a replacement. A running, failed, stopped, or unrecognized/stale
// presentation falls back to a plain row.

import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment/client'
import { IconGoalOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
// Merges the `science` key into SessionProjectionMap for useProjection.
import type { ScienceClientProjection } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceOutcomeEvidencePresentation, ScienceOutcomePresentation } from '@deepseek-ai/dsh-tool-science/types'
import { ArtifactFileTile } from './ArtifactFileTile.tsx'
import { ScienceArtifactImage } from './ScienceArtifactImage.tsx'
import type { ScienceImageLoader } from './science-attachment-loader.ts'
import css from './ScienceOutcomeRow.module.css'
import { ScienceToolCell } from './ScienceToolCell.tsx'
import {
  scienceToolResultText,
  scienceToolRowState,
} from './ScienceToolFallbackRow.tsx'
import type { LoadScienceVersions, ScienceVersionSummaryMap } from './version-summaries.ts'
import { toRenderableVersion, useScienceVersionSummaries } from './version-summaries.ts'

/** Full row props: the toolview runtime share plus this package's locale seat. */
export interface ScienceOutcomeInjected {
  /** Session-fold-authorized project-store image loader. */
  readonly loadScienceImage: ScienceImageLoader
  /** Batch-read current library facts for the row's cited chart evidence (D9). */
  readonly loadVersions: LoadScienceVersions
}

type ScienceOutcomeRowProps = ToolCallViewProps & PropsLocale<'science'> & InjectFace<ScienceOutcomeInjected>

/** Structurally validate `block.meta` against the exact tagged, versioned shape. */
function parsePresentation(meta: unknown): ScienceOutcomePresentation | null {
  if (typeof meta !== 'object' || meta === null) return null
  const candidate = meta as Record<string, unknown>
  if (candidate.kind !== 'science/outcome' || candidate.version !== 1) return null
  if (typeof candidate.revision !== 'number' || typeof candidate.title !== 'string') return null
  if (typeof candidate.summaryMarkdown !== 'string' || typeof candidate.publishedAt !== 'number') return null
  if (!Array.isArray(candidate.evidence) || !candidate.evidence.every(isEvidenceItem)) return null
  return candidate as unknown as ScienceOutcomePresentation
}

/** Structurally validate one evidence item against the exact tagged union. */
function isEvidenceItem(value: unknown): value is ScienceOutcomeEvidencePresentation {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  if (item.kind === 'run') return typeof item.run_id === 'string'
  if (item.kind === 'chart') return typeof item.chart_id === 'string' && typeof item.version === 'number'
  if (item.kind === 'message') return typeof item.seq === 'number'
  return false
}

/** One evidence row: a text label, plus a resolved chart thumbnail when the citation is a chart. */
function EvidenceItem({ item, science, summaries, loadScienceImage, t }: {
  item: ScienceOutcomeEvidencePresentation
  science: ScienceClientProjection | null | undefined
  summaries: ScienceVersionSummaryMap
  loadScienceImage: ScienceImageLoader
  t: ScienceOutcomeRowProps['t']
}) {
  if (item.kind === 'run') {
    return <li className={css.evidenceItem}>{t('outcome.evidenceRun', { runId: item.run_id })}</li>
  }
  if (item.kind === 'message') {
    return <li className={css.evidenceItem}>{t('outcome.evidenceMessage', { seq: item.seq })}</li>
  }
  const label = t('outcome.evidenceChart', { chartId: item.chart_id, version: item.version })
  const rawArtifact = science?.artifacts.find(candidate =>
    String(candidate.artifactId) === item.chart_id && candidate.version === item.version)
  const chart = rawArtifact === undefined ? undefined : toRenderableVersion(rawArtifact, summaries)
  if (chart === undefined) {
    return (
      <li className={css.evidenceItem}>
        <span>{label}</span>
        <span className={css.chartMissing}>{t('outcome.chartMissing')}</span>
      </li>
    )
  }
  if (chart.mediaType !== 'image/png') {
    return (
      <li className={css.evidenceItem}>
        <span>{label}</span>
        <ArtifactFileTile mediaType={chart.mediaType} />
      </li>
    )
  }
  const labels: MessageImageLabels = {
    image: label,
    open: label,
    openNamed: () => label,
    loading: t('artifact.loading'),
    loadFailed: t('artifact.loadFailed'),
    lightbox: { dialog: t('artifact.lightboxOriginal'), close: t('artifact.lightboxClose') },
  }
  return (
    <li className={css.evidenceItem}>
      <span>{label}</span>
      <ScienceArtifactImage
        content={chart}
        label={label}
        load={loadScienceImage}
        variant="tile"
        labels={labels}
      />
    </li>
  )
}

/**
 * Render one `publish_outcome` call as a durable Outcome card once its
 * tagged presentation settles, or a compact plain row otherwise.
 * @param props - keyed toolview payload plus the science locale seat.
 * @returns the dedicated Outcome row.
 */
export function ScienceOutcomeRow({ block, loadScienceImage, loadVersions, useProjection, inspect, t }: ScienceOutcomeRowProps) {
  const state = scienceToolRowState(block)
  const meta = 'kind' in block ? block.meta : undefined
  const presentation = state === 'ok' ? parsePresentation(meta) : null
  const science = useProjection('science')
  // Batched once per row for every cited chart, not per evidence item — a Hook, so it
  // runs on every render (including the plain-row early return below) with an
  // empty request while there is no settled chart evidence yet.
  const citedVersionIds = presentation === null ? [] : presentation.evidence.flatMap((item) => {
    if (item.kind !== 'chart') return []
    const artifact = science?.artifacts.find(candidate =>
      String(candidate.artifactId) === item.chart_id && candidate.version === item.version)
    return artifact === undefined ? [] : [artifact.versionId]
  })
  const summaries = useScienceVersionSummaries(loadVersions, citedVersionIds)

  if (presentation === null) {
    const status = state === 'running'
      ? t('outcome.running')
      : state === 'error'
        ? t('outcome.failed')
        : state === 'stopped' ? t('outcome.stopped') : null
    const text = scienceToolResultText(block)
    return <ScienceToolCell state={state} icon={<IconGoalOutline16 size={14} />} title={t('outcome.title')}
      summary={status ?? text?.split(/\r?\n/u)[0] ?? ''} output={text} inspect={inspect}
      copyLabel={t('cell.copy')} copiedLabel={t('cell.copied')} toolKind="science-outcome" />
  }

  return (
    <ScienceToolCell state={state} icon={<IconGoalOutline16 size={14} />} title={t('outcome.title')}
      summary={t('outcome.published', { revision: presentation.revision })} inspect={inspect}
      copyLabel={t('cell.copy')} copiedLabel={t('cell.copied')} toolKind="science-outcome">
      <div className={css.summary}>
        <div className={css.header}><span className={css.title}>{presentation.title}</span>
          <span className={css.badge}>{t('outcome.revision', { revision: presentation.revision })}</span></div>
        <MarkdownText text={presentation.summaryMarkdown} />
      </div>
      {presentation.evidence.length > 0 && (
        <div className={css.evidenceSection}>
          <div className={css.evidenceLabel}>{t('outcome.evidence')}</div>
          <ul className={css.evidenceList}>
            {presentation.evidence.map((item, index) => (
              <EvidenceItem key={index} item={item} science={science} summaries={summaries} loadScienceImage={loadScienceImage} t={t} />
            ))}
          </ul>
        </div>
      )}
    </ScienceToolCell>
  )
}
