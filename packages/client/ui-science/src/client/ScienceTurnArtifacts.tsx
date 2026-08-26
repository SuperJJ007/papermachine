/** One Turn's deduplicated artifact group, rendered after its assistant answer. */

import { useEffect, useState } from 'react'
import type { ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceArtifactPresentationItem } from '@deepseek-ai/dsh-tool-science/types'
import { ArtifactFileTile } from './ArtifactFileTile.tsx'
import type { ScienceSelectionStore } from './selection-store.ts'
import type { ScienceTurnArtifactsData } from './science-turn-artifacts.ts'
import css from './ScienceTurnArtifacts.module.css'

/** Navigation and loading capabilities supplied by the Turn-tail registration. */
export interface ScienceTurnArtifactsInjected {
  readonly loadImage: ImageLoader
  readonly openArtifact: () => void
}

export type ScienceTurnArtifactsProps = PropsRuntime<'conversation.chat.turnTail'>
  & { matched: ScienceTurnArtifactsData }
  & PropsLocale<'science'> & PropsStore<ScienceSelectionStore>
  & InjectFace<ScienceTurnArtifactsInjected>

function hasDimensions(item: ScienceArtifactPresentationItem): item is ScienceArtifactPresentationItem & {
  attachment: ScienceArtifactPresentationItem['attachment'] & { width: number; height: number }
} {
  return item.attachment.width !== undefined && item.attachment.height !== undefined
}

function ArtifactThumbnail({ item, loadImage }: {
  item: ScienceArtifactPresentationItem
  loadImage: ImageLoader
}) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    if (!hasDimensions(item)) return
    let live = true
    void loadImage({
      ...item.attachment,
      attachmentId: item.attachment.attachmentId as never,
      mediaType: item.attachment.mediaType as never,
    }).then((url) => { if (live) setSrc(url) }).catch(() => {
      // Image loading failures retain the media-type tile.
    })
    return () => { live = false }
  }, [item, loadImage])
  return src === null
    ? <ArtifactFileTile mediaType={item.attachment.mediaType} />
    : <img src={src} alt="" />
}

/** Cards shown before an unexpanded overflow collapses the rest behind the "+N more" button. */
const OVERFLOW_VISIBLE_COUNT = 5
/** Total artifact count at or above which the tray collapses to `OVERFLOW_VISIBLE_COUNT` cards. */
const OVERFLOW_THRESHOLD = 7

/** Render exactly one card per logical artifact, using the last version emitted in this Turn. */
export function ScienceTurnArtifacts({ matched, actions, loadImage, openArtifact, t }: ScienceTurnArtifactsProps) {
  const [expanded, setExpanded] = useState(false)
  const total = matched.artifacts.length
  const overflowing = total >= OVERFLOW_THRESHOLD
  const visible = overflowing && !expanded ? matched.artifacts.slice(0, OVERFLOW_VISIBLE_COUNT) : matched.artifacts
  return (
    <section className={css.root} data-science-turn-artifacts>
      <p className={css.title}>{t('turnArtifacts.title', { count: total })}</p>
      <div className={css.list} role="list">
        {visible.map(item => (
          <button type="button" role="listitem" aria-label={`${item.logicalName} v${String(item.version)}`} className={css.card} key={item.artifactId}
            onClick={() => {
              actions.openTab({ artifactId: item.artifactId as ScienceArtifactId, version: item.version })
              openArtifact()
            }}>
            <span className={css.thumb}><ArtifactThumbnail item={item} loadImage={loadImage} /></span>
            <span className={css.meta}><span className={css.name}>{item.logicalName}</span>
              <span className={css.version}>{t('artifact.version', { version: item.version })}</span></span>
          </button>
        ))}
      </div>
      {overflowing && !expanded && (
        <button type="button" className={css.more} onClick={() => { setExpanded(true) }}>
          {t('turnArtifacts.showMore', { count: total - OVERFLOW_VISIBLE_COUNT })}
        </button>
      )}
    </section>
  )
}
