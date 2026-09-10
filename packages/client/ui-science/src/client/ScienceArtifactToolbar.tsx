/** Artifact version navigation, download, save-as form and image expansion. */
import { useEffect, useId, useState } from 'react'
import { ImageLightbox, IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16,
  IconDownloadOutline16, IconFullscreenOutline16, IconInspectOutline12, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'
import type { ScienceRenderableVersion } from './version-summaries.ts'
import type { ScienceImageLoader } from './science-attachment-loader.ts'
import { scienceArtifactUrl } from './science-artifact-url.ts'
import css from './ScienceDetailsView.module.css'
const NO_INTERMEDIATE_VERSIONS: ReadonlySet<number> = new Set()

/**
 * Localize a download pre-flight failure by the raw-bytes endpoint's
 * `x-science-artifact-error` header (see the endpoint's Agent Note):
 * `missing_content` reuses the T3 reconciliation vocabulary the Files-panel
 * banner already shows for the same store fact, `content_corrupt` is
 * specific to a SHA-256 verification failure, and every other non-2xx
 * status (a 404 authorization failure, a 500) falls back to a generic
 * notice — `response.status`/`.statusText` are never shown, matching the
 * endpoint's documented no-reason-leaked 404 contract.
 * @param reason - the response's `x-science-artifact-error` header value, or `null`.
 * @param t - the Science namespace translator.
 * @returns localized notice text for the toolbar's inline download error.
 */
function downloadErrorText(reason: string | null, t: TranslateNS<'science'>): string {
  switch (reason) {
    case 'missing_content': return t('library.reconcile.downloadUnavailable')
    case 'content_corrupt': return t('toolbar.downloadCorrupt')
    default: return t('toolbar.downloadFailed')
  }
}

/**
 * Trigger a browser save of one artifact version's raw bytes directly from
 * the raw-bytes endpoint through a throwaway anchor — no base64 JS pass, no
 * `data:` URI, no decode/re-encode (T4 §2). A HEAD pre-flight classifies a
 * failure before ever creating the anchor (410/409/other), so a broken
 * download reports visible text instead of silently doing nothing; the
 * anchor omits `download` and relies on the endpoint's own
 * `Content-Disposition` filename.
 * @param sessionId - the viewing session (the endpoint derives authorization from this alone).
 * @param chart - the version to download.
 * @param t - the Science namespace translator.
 * @returns acceptance, or a localized failure message.
 */
async function downloadArtifact(
  sessionId: SessionId, chart: ScienceRenderableVersion, t: TranslateNS<'science'>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = scienceArtifactUrl(sessionId, chart.versionId as VersionId)
  let response: Response
  try {
    response = await fetch(url, { method: 'HEAD' })
  } catch {
    return { ok: false, message: t('toolbar.downloadFailed') }
  }
  if (!response.ok) return { ok: false, message: downloadErrorText(response.headers.get('x-science-artifact-error'), t) }
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.click()
  return { ok: true }
}

/**
 * The toolbar-triggered lightbox: a second, store-driven `ImageLightbox`
 * instance alongside the content image's own click-to-open `MessageImage`
 * lightbox. The toolbar's "maximize" button (image artifacts only — see
 * `ArtifactToolbar`) is a sibling of that image with no access to its
 * private open state, so it opens this shared store's `lightboxOpen` flag
 * instead; this component resolves the same durable attachment through the
 * same loader when that flag flips. A load that rejects (or resolves after
 * the flag already closed) renders nothing — the same silent-degrade the
 * thumbnail's own retry control covers for the ordinary click-to-open path.
 */
export function ArtifactLightbox({ chart, loadImage, open, onClose, t }: {
  chart: ScienceRenderableVersion & { mediaType: 'image/png' }
  loadImage: ScienceImageLoader
  open: boolean
  onClose: () => void
  t: TranslateNS<'science'>
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setSrc(null); return }
    let live = true
    void loadImage(chart).then((url) => { if (live) setSrc(url) }).catch(() => {})
    return () => { live = false }
  }, [open, chart, loadImage])

  if (!open || src === null) return null
  return (
    <ImageLightbox
      src={src}
      alt={chart.title || t('artifact.title')}
      labels={{ dialog: t('artifact.lightboxOriginal'), close: t('artifact.lightboxClose') }}
      onClose={onClose}
    />
  )
}

/** Inline "save as" naming form the toolbar shows once its button is clicked. */
function SaveAsForm({ onSubmit, onCancel, t }: {
  onSubmit: (newLogicalName: string) => Promise<{ ok: true } | { ok: false; message: string }>
  onCancel: () => void
  t: TranslateNS<'science'>
}) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <form
      className={css.saveAsForm}
      onSubmit={(event) => {
        event.preventDefault()
        const value = name.trim()
        if (value === '') return
        setPending(true); setError(undefined)
        void onSubmit(value).then((result) => { if (!result.ok) setError(result.message) }).finally(() => { setPending(false) })
      }}
    >
      <input
        autoFocus value={name} aria-label={t('toolbar.saveAsName')} placeholder={t('toolbar.saveAsPlaceholder')} disabled={pending}
        onChange={(event) => { setName(event.target.value) }}
      />
      <button type="submit" disabled={pending || name.trim() === ''}>{t('toolbar.saveAsConfirm')}</button>
      <button type="button" disabled={pending} onClick={onCancel}>{t('toolbar.saveAsCancel')}</button>
      {error !== undefined && <p role="alert" className={css.notice}>{error}</p>}
    </form>
  )
}

