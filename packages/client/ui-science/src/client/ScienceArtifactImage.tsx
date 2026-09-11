import { useCallback, useEffect, useState } from 'react'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment/src/MessageImage.tsx'
import type { ScienceArtifactContentRef, ScienceImageLoader } from './science-attachment-loader.ts'
import css from './ScienceDetailsView.module.css'

/** Project-store image preview with retry and optional original-size lightbox. */
export function ScienceArtifactImage({ content, label, load, variant, labels, srcOverride }: {
  content: ScienceArtifactContentRef
  label: string
  load: ScienceImageLoader
  variant: 'single' | 'tile' | 'card'
  labels: MessageImageLabels
  srcOverride?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setFailedSrc(null); setAttempt(current => current + 1) }, [])
  const close = useCallback(() => { setOpen(false) }, [])

  useEffect(() => {
    let live = true
    setLoadFailed(false)
    setSrc(null)
    void load(content).then((url) => { if (live) setSrc(url) }).catch(() => { if (live) setLoadFailed(true) })
    return () => { live = false }
  // `content.versionId` is this immutable version's stable identity: a
  // structurally-equal `content` object rebuilt for the same version (every
  // projection re-derives fresh artifact objects) must not reset the loaded
  // image and refetch.
  }, [content.versionId, load, attempt])

  const resolvedSrc = srcOverride ?? src
  if ((resolvedSrc !== null && failedSrc === resolvedSrc) || (srcOverride === undefined && loadFailed)) {
    return <button type="button" className={css.artifactImageError} data-variant={variant} onClick={retry}>{labels.loadFailed}</button>
  }
  // `resolvedSrc === null` is exactly `srcOverride === undefined && src === null`
  // (srcOverride can never itself be `null`): a `string` guard here, rather
  // than an inline `?? ''` fallback at the `<img>` tag, lets the empty-string
  // fallback disappear as literally unreachable instead of merely unused.
  return (
    <>
      <button
        type="button"
        className={css.artifactImageFrame}
        data-variant={variant}
        title={labels.open}
        aria-label={labels.openNamed(label)}
        onClick={() => { if (resolvedSrc !== null) setOpen(true) }}
      >
        {resolvedSrc === null
          ? <span className={css.notice}>{labels.loading}</span>
          // `load` resolving a raw-bytes URL (`createScienceImageUrlLoader`)
          // never inspects the response: the browser fetches `src` itself,
          // so a missing or unreadable blob surfaces only as this `<img>`'s
          // own load failure, never a rejection `load`'s caller could catch.
          : <img key={resolvedSrc} className={css.artifactImage} src={resolvedSrc} alt={label}
            onError={() => { setFailedSrc(resolvedSrc) }} />}
      </button>
      {open && resolvedSrc !== null && <ImageLightbox src={resolvedSrc} alt={label} labels={labels.lightbox} onClose={close} />}
    </>
  )
}
