// Artifact toolview registrant: the keyed toolview hole for `annotate_artifact`.
// A settled, valid presentation renders as a compact navigation row — small
// thumbnail (or, for a non-image artifact, a file-type tile), logical name,
// version badge, title — never the full card the artifact viewer now owns.
// Activating the row (anywhere but the thumbnail) opens (or activates, at
// that exact version) that artifact's tab in the shared ui-science
// selection store and opens the Details column on the Science entry; a
// hover-revealed control on an image thumbnail opens the shared lightbox
// directly, so full-screen viewing never requires opening the column (a
// non-image tile has nothing to maximize, so it carries no such control). A
// running, failed, stopped, or unrecognized/stale presentation falls back to
// a plain row: title, state, and the tool's own rendered text, never a
// broken or empty card.

import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { MessageImage } from '@deepseek-ai/dsh-client-ui-attachment/client'
import { IconDataOutline16, IconFullscreenOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ScienceArtifactPresentation, ScienceArtifactPresentationItem } from '@deepseek-ai/dsh-tool-science/types'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import { artifactImageLabels } from './ArtifactContent.tsx'
import { ArtifactFileTile } from './ArtifactFileTile.tsx'
import type { ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceArtifactRow.module.css'
import {
  ScienceToolFallbackRow,
  scienceToolResultText,
  scienceToolRowState,
  type ScienceToolRowState,
} from './ScienceToolFallbackRow.tsx'

/** Full row props: the toolview runtime share, the shared selection store, and this package's locale seat. */
type ScienceArtifactRowProps = ToolCallViewProps & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** Details entry id this row opens (matches the entry ui-science registers). */
const SCIENCE_DETAILS_ID = 'science'

/** Structurally validate `block.meta` against the exact tagged, versioned shape, requiring exactly one referenced artifact. */
function parsePresentation(meta: unknown): ScienceArtifactPresentationItem | null {
  if (typeof meta !== 'object' || meta === null) return null
  const candidate = meta as Record<string, unknown>
  if (candidate.kind !== 'science/artifact' || candidate.version !== 1) return null
  if (!Array.isArray(candidate.artifacts) || candidate.artifacts.length !== 1) return null
  const item = candidate.artifacts[0] as Record<string, unknown>
  if (typeof item.artifactId !== 'string' || typeof item.logicalName !== 'string') return null
  if (typeof item.version !== 'number' || typeof item.title !== 'string') return null
  const attachment = item.attachment
  if (typeof attachment !== 'object' || attachment === null) return null
  const fields = attachment as Record<string, unknown>
  if (typeof fields.attachmentId !== 'string' || typeof fields.mediaType !== 'string') return null
  if (typeof fields.bytes !== 'number') return null
  if (fields.width !== undefined && typeof fields.width !== 'number') return null
  if (fields.height !== undefined && typeof fields.height !== 'number') return null
  if (fields.name !== undefined && typeof fields.name !== 'string') return null
  return (candidate as unknown as ScienceArtifactPresentation).artifacts[0] as ScienceArtifactPresentationItem
}

/** Whether a presentation item's attachment carries image dimensions. */
function hasImageAttachment(
  item: ScienceArtifactPresentationItem,
): item is ScienceArtifactPresentationItem & { attachment: { width: number; height: number } } {
  return item.attachment.width !== undefined && item.attachment.height !== undefined
}

/** Turn a presentation item's attachment metadata into the durable reference `loadImage` accepts. */
function toAttachmentRef(item: ScienceArtifactPresentationItem & { attachment: { width: number; height: number } }): ImageAttachmentRef {
  const { attachment } = item
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
 * Render one `annotate_artifact` call as a compact navigation row once its
 * tagged presentation settles, or a plain fallback row otherwise.
 * @param props - keyed toolview payload, the shared selection store, and the science locale seat.
 * @returns the dedicated artifact row.
 */
export function ScienceArtifactRow({ block, loadImage, openDetailsView, actions, t }: ScienceArtifactRowProps) {
  const state = scienceToolRowState(block)
  const meta = 'kind' in block ? block.meta : undefined
  const item = state === 'ok' ? parsePresentation(meta) : null

  if (item === null) {
    const status = state === 'running' ? t('artifact.curating') : state === 'error' ? t('artifact.curateFailed') : state === 'stopped' ? t('artifact.curateStopped') : null
    const text = scienceToolResultText(block)
    return (
      <ScienceToolFallbackRow
        dataTool="science-artifact"
        state={state}
        leading={leadingFor(state)}
        title={t('artifact.title')}
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

  const isImage = hasImageAttachment(item)
  const labels = artifactImageLabels(t)

  const activate = (): void => {
    actions.openTab({ artifactId: item.artifactId as ScienceArtifactId, version: item.version })
    openDetailsView(SCIENCE_DETAILS_ID)
  }

  return (
    <div
      className={css.row}
      data-tool="science-artifact"
      data-state={state}
      role="button"
      // Explicit: the row's contents include MessageImage's own button, so a
      // content-derived accessible name would announce the thumbnail's load
      // state as this row's name.
      aria-label={t('details.artifact.select', { title: item.title, version: item.version })}
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
          handler above, so opening the lightbox never opens the column. A
          non-image tile has no such interior control, but shares the same
          stop-propagation wrapper for layout symmetry. */}
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
        {isImage
          ? (
            <>
              <MessageImage attachment={toAttachmentRef(item)} load={loadImage} variant="tile" labels={labels} />
              <span className={css.expandHint} aria-hidden="true"><IconFullscreenOutline16 size={12} /></span>
            </>
          )
          : <ArtifactFileTile mediaType={item.attachment.mediaType} />}
      </div>
      <span className={css.logicalName}>{item.logicalName}</span>
      <span className={css.badge}>{t('artifact.version', { version: item.version })}</span>
      <span className={css.title}>{item.title}</span>
    </div>
  )
}
