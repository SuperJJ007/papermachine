// Outcome toolview registrant: the keyed toolview hole for `publish_outcome`.
// Reads the tagged, versioned presentation value from the frozen result
// slice for the published title, Markdown summary, and evidence list; a
// cited chart's thumbnail resolves from the live `science` session
// projection (never from the presentation value itself), so an older
// Outcome row always shows the chart as it exists now, and a missing or
// unavailable projection/attachment reports the gap visibly instead of
// inventing a replacement. A running, failed, stopped, or unrecognized/stale
// presentation falls back to a plain row.

import { MessageImage } from '@deepseek-ai/dsh-client-ui-attachment'
import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import { IconGoalOutline16, MarkdownText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
// Merges the `science` key into SessionProjectionMap for useProjection.
import type { ScienceClientProjection } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceOutcomeEvidencePresentation, ScienceOutcomePresentation } from '@deepseek-ai/dsh-tool-science/types'
import css from './ScienceOutcomeRow.module.css'
import {
  ScienceToolFallbackRow,
  scienceToolResultText,
  scienceToolRowState,
  type ScienceToolRowState,
} from './ScienceToolFallbackRow.tsx'

/** Full row props: the toolview runtime share plus this package's locale seat. */
type ScienceOutcomeRowProps = ToolCallViewProps & PropsLocale<'science'>

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

/** State-derived leading icon, matching the accent-row family's icon-or-dot convention. */
function leadingFor(state: ScienceToolRowState) {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconGoalOutline16 size={14} />
  }
}

/** One evidence row: a text label, plus a resolved chart thumbnail when the citation is a chart. */
function EvidenceItem({ item, science, loadImage, t }: {
  item: ScienceOutcomeEvidencePresentation
  science: ScienceClientProjection | null | undefined
  loadImage: ScienceOutcomeRowProps['loadImage']
  t: ScienceOutcomeRowProps['t']
}) {
  if (item.kind === 'run') {
    return <li className={css.evidenceItem}>{t('outcome.evidenceRun', { runId: item.run_id })}</li>
  }
  if (item.kind === 'message') {
    return <li className={css.evidenceItem}>{t('outcome.evidenceMessage', { seq: item.seq })}</li>
  }
  const label = t('outcome.evidenceChart', { chartId: item.chart_id, version: item.version })
  const chart = science?.artifacts.find(candidate => String(candidate.artifactId) === item.chart_id && candidate.version === item.version)
  // Evidence citing a non-image artifact (auto-captured csv/json/md/txt) is
  // reported the same as an unresolved citation until the non-image artifact
  // phase extends this row's rendering (README "PNG presentation only").
  if (chart === undefined || !('width' in chart.attachment)) {
    return (
      <li className={css.evidenceItem}>
        <span>{label}</span>
        <span className={css.chartMissing}>{t('outcome.chartMissing')}</span>
      </li>
    )
  }
  const labels: MessageImageLabels = {
    image: label,
    open: label,
    openNamed: () => label,
    loading: t('chart.loading'),
    loadFailed: t('chart.loadFailed'),
    lightbox: { dialog: t('chart.lightboxOriginal'), close: t('chart.lightboxClose') },
  }
  return (
    <li className={css.evidenceItem}>
      <span>{label}</span>
      <MessageImage
        attachment={{
          attachmentId: chart.attachment.attachmentId,
          mediaType: chart.attachment.mediaType,
          bytes: chart.attachment.bytes,
          width: chart.attachment.width,
          height: chart.attachment.height,
          ...chart.attachment.name === undefined ? {} : { name: chart.attachment.name },
        }}
        load={loadImage}
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
export function ScienceOutcomeRow({ block, loadImage, useProjection, t }: ScienceOutcomeRowProps) {
  const state = scienceToolRowState(block)
  const meta = 'kind' in block ? block.meta : undefined
  const presentation = state === 'ok' ? parsePresentation(meta) : null
  const science = useProjection('science')

  if (presentation === null) {
    const status = state === 'running'
      ? t('outcome.running')
      : state === 'error'
        ? t('outcome.failed')
        : state === 'stopped' ? t('outcome.stopped') : null
    const text = scienceToolResultText(block)
    return (
      <ScienceToolFallbackRow
        dataTool="science-outcome"
        state={state}
        leading={leadingFor(state)}
        title={t('outcome.title')}
        status={status}
        text={text}
        classes={{
          card: css.card,
          header: css.header,
          leading: css.leading,
          title: css.title,
          status: css.status,
          fallbackText: css.fallbackText,
        }}
      />
    )
  }

  return (
    <div className={css.card} data-tool="science-outcome" data-state={state}>
      <div className={css.header}>
        <span className={css.leading}><IconGoalOutline16 size={14} /></span>
        <span className={css.title}>{presentation.title}</span>
        <span className={css.badge}>{t('outcome.revision', { revision: presentation.revision })}</span>
      </div>
      <div className={css.summary}>
        <MarkdownText text={presentation.summaryMarkdown} />
      </div>
      {presentation.evidence.length > 0 && (
        <div className={css.evidenceSection}>
          <div className={css.evidenceLabel}>{t('outcome.evidence')}</div>
          <ul className={css.evidenceList}>
            {presentation.evidence.map((item, index) => (
              <EvidenceItem key={index} item={item} science={science} loadImage={loadImage} t={t} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