export function ArtifactToolbar({
  chart, versions, intermediateVersions = NO_INTERMEDIATE_VERSIONS,
  onBack, onStepVersion, onOpenProvenance, onMaximize, onCloseTab, sessionId, onSaveAs, t,
  contentUnavailable = false,
}: {
  chart: ScienceRenderableVersion
  versions: readonly { version: number }[]
  /**
   * Version numbers folded out of the stepper's default walk order (C2): a
   * same-turn intermediate draft superseded by a later version of the same
   * artifact within the same authorizing turn and producing session. The
   * version this toolbar currently shows stays walkable regardless of
   * membership here, so a direct link or the provenance drill-in can still
   * land on one directly.
   */
  intermediateVersions?: ReadonlySet<number>
  onBack: () => void
  onStepVersion: (version: number) => void
  onOpenProvenance: () => void
  onMaximize: () => void
  onCloseTab: () => void
  sessionId: SessionId
  /** Duplicate this exact version into a new logical artifact. */
  onSaveAs: (newLogicalName: string) => Promise<{ ok: true } | { ok: false; message: string }>
  t: TranslateNS<'science'>
  /** T3 reconciliation: this version's blob is missing from the store — download and maximize are unavailable, not silently broken. */
  contentUnavailable?: boolean
}) {
  const walkable = versions.filter(candidate => candidate.version === chart.version || !intermediateVersions.has(candidate.version))
  // `chart` is always one of `walkable` (either it is not folded, or the
  // filter above keeps the open version in regardless), so `index` is never
  // -1 — no defensive branch for it.
  const index = walkable.findIndex(candidate => candidate.version === chart.version)
  const prev = index > 0 ? walkable[index - 1] : undefined
  const next = index < walkable.length - 1 ? walkable[index + 1] : undefined
  const isImage = chart.mediaType === 'image/png'
  const exportUnavailableId = useId()
  const downloadUnavailableId = useId()
  const [downloadError, setDownloadError] = useState<string>()
  const [savingAs, setSavingAs] = useState(false)

  return (
    <div className={css.toolbar}>
      <div className={css.toolbarRow}>
        <div className={css.toolbarTitle}>
          <button type="button" className={css.libraryBack} onClick={onBack}>
            <IconChevronLeftOutline14 size={12} />{t('details.artifact.back')}
          </button>
        </div>
        <div className={css.toolbarControls}>
          <div className={css.stepper}>
            <button
              type="button" className={css.stepperButton} disabled={prev === undefined}
              aria-label={t('toolbar.versionPrev')}
              // `disabled` already blocks activation at the boundary; omitting
              // the handler entirely (rather than a no-op runtime guard) keeps
              // every branch here reachable by a real click.
              onClick={prev === undefined ? undefined : () => { onStepVersion(prev.version) }}
            >
              <IconChevronLeftOutline14 size={12} />
            </button>
            <span className={css.stepperLabel}>{t('artifact.version', { version: chart.version })}</span>
            <button
              type="button" className={css.stepperButton} disabled={next === undefined}
              aria-label={t('toolbar.versionNext')}
              onClick={next === undefined ? undefined : () => { onStepVersion(next.version) }}
            >
              <IconChevronRightOutline14 size={12} />
            </button>
          </div>
          <button type="button" className={css.toolbarAction} aria-label={t('details.artifact.provenance')} onClick={onOpenProvenance}>
            <IconInspectOutline12 size={12} />
          </button>
          {contentUnavailable ? (
            <Tooltip label={t('library.reconcile.downloadUnavailable')} side="bottom" delayMs={300}>
              {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
              <button
                type="button" className={css.toolbarAction} aria-label={t('toolbar.download')}
                aria-disabled aria-describedby={downloadUnavailableId} data-unavailable
              >
                <IconDownloadOutline16 size={14} />
              </button>
            </Tooltip>
          ) : (
            <button
              type="button" className={css.toolbarAction} aria-label={t('toolbar.download')}
              onClick={() => {
                setDownloadError(undefined)
                void downloadArtifact(sessionId, chart, t).then((result) => { if (!result.ok) setDownloadError(result.message) })
              }}
            >
              <IconDownloadOutline16 size={14} />
            </button>
          )}
          {contentUnavailable && <span id={downloadUnavailableId} className={css.visuallyHidden}>{t('library.reconcile.downloadUnavailable')}</span>}
          <Tooltip label={t('toolbar.exportUnavailable')} side="bottom" delayMs={300}>
            {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
            <button
              type="button"
              className={css.toolbarAction}
              aria-label={t('toolbar.export')}
              aria-disabled
              aria-describedby={exportUnavailableId}
              data-unavailable
            >
              {t('toolbar.export')}
            </button>
          </Tooltip>
          <span id={exportUnavailableId} className={css.visuallyHidden}>{t('toolbar.exportUnavailable')}</span>
          {/* Maximize opens the shared image lightbox; a text attachment has no
              raster to maximize, so this control is image-only. */}
          {isImage && !contentUnavailable && (
            <button type="button" className={css.toolbarAction} aria-label={t('details.artifact.expand')} onClick={onMaximize}>
              <IconFullscreenOutline16 size={14} />
            </button>
          )}
          <button type="button" className={css.toolbarAction} aria-pressed={savingAs} onClick={() => { setSavingAs(value => !value) }}>
            {t('toolbar.saveAs')}
          </button>
          <button type="button" className={css.toolbarAction} aria-label={t('toolbar.closeTab')} onClick={onCloseTab}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
      </div>
      {downloadError !== undefined && <p role="alert" className={css.notice}>{downloadError}</p>}
      {savingAs && (
        <SaveAsForm
          onSubmit={name => onSaveAs(name).then((result) => { if (result.ok) setSavingAs(false); return result })}
          onCancel={() => { setSavingAs(false) }}
          t={t}
        />
      )}
    </div>
  )
}
