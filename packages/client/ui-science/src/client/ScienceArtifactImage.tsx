import { useCallback, useEffect, useState } from 'react'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-attachment/client'
import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment/client'
import type { ScienceArtifactContentRef, ScienceImageLoader } from './science-attachment-loader.ts'
import css from './ScienceDetailsView.module.css'

/** Project-store image preview with retry and optional original-size lightbox. */
export function ScienceArtifactImage({ content, label, load, variant, labels, srcOverride }: {
  content: ScienceArtifactContentRef
  label: string
  load: ScienceImageLoader
  variant: 'single' | 'tile'
  labels: MessageImageLabels
  srcOverride?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setAttempt(current => current + 1) }, [])
  const close = useCallback(() => { setOpen(false) }, [])

  useEffect(() => {
    let live = true
    setFailed(false)
    setSrc(null)
    void load(content).then((url) => { if (live) setSrc(url) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  // `content.versionId` is this immutable version's stable identity: a
  // structurally-equal `content` object rebuilt for the same version (every
  // projection re-derives fresh artifact objects) must not reset the loaded
  // image and refetch.
  }, [content.versionId, load, attempt])

  if (failed) {
    return <button type="button" className={css.artifactImageError} data-variant={variant} onClick={retry}>{labels.loadFailed}</button>
  }
  return (
    <>
      <button
        type="button"
        className={css.artifactImageFrame}
        data-variant={variant}
        title={labels.open}
        aria-label={labels.openNamed(label)}
        onClick={() => { if (src !== null) setOpen(true) }}
      >
        {srcOverride === undefined && src === null
          ? <span className={css.notice}>{labels.loading}</span>
          : <img className={css.artifactImage} src={srcOverride ?? src ?? ''} alt={label} />}
      </button>
      {open && src !== null && <ImageLightbox src={src} alt={label} labels={labels.lightbox} onClose={close} />}
    </>
  )
}
