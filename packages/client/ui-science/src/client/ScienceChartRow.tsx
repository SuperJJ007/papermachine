// Chart toolview registrant: the keyed toolview hole for `save_chart`. Reads
// only the tagged, versioned presentation value from the frozen result slice
// (`block.meta`) — never re-derives byte or dimension facts locally — and
// loads the durable PNG through the owner-supplied session-authorized
// `loadImage` (the same cached, generation-tracked loader chat history
// images use). A running, failed, stopped, or unrecognized/stale
// presentation falls back to a plain row: title, state, and the tool's own
// rendered text, never a broken or empty card.

import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { MessageImage } from '@deepseek-ai/dsh-client-ui-attachment'
import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import { IconDataOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ScienceChartPresentation } from '@deepseek-ai/dsh-tool-science/types'
import css from './ScienceChartRow.module.css'
import {
  ScienceToolFallbackRow,
  scienceToolResultText,
  scienceToolRowState,
  type ScienceToolRowState,
} from './ScienceToolFallbackRow.tsx'

/** Full row props: the toolview runtime share plus this package's locale seat. */
type ScienceChartRowProps = ToolCallViewProps & PropsLocale<'science'>

const KNOWN_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Structurally validate `block.meta` against the exact tagged, versioned shape. */
function parsePresentation(meta: unknown): ScienceChartPresentation | null {
  if (typeof meta !== 'object' || meta === null) return null
  const candidate = meta as Record<string, unknown>
  if (candidate.kind !== 'science/chart' || candidate.version !== 1) return null
  if (typeof candidate.chartId !== 'string' || typeof candidate.logicalName !== 'string') return null
  if (typeof candidate.chartVersion !== 'number' || typeof candidate.title !== 'string') return null
  if (typeof candidate.runId !== 'string' || typeof candidate.createdAt !== 'number') return null
  if (candidate.caption !== undefined && typeof candidate.caption !== 'string') return null
  const attachment = candidate.attachment
  if (typeof attachment !== 'object' || attachment === null) return null
  const fields = attachment as Record<string, unknown>
  if (typeof fields.attachmentId !== 'string') return null
  if (typeof fields.mediaType !== 'string' || !KNOWN_MEDIA_TYPES.includes(fields.mediaType as ImageMediaType)) return null
  if (typeof fields.bytes !== 'number' || typeof fields.width !== 'number' || typeof fields.height !== 'number') return null
  if (fields.name !== undefined && typeof fields.name !== 'string') return null
  return candidate as unknown as ScienceChartPresentation
}

/** Turn a presentation's attachment metadata into the durable reference `loadImage` accepts. */
function toAttachmentRef(presentation: ScienceChartPresentation): ImageAttachmentRef {
  const { attachment } = presentation
  return {
    attachmentId: attachment.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: attachment.mediaType as ImageMediaType,
    bytes: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
    ...attachment.name === undefined ? {} : { name: attachment.name },
  }
}

/** Human-readable byte count, matching the compact style used elsewhere in the transcript. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** State-derived leading icon, matching the accent-row family's icon-or-dot convention. */
function leadingFor(state: ScienceToolRowState) {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconDataOutline16 size={14} />
  }
}

/**
 * Render one `save_chart` call as a durable chart card once its tagged
 * presentation settles, or a compact plain row otherwise.
 * @param props - keyed toolview payload plus the science locale seat.
 * @returns the dedicated chart row.
 */
export function ScienceChartRow({ block, loadImage, t }: ScienceChartRowProps) {
  const state = scienceToolRowState(block)
  const meta = 'kind' in block ? block.meta : undefined
  const presentation = state === 'ok' ? parsePresentation(meta) : null

  if (presentation === null) {
    const status = state === 'running' ? t('chart.running') : state === 'error' ? t('chart.failed') : state === 'stopped' ? t('chart.stopped') : null
    const text = scienceToolResultText(block)
    return (
      <ScienceToolFallbackRow
        dataTool="science-chart"
        state={state}
        leading={leadingFor(state)}
        title={t('chart.title')}
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

  const labels: MessageImageLabels = {
    image: t('chart.title'),
    open: t('chart.open'),
    openNamed: label => t('chart.openNamed', { label }),
    loading: t('chart.loading'),
    loadFailed: t('chart.loadFailed'),
    lightbox: { dialog: t('chart.lightboxOriginal'), close: t('chart.lightboxClose') },
  }
  return (
    <div className={css.card} data-tool="science-chart" data-state={state}>
      <div className={css.header}>
        <span className={css.leading}><IconDataOutline16 size={14} /></span>
        <span className={css.title}>{presentation.title}</span>
        <span className={css.badge}>{t('chart.version', { version: presentation.chartVersion })}</span>
      </div>
      {presentation.caption !== undefined && <p className={css.caption}>{presentation.caption}</p>}
      <MessageImage attachment={toAttachmentRef(presentation)} load={loadImage} variant="single" labels={labels} />
      <div className={css.meta}>
        <span>{presentation.logicalName}</span>
        <span>{t('chart.sourceRun', { runId: presentation.runId })}</span>
        <span>
          {t('chart.dimensions', {
            width: presentation.attachment.width, height: presentation.attachment.height, size: formatBytes(presentation.attachment.bytes),
          })}
        </span>
      </div>
    </div>
  )
}
