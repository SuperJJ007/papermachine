/** One Turn's deduplicated artifact group, rendered after its assistant answer. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceArtifactPresentationItem } from '@deepseek-ai/dsh-tool-science/types'
import { FileDeliveryCard, FileDeliveryGroup, FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ScienceImageLoader } from './science-attachment-loader.ts'
import type { ScienceSelectionStore } from './selection-store.ts'
import { selectScienceTurnArtifacts, type ScienceTurnArtifactsData } from './science-turn-artifacts.ts'

/** Navigation and loading capabilities supplied by the Turn-tail registration. */
export interface ScienceTurnArtifactsInjected {
  readonly loadImage: ScienceImageLoader
  readonly openArtifact: (selection: { artifactId: string; version: number }) => void
}

export type ScienceTurnArtifactsProps = { matched: ScienceTurnArtifactsData; collapsedCount: number }
  & PropsLocale<'science'> & PropsStore<ScienceSelectionStore>
  & InjectFace<ScienceTurnArtifactsInjected>

function ArtifactThumbnail({ item, loadImage }: {
  item: ScienceArtifactPresentationItem
  loadImage: ScienceImageLoader
}) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    if (item.content.mediaType !== 'image/png') return
    let live = true
    void loadImage(item.content).then((url) => { if (live) setSrc(url) }).catch(() => {
      // Image loading failures retain the media-type tile.
    })
    return () => { live = false }
  }, [item, loadImage])
  return src === null
    ? <FileTypeIcon path={item.logicalName} size={28} />
    : <img src={src} alt="" />
}

/** Render each logical artifact at the highest version emitted in this Turn. */
export function ScienceTurnArtifacts({ matched, collapsedCount, actions, loadImage, openArtifact, t }: ScienceTurnArtifactsProps) {
  const total = matched.artifacts.length
  return <div data-science-turn-artifacts><FileDeliveryGroup collapsedCount={collapsedCount}
    heading={t('turnArtifacts.title', { count: total })}
    expandLabel={t('turnArtifacts.showMore', { count: total - collapsedCount })}
    collapseLabel={t('turnArtifacts.collapse')} expandAriaLabel={t('turnArtifacts.expandAria', { count: total })}
    collapseAriaLabel={t('turnArtifacts.collapseAria', { count: total })}
    items={matched.artifacts.map((item) => {
      const name = item.title !== '' ? item.title : item.logicalName
      const label = t('display.artifactVersion', { name, version: item.version })
      const open = () => {
        actions.openTab({ artifactId: item.artifactId as ScienceArtifactId, version: item.version })
        openArtifact({ artifactId: item.artifactId, version: item.version })
      }
      return { id: item.artifactId, content: <FileDeliveryCard title={name} subtitle={t('artifact.version', { version: item.version })}
        thumbnail={<ArtifactThumbnail item={item} loadImage={loadImage} />} titleTooltip={name}
        previewLabel={label} actionAriaLabel={t('turnArtifacts.openAria', { name, version: item.version })}
        actionLabel={t('turnArtifacts.open')} onPreview={open} /> }
    })} /></div>
}

/**
 * Select this domain's output without excluding other list contributions.
 * @param props - Chat owner data and Science capabilities.
 * @returns The Science group, or null when this Turn has no artifacts.
 */
export function ScienceTurnArtifactsEntry(props: PropsRuntime<'conversation.chat.turnTail'>
  & PropsLocale<'science'> & PropsStore<ScienceSelectionStore> & InjectFace<ScienceTurnArtifactsInjected>) {
  const matched = selectScienceTurnArtifacts(props)
  return matched === null ? null : <ScienceTurnArtifacts {...props} matched={matched} />
}
