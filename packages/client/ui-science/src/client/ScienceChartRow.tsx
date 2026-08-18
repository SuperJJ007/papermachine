// Chart toolview registrant: the keyed toolview hole for `save_chart`. A
// settled, valid presentation renders as a compact navigation row — small
// thumbnail, logical name, version badge, title — never the full card the
// artifact viewer now owns. Activating the row (anywhere but the thumbnail)
// opens (or activates, at that exact version) that artifact's tab in the
// shared ui-science selection store and opens the Details column on the
// Science entry; a hover-revealed control on the thumbnail opens the shared
// lightbox directly, so full-screen viewing never requires opening the
// column. A running, failed, stopped, or unrecognized/stale presentation
// falls back to a plain row: title, state, and the tool's own rendered text,
// never a broken or empty card.

import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { MessageImage } from '@deepseek-ai/dsh-client-ui-attachment'
import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import { IconDataOutline16, IconFullscreenOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ScienceChartPresentation } from '@deepseek-ai/dsh-tool-science/types'
import type { ScienceChartId } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceChartRow.module.css'
import {
  ScienceToolFallbackRow,
  scienceToolResultText,
  scienceToolRowState,
  type ScienceToolRowState,
} from './ScienceToolFallbackRow.tsx'

/** Full row props: the toolview runtime share, the shared selection store, and this package's locale seat. */
type ScienceChartRowProps = ToolCallViewProps & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** Details entry id this row opens (matches the entry ui-science registers). */
const SCIENCE_DETAILS_ID = 'science'

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

/** State-derived leading icon, matching the accent-row family's icon-or-dot convention. */
function leadingFor(state: ScienceToolRowState) {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconDataOutline16 size={14} />
  }
}

/**
 * Render one `save_chart` call as a compact navigation row once its tagged
 * presentation settles, or a plain fallback row otherwise.
 * @param props - keyed toolview payload, the shared selection store, and the science locale seat.
 * @returns the dedicated chart row.
 */
export function ScienceChartRow({ block, loadImage, openDetailsView, actions, t }: ScienceChartRowProps) {
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

  const activate = (): void => {
    actions.openTab({ chartId: presentation.chartId as ScienceChartId, version: presentation.chartVersion })
    openDetailsView(SCIENCE_DETAILS_ID)
  }

  return (
    <div
      className={css.row}
      data-tool="science-chart"
      data-state={state}
      role="button"
      // Explicit: the row's contents include MessageImage's own button, so a
      // content-derived accessible name would announce the thumbnail's load
      // state as this row's name.
      aria-label={t('details.artifact.select', { title: presentation.title, version: presentation.chartVersion })}
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        activate()
      }}
    >
      {/* The thumbnail's own MessageImage renders a real <button> for its
          click-to-lightbox behavior; nesting a second interactive element
          inside the row's own button role means this wrapper must stop the
          click (and repeat keydown) from also reaching the row's activate
          handler above, so opening the lightbox never opens the column. */}
      <div
        className={css.thumbWrap}
        onClick={(event) => { event.stopPropagation() }}
        onKeyDown={(event) => {
          // Only the two keys the row itself acts on. A blanket stop would
          // also stop Escape, and ImageLightbox closes from a `window`
          // keydown listener — React's synthetic stopPropagation stops the
          // native event at its root container, below `window`, so the
          // thumbnail's own lightbox could never be dismissed.
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.stopPropagation()
        }}
      >
        <MessageImage attachment={toAttachmentRef(presentation)} load={loadImage} variant="tile" labels={labels} />
        <span className={css.expandHint} aria-hidden="true"><IconFullscreenOutline16 size={12} /></span>
      </div>
      <span className={css.logicalName}>{presentation.logicalName}</span>
      <span className={css.badge}>{t('chart.version', { version: presentation.chartVersion })}</span>
      <span className={css.title}>{presentation.title}</span>
    </div>
  )
}
