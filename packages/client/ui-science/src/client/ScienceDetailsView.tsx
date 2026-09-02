// Science Details entry: the artifact viewer over the accepted client-safe
// `science` Session projection (packages/science/science-session/src/types.ts).
// Viewer-first, not a dashboard: a top tab strip holds one tab per opened
// artifact (logical chart); the active tab shows an in-panel toolbar
// (library return, version stepper, provenance, download, maximize [image only],
// close tab) above the dispatched content (ArtifactContent.tsx), or — one
// toolbar click away — the provenance drill-in (ScienceArtifactProvenance.tsx).
// With no open tabs the panel shows the landing view: a gallery of latest
// artifact versions (opening one opens its tab).
// It builds no second projection reader or artifact store;
// the one piece of local state it owns is the shared ui-science selection
// store (selection-store.ts). Thumbnails and content load through this
// package's own session-scoped loaders (science-attachment-loader.ts) —
// `loadImage` for an image attachment, `loadText` for CSV/JSON/Markdown/
// plain text.
//
// The former resident Environment strip and Runs list are gone: Environment
// facts now live only in the provenance drill-in's Environment sub-tab, per
// artifact version (README "Design notes" explains why no session-wide
// "not applied" notice replaces them). The one remaining top-level notice
// (`details.missingSupport`, below) is unrelated to that strip and unchanged;
// a Session without a bound Science mode renders the artifact library like
// any other current Session (`EMPTY_SCIENCE_PROJECTION` above) instead of a
// second notice.

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-attachment/client'
import {
  formatRelativeTime, IconChevronDownOutline14, IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16,
  IconDownloadOutline16, IconFullscreenOutline16, IconInspectOutline12, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { scienceArtifactUrl } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISession, SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcError, RpcResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.details.view,
// and its owner share's inspectCall).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ScienceArtifactId, ScienceArtifactMediaType, ScienceArtifactNote, ScienceArtifactNotesProjection,
  ScienceChartOp, ScienceClientArtifactVersion, ScienceClientProjection,
} from '@deepseek-ai/dsh-science-session/types'
import type {
  ScienceArtifactNoteReceipt, ScienceChartEditReceipt, ScienceChartPreviewReceipt, ScienceEditSelection, ScienceEditTarget,
  ScienceSaveArtifactAsReceipt, ScienceSaveArtifactAsRequest,
} from '@deepseek-ai/dsh-tool-science/types'
import { artifactImageLabels, ArtifactContent } from './ArtifactContent.tsx'
import type { ScienceChartSaveOutcome } from './ScienceChartEditPanel.tsx'
import { ArtifactFileTile } from './ArtifactFileTile.tsx'
import { ScienceArtifactProvenance } from './ScienceArtifactProvenance.tsx'
import type { ScienceLibraryArtifact, ScienceLibraryHealth } from './library-artifact.ts'
import { scienceTabId } from './selection-store.ts'
import type { ScienceArtifactView, ScienceSelectionStore } from './selection-store.ts'
import type { ScienceImageLoader, TextLoader } from './science-attachment-loader.ts'
import type { ScienceChartStateLoader } from './science-chart-state-loader.ts'
import { ScienceArtifactImage } from './ScienceArtifactImage.tsx'
import type { LoadScienceVersions, ScienceRenderableVersion } from './version-summaries.ts'
import { toRenderableVersion, useScienceVersionSummaries } from './version-summaries.ts'
import css from './ScienceDetailsView.module.css'

/** Business face this entry's registration injects. */
export interface ScienceDetailsInjected {
  /** Session-scoped raw-bytes image artifact loader (science-artifact-url-loader.ts). */
  loadImage: ScienceImageLoader
  /** Session-scoped raw-bytes text artifact loader (science-artifact-url-loader.ts). */
  loadText: TextLoader
  /** Session-scoped live chart-object state reader for one open PNG version (science-chart-state-loader.ts). */
  loadChartState: ScienceChartStateLoader
  /**
   * Batch-read current library facts (title, caption, content origin,
   * media type, byte count, health) for a caller-chosen set of versions
   * (D9 — see `version-summaries.ts`).
   */
  loadVersions: LoadScienceVersions
  /**
   * Read the project-level latest-artifact library, plus store↔session
   * reconciliation health. `health` is declared optional here rather than
   * inherited verbatim from `ISession['readScienceLibrary']`: that
   * injected-runtime type has not yet widened to name it (`dsh-client-runtime`
   * is a different package's territory), but the real Host always includes
   * it — `ISession['readScienceLibrary']`'s narrower return is structurally
   * assignable to this wider local one, so nothing here narrows what the wire
   * actually sends; a build wired against the not-yet-widened runtime type
   * simply reads `health` as possibly `undefined` until that type catches up.
   */
  loadLibrary: () => Promise<RpcResult<{ projectId: string; artifacts: ScienceLibraryArtifact[]; health?: ScienceLibraryHealth }>>
  /** List one project workspace directory. */
  loadWorkspaceFiles: ISession['readWorkspaceFiles']
  /** Read one project workspace file. */
  loadWorkspaceFile: ISession['readWorkspaceFile']
  /** Add selected artifact elements to the main conversation composer. */
  addToConversation: (targets: readonly ScienceEditSelection[]) => void
  /** Remove one exact target from the main conversation composer. */
  removeFromConversation: (target: ScienceEditSelection) => void
  /** Observable exact targets currently staged in the main composer. */
  composerSelections: SnapshotStore<readonly ScienceEditSelection[]>
  /** Switch to chat and center the generating assistant node. */
  returnToConversation: (anchorKey: string) => void
  /** Select the detailed trajectory subview before inspecting one call. */
  selectDetailed: () => void
  /** Add one user-only note to an exact visible artifact version. */
  addArtifactNote: (request: { artifactId: ScienceArtifactId; version: number; text: string }) => Promise<
    | { readonly ok: true; readonly value: ScienceArtifactNoteReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Remove one active user-only note. */
  removeArtifactNote: (request: { artifactId: ScienceArtifactId; noteSeq: number }) => Promise<
    | { readonly ok: true; readonly value: ScienceArtifactNoteReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Apply deterministic chart operations to one exact chart version through the `applyChartOps` Remote. */
  applyChartOps: (request: { artifactId: ScienceArtifactId; version: number; ops: readonly ScienceChartOp[] }) => Promise<
    | { readonly ok: true; readonly value: ScienceChartEditReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Render deterministic chart operations without committing a version. */
  previewChartOps: (request: { artifactId: ScienceArtifactId; version: number; ops: readonly ScienceChartOp[] }) => Promise<
    | { readonly ok: true; readonly value: ScienceChartPreviewReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Duplicate one committed artifact version into a brand-new logical artifact, through the `saveArtifactAs` Remote. */
  saveArtifactAs: (request: ScienceSaveArtifactAsRequest) => Promise<RemoteResult<ScienceSaveArtifactAsReceipt>>
}

/** Full props for the Science Details entry. */
export type ScienceDetailsViewProps =
  PropsRuntime<'conversation.details.view'> & InjectFace<ScienceDetailsInjected>
  & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** Every durable version of one logical artifact, ascending — the version stepper's walk order. */
function versionsOf<T extends ScienceClientArtifactVersion>(artifacts: readonly T[], artifactId: ScienceArtifactId): T[] {
  return artifacts.filter(artifact => artifact.artifactId === artifactId).sort((left, right) => left.version - right.version)
}

function workspaceFileName(path: string): string {
  /* v8 ignore next -- workspace RPC paths are non-empty */
  return path.split('/').at(-1) ?? path
}

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
function ArtifactLightbox({ chart, loadImage, open, onClose, t }: {
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

function ArtifactToolbar({
  chart, versions, onBack, onStepVersion, onOpenProvenance, onMaximize, onCloseTab, sessionId, onSaveAs, t,
  contentUnavailable = false,
}: {
  chart: ScienceRenderableVersion
  versions: readonly { version: number }[]
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
  const walkable = versions
  // `chart` is always one of `walkable`, so `index` is never -1 — no
  // defensive branch for it.
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

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${String(bytes)} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

interface WorkspaceEntry {
  name: string
  kind: 'file' | 'dir'
  byteCount?: number
  modifiedAt: number
  mediaType?: string
}

/**
 * Non-modal T3 reconciliation notice for the Files panel's artifacts page.
 * Shows only when `reconstructed` or `missingContent` is non-zero — `orphan`
 * is a documented, accepted crash-window outcome and is never surfaced here
 * (see the `dsh-science-artifact-store` README's Reconciliation section).
 * The expandable list only names artifacts whose CURRENT latest version
 * carries a `health` mark; an older, non-latest affected version counted in
 * `health` is not individually listed (it is not otherwise visible in this
 * panel either).
 */
function ReconcileBanner({ health, artifacts, t }: {
  health: ScienceLibraryHealth
  artifacts: readonly ScienceLibraryArtifact[]
  t: TranslateNS<'science'>
}) {
  const [expanded, setExpanded] = useState(false)
  if (health.reconstructed === 0 && health.missingContent === 0) return null
  const affected = artifacts.filter(item => item.latest.health?.reconstructed === true || item.latest.health?.missingContent === true)
  return (
    <div className={css.reconcileBanner} role="status">
      {health.reconstructed > 0 && <p className={css.notice}>{t('library.reconcile.reconstructed', { count: health.reconstructed })}</p>}
      {health.missingContent > 0 && <p className={css.notice}>{t('library.reconcile.missingContent', { count: health.missingContent })}</p>}
      {affected.length > 0 && (
        <button type="button" className={css.reconcileBannerToggle} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
          {expanded ? t('library.reconcile.collapse') : t('library.reconcile.expand')}
        </button>
      )}
      {expanded && (
        <ul className={css.reconcileBannerList}>
          {affected.map(item => (
            <li key={item.artifactId}>
              <span>{item.title ?? item.logicalName}</span>
              <span className={css.badge}>
                {item.latest.health?.reconstructed === true ? t('library.reconcile.itemReconstructed') : t('library.reconcile.itemMissingContent')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Project-level library home: latest artifacts plus bounded workspace browsing. */
function ProjectLibrary({
  page, loadLibrary, loadWorkspaceFiles, loadImage, onOpenArtifact, onOpenFile, currentSessionId, collapsed, onToggleGroup, t,
}: {
  page: 'artifacts' | 'files'
  loadLibrary: ScienceDetailsInjected['loadLibrary']
  loadWorkspaceFiles: ScienceDetailsInjected['loadWorkspaceFiles']
  loadImage: ScienceImageLoader
  onOpenArtifact: (artifact: ScienceLibraryArtifact) => void
  onOpenFile: (path: string) => void
  currentSessionId: string
  collapsed: Readonly<Record<string, true>>
  onToggleGroup: (sessionId: string) => void
  t: TranslateNS<'science'>
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [artifacts, setArtifacts] = useState<ScienceLibraryArtifact[]>([])
  const [health, setHealth] = useState<ScienceLibraryHealth>()
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (page !== 'artifacts') return
    let live = true
    setError(undefined)
    void loadLibrary().then((result) => {
      if (!live) return
      if (result.ok) { setArtifacts(result.value.artifacts); setHealth(result.value.health) }
      else setError(libraryErrorText(result.error, t))
    })
    return () => { live = false }
  }, [loadLibrary, page, t])

  useEffect(() => {
    if (page !== 'files') return
    let live = true
    setError(undefined)
    void loadWorkspaceFiles(path).then((result) => {
      if (!live) return
      if (result.ok) setEntries(result.value.entries)
      else setError(projectFilesErrorText(result.error, t))
    })
    return () => { live = false }
  }, [loadWorkspaceFiles, path, page, t])

  const now = Date.now()
  const needle = query.trim().toLocaleLowerCase()
  const visibleArtifacts = artifacts.filter(item => `${item.logicalName}\n${item.title ?? ''}`.toLocaleLowerCase().includes(needle))
  const groupsBySession = new Map<string, { title: string; latestAt: number; items: ScienceLibraryArtifact[] }>()
  for (const item of visibleArtifacts) {
    const group = groupsBySession.get(item.originSessionId)
    if (group === undefined) {
      groupsBySession.set(item.originSessionId, {
        title: item.originSessionTitle ?? t('library.unknownSession'), latestAt: item.latest.createdAt, items: [item],
      })
    } else {
      group.latestAt = Math.max(group.latestAt, item.latest.createdAt)
      group.items.push(item)
    }
  }
  const groups = [...groupsBySession].sort(([leftId, left], [rightId, right]) => {
    if (leftId === currentSessionId) return -1
    if (rightId === currentSessionId) return 1
    return right.latestAt - left.latestAt
  })
  for (const [, group] of groups) group.items.sort((a, b) => {
    if (sort === 'name') return (a.title ?? a.logicalName).localeCompare(b.title ?? b.logicalName)
    return sort === 'newest' ? b.latest.createdAt - a.latest.createdAt : a.latest.createdAt - b.latest.createdAt
  })
  const visibleEntries = entries.filter(entry => entry.name.toLocaleLowerCase().includes(needle))
  const crumbs = path === '' ? [] : path.split('/')

  return (
    <div className={css.libraryHome}>
      <div className={css.libraryToolbar}>
        <input aria-label={t('library.search')} placeholder={t('library.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
        {page === 'artifacts' && <>
          <select aria-label={t('library.sort')} value={sort} onChange={(event) => { setSort(event.target.value as typeof sort) }}>
            <option value="newest">{t('library.newest')}</option><option value="oldest">{t('library.oldest')}</option><option value="name">{t('library.name')}</option>
          </select>
          <button type="button" aria-label={t('library.layout')} onClick={() => { setLayout(value => value === 'grid' ? 'list' : 'grid') }}>{layout === 'grid' ? t('library.grid') : t('library.list')}</button>
        </>}
        <span>{page === 'artifacts' ? t('library.artifactCount', { count: visibleArtifacts.length }) : t('library.fileCount', { count: visibleEntries.length })}</span>
      </div>
      {error !== undefined && <p role="alert" className={css.notice}>{error}</p>}
      {page === 'artifacts' && health !== undefined && <ReconcileBanner health={health} artifacts={artifacts} t={t} />}
      {page === 'artifacts' ? <>
        {visibleArtifacts.length === 0 && <p className={css.libraryEmpty} role="status">{t('details.artifacts.empty')}</p>}
        <div className={css.libraryGroups}>{groups.map(([sessionId, group]) => {
          const title = `${group.title}${sessionId === currentSessionId ? ` · ${t('library.currentSession')}` : ''}`
          const isCollapsed = collapsed[sessionId] === true
          return <section key={sessionId} aria-label={title}>
            <h3 className={css.libraryGroupHeading}>
              <button type="button" className={css.libraryGroupToggle} aria-expanded={!isCollapsed}
                onClick={() => { onToggleGroup(sessionId) }}>
                {isCollapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
                <span className={css.libraryGroupTitle}>{title}</span>{' '}
                <span className={css.libraryGroupFacts}>
                  {group.items.length} · {formatRelativeTime(group.latestAt, now, t, true)}
                </span>
              </button>
            </h3>
            {!isCollapsed && <ul className={layout === 'grid' ? css.chartList : css.libraryList}>{group.items.map((item) => {
              const title = item.title ?? item.logicalName
              return <li key={item.artifactId} className={css.chartItem}><div role="button" tabIndex={0} aria-label={t('details.artifact.select', { title, version: item.latest.ordinal })} className={css.libraryCard} onClick={() => { onOpenArtifact(item) }} onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpenArtifact(item)
              }}>
                <span className={css.libraryCardThumb}>
                  {item.latest.mediaType === 'image/png'
                    ? <ScienceArtifactImage content={item.latest} label={title} load={loadImage} variant={layout === 'grid' ? 'card' : 'tile'} labels={artifactImageLabels(t)} />
                    : <ArtifactFileTile mediaType={item.latest.mediaType} />}
                </span>
                <span className={css.chartMeta}>
                  <span className={css.chartTitle}>{title}</span>
                  <span className={css.libraryFacts}>
                    v{String(item.latest.ordinal)} · {formatRelativeTime(item.latest.createdAt, now, t, true)}
                  </span>
                </span>
              </div></li>
            })}</ul>}
          </section>
        })}</div>
      </> : <>
        <nav className={css.breadcrumb} aria-label={t('library.breadcrumb')}>
          <button type="button" className={crumbs.length === 0 ? css.breadcrumbCurrent : css.breadcrumbRoot} onClick={() => { setPath('') }}>{t('library.root')}</button>
          {crumbs.map((crumb, index) => <span className={css.breadcrumbPart} key={`${crumb}:${String(index)}`}>
            <span className={css.breadcrumbSep} aria-hidden="true">›</span>
            <button type="button" className={index === crumbs.length - 1 ? css.breadcrumbCurrent : css.breadcrumbRoot} onClick={() => { setPath(crumbs.slice(0, index + 1).join('/')) }}>{crumb}</button>
          </span>)}
        </nav>
        <ul className={css.workspaceList}>{visibleEntries.map((entry) => {
          const child = path === '' ? entry.name : `${path}/${entry.name}`
          return <li key={entry.name}><button type="button" onClick={() => { if (entry.kind === 'dir') setPath(child); else onOpenFile(child) }}>
            <span>{entry.kind === 'dir' ? '▸' : '·'} {entry.name}</span><small>{entry.kind === 'file' ? formatBytes(entry.byteCount ?? 0) : ''}</small>
          </button></li>
        })}</ul>
      </>}
    </div>
  )
}

const PREVIEW_MEDIA = new Set<ScienceArtifactMediaType>([
  'image/png', 'text/csv', 'application/json', 'text/markdown', 'text/plain',
])

function isPreviewMediaType(value: string): value is ScienceArtifactMediaType {
  return PREVIEW_MEDIA.has(value as ScienceArtifactMediaType)
}

/**
 * Build a read-only renderable version from facts already at hand — the
 * library RPC's own `latest` row, or a workspace-file preview — with no
 * `sessions.scienceVersions` round trip: both call sites already hold every
 * field {@link ScienceRenderableVersion} needs.
 */
function previewChart(ref: {
  artifactId: string
  logicalName: string
  title: string
  caption?: string
  versionId: string
  version: number
  mediaType: ScienceArtifactMediaType
  byteCount: number
  createdAt: number
}): ScienceRenderableVersion {
  return {
    artifactId: ref.artifactId as ScienceArtifactId, logicalName: ref.logicalName, version: ref.version,
    versionId: ref.versionId, sha256: '', title: ref.title, ...ref.caption === undefined ? {} : { caption: ref.caption },
    mediaType: ref.mediaType, byteCount: ref.byteCount, contentOrigin: 'run-auto', createdAt: ref.createdAt,
  }
}

function ReadOnlyPreview({ chart, loadImage, loadText, t }: {
  chart: ScienceRenderableVersion
  loadImage: ScienceImageLoader
  loadText: TextLoader
  t: TranslateNS<'science'>
}) {
  return <ArtifactContent
    chart={chart} loadImage={loadImage} loadText={loadText} selectionTarget={undefined}
    /* v8 ignore next -- read-only previews deliberately expose an inert selection hook */
    onSelectTarget={() => {}}
    /* v8 ignore next -- read-only previews never stage selection targets */
    isTargetAdded={() => false}
    /* v8 ignore next -- read-only previews have no target comments */
    targetComment={() => ''}
    /* v8 ignore next -- read-only previews cannot add targets */
    onAddTarget={() => {}}
    /* v8 ignore next -- read-only previews cannot remove targets */
    onRemoveTarget={() => {}}
    // A preview's `chart.versionId` is never a genuinely addressable store
    // version (a workspace file's path, or a library row shown outside its
    // own open-tab flow), so the edit panel never mounts here — resolving
    // `null` locally skips a request this build already knows would find
    // nothing to edit.
    /* v8 ignore next -- read-only previews never carry an addressable chart, so this loader is never awaited by a test assertion */
    loadChartState={() => Promise.resolve(null)}
    /* v8 ignore next -- read-only previews never carry an addressable chart, so Save is never invoked */
    onSaveChartOps={() => Promise.resolve({ ok: false, error: '' })}
    t={t}
  />
}

/**
 * The closed-enum reason a `science-artifact-error` failure carries in
 * `details.reason`, when present. The wire type widens `reason` to `string`
 * (`packages/host/apiproxy/src/api/rpc.ts`), so every caller below switches
 * on this extracted value rather than narrowing the RPC error type further.
 * @param error - the RPC failure to inspect.
 * @returns the host's reason string, or `undefined` for any other error code.
 */
function scienceArtifactErrorReason(error: RpcError): string | undefined {
  return error.code === 'science-artifact-error' ? error.details.reason : undefined
}

/**
 * Localize a `readWorkspaceFile` RPC failure for the project-file preview.
 * The host's `WorkspaceReadError` reason (`packages/host/apiproxy/src/api-proxy.ts`)
 * is a closed three-value enum carried as `science-artifact-error`'s
 * `details.reason`, but the wire type widens it to `string` — an
 * unrecognized reason (a future host value this build predates) and every
 * other error code fall back to a generic localized notice. `error.message`
 * is the host's own English text for logs and non-localized callers; it
 * must never reach this screen directly.
 * @param error - the RPC failure from `loadWorkspaceFile`.
 * @param t - the Science namespace translator.
 * @returns localized notice text for the preview body.
 */
function workspaceFileErrorText(error: RpcError, t: TranslateNS<'science'>): string {
  switch (scienceArtifactErrorReason(error)) {
    case 'NO_WORKSPACE': return t('library.fileNoWorkspace')
    case 'PATH_OUTSIDE_WORKSPACE': return t('library.filePathOutside')
    case 'FILE_TOO_LARGE': return t('library.fileTooLarge')
    // `internal` (host process/authorization failures) and any reason this
    // build does not recognize (a future host value) fall back to the
    // generic notice.
    default: return t('library.fileOpenFailed')
  }
}

/**
 * Localize a `readScienceLibrary` RPC failure for the project artifact
 * library. `scienceLibrary` (`packages/host/apiproxy/src/api-proxy.ts`)
 * returns `science-artifact-error`'s `NO_WORKSPACE` reason directly when the
 * session carries no workspace directory, and otherwise forwards a
 * `ProjectArtifactStoreErrorCode` (`SCHEMA_VERSION_MISMATCH` | `INVALID_MARKER`
 * | `ARTIFACT_NOT_FOUND` | `VERSION_NOT_FOUND` | `BLOB_NOT_FOUND` |
 * `BLOB_CORRUPT`, `packages/science/science-artifact-store/src/errors.ts`) as
 * the same reason. None of those store codes are user-actionable, so only
 * `NO_WORKSPACE` gets specific text; `internal` and every other reason
 * (including every `ProjectArtifactStoreErrorCode`) fall back to the generic
 * notice. `error.message` is the host's own English text for logs and
 * non-localized callers; it must never reach this screen directly.
 * @param error - the RPC failure from `loadLibrary`.
 * @param t - the Science namespace translator.
 * @returns localized notice text for the library panel.
 */
function libraryErrorText(error: RpcError, t: TranslateNS<'science'>): string {
  switch (scienceArtifactErrorReason(error)) {
    case 'NO_WORKSPACE': return t('library.libraryNoWorkspace')
    // `ProjectArtifactStoreErrorCode` values, `internal`, and any reason this
    // build does not recognize are not user-actionable and fall back to the
    // generic notice.
    default: return t('library.libraryLoadFailed')
  }
}

/**
 * Localize a `readWorkspaceFiles` RPC failure for the project-file listing.
 * `workspaceFiles` (`packages/host/apiproxy/src/api-proxy.ts`) resolves the
 * requested directory through the same `resolveWorkspacePath` helper as
 * `workspaceFile`, so it can carry the same `NO_WORKSPACE` or
 * `PATH_OUTSIDE_WORKSPACE` `WorkspaceReadError` reason — never
 * `FILE_TOO_LARGE`, which `workspaceFile` throws only past its is-a-file
 * check. `internal` and any reason this build does not recognize fall back
 * to the generic notice. `error.message` is the host's own English text for
 * logs and non-localized callers; it must never reach this screen directly.
 * @param error - the RPC failure from `loadWorkspaceFiles`.
 * @param t - the Science namespace translator.
 * @returns localized notice text for the project-file listing.
 */
function projectFilesErrorText(error: RpcError, t: TranslateNS<'science'>): string {
  switch (scienceArtifactErrorReason(error)) {
    case 'NO_WORKSPACE': return t('library.filesNoWorkspace')
    case 'PATH_OUTSIDE_WORKSPACE': return t('library.filesPathOutside')
    // `internal` and any reason this build does not recognize (including a
    // `FILE_TOO_LARGE` this RPC cannot actually produce) fall back to the
    // generic notice.
    default: return t('library.filesListFailed')
  }
}

function WorkspaceFilePreview({ path, loadWorkspaceFile, t }: {
  path: string
  loadWorkspaceFile: ScienceDetailsInjected['loadWorkspaceFile']
  t: TranslateNS<'science'>
}) {
  const [loaded, setLoaded] = useState<{ mediaType: string; byteCount: number; data: Uint8Array }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    void loadWorkspaceFile(path).then((result) => {
      if (!live) return
      if (result.ok) setLoaded(result.value); else setError(workspaceFileErrorText(result.error, t))
    })
    return () => { live = false }
  }, [loadWorkspaceFile, path, t])
  if (error !== undefined) return <p role="alert" className={css.notice}>{error}</p>
  if (loaded === undefined) return <p role="status" className={css.notice}>{t('artifact.loading')}</p>
  if (!isPreviewMediaType(loaded.mediaType)) {
    return <p className={css.notice}>{t('library.unsupported', { bytes: formatBytes(loaded.byteCount) })}</p>
  }
  const chart = previewChart({
    artifactId: path, logicalName: path, title: workspaceFileName(path),
    versionId: path, version: 1, mediaType: loaded.mediaType, byteCount: loaded.byteCount, createdAt: 0,
  })
  const loadText: TextLoader = () => Promise.resolve(new TextDecoder('utf-8', { fatal: true }).decode(loaded.data))
  const loadImage: ScienceImageLoader = () => {
    let binary = ''
    for (let offset = 0; offset < loaded.data.length; offset += 0x8000) {
      binary += String.fromCharCode(...loaded.data.subarray(offset, offset + 0x8000))
    }
    return Promise.resolve(`data:${loaded.mediaType};base64,${btoa(binary)}`)
  }
  return <ReadOnlyPreview chart={chart} loadImage={loadImage} loadText={loadText} t={t} />
}

/** User-only review notes attached to the logical artifact across versions. */
function ArtifactNotes({ chart, notes, addArtifactNote, removeArtifactNote, t }: {
  chart: ScienceRenderableVersion
  notes: readonly ScienceArtifactNote[]
  addArtifactNote: ScienceDetailsInjected['addArtifactNote']
  removeArtifactNote: ScienceDetailsInjected['removeArtifactNote']
  t: TranslateNS<'science'>
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  return (
    <section className={css.notes} aria-label={t('notes.title')}>
      <h3>{t('notes.title')}</h3>
      {notes.length === 0 ? null : <ul>{notes.map(note => (
        <li key={note.seq}>
          <span>{note.text}</span>
          <small>{t('notes.version', { version: note.version, time: new Date(note.createdAt).toLocaleString() })}</small>
          <button type="button" aria-label={t('notes.delete')} disabled={pending} onClick={() => {
            setPending(true); setError(undefined)
            void removeArtifactNote({ artifactId: chart.artifactId, noteSeq: note.seq })
              .then((result) => { if (!result.ok) setError(result.error.message) })
              .finally(() => { setPending(false) })
          }}>{t('notes.delete')}</button>
        </li>
      ))}</ul>}
      <form onSubmit={(event) => {
        event.preventDefault()
        const value = text.trim()
        if (value === '') return
        setPending(true); setError(undefined)
        void addArtifactNote({ artifactId: chart.artifactId, version: chart.version, text: value })
          .then((result) => { if (result.ok) setText(''); else setError(result.error.message) })
          .finally(() => { setPending(false) })
      }}>
        <textarea value={text} aria-label={t('notes.input')} placeholder={`${t('notes.placeholder')}\n${t('notes.privacy')}`}
          onChange={(event) => { setText(event.currentTarget.value) }} />
        <button type="submit" disabled={pending || text.trim() === ''}>{t('notes.add')}</button>
      </form>
      {error !== undefined && <p role="alert">{error}</p>}
    </section>
  )
}

/** Loaders, mutations, and presentation supplied to every artifact tab. */
type ArtifactControls = Pick<ScienceDetailsViewProps,
  | 'loadImage' | 'loadText' | 'loadChartState' | 'addToConversation' | 'removeFromConversation'
  | 'composerSelections'
  | 'addArtifactNote' | 'removeArtifactNote' | 'saveArtifactAs' | 'applyChartOps' | 'previewChartOps'
  | 'actions' | 't'>

/**
 * Localize a `saveArtifactAs` RPC failure for the toolbar's inline form.
 * @param code - the Remote failure's stable rejection class.
 * @param t - the Science namespace translator.
 * @returns localized notice text for the save-as form.
 */
function saveAsErrorText(code: string, t: TranslateNS<'science'>): string {
  switch (code) {
    case 'SAVE_AS_SOURCE_NOT_FOUND': return t('toolbar.saveAsSourceNotFound')
    case 'SAVE_AS_NAME_CONFLICT': return t('toolbar.saveAsNameConflict')
    default: return t('toolbar.saveAsFailed')
  }
}

/**
 * Build one `onSaveAs` closure for a toolbar: duplicates the named source
 * version and, on success, switches the active tab to the new artifact's
 * first version — the Files panel picks up the new artifact on its own next
 * mount (it always re-reads `loadLibrary` fresh), so no explicit
 * invalidation signal is needed here.
 * @param saveArtifactAs - the injected `saveArtifactAs` Remote call.
 * @param actions - the selection store's action bag (for `openTab`).
 * @param t - the Science namespace translator.
 * @returns a `(sourceVersionId) => (newLogicalName) => outcome` curried handler.
 */
function createSaveAsHandler(
  saveArtifactAs: ScienceDetailsInjected['saveArtifactAs'],
  actions: ScienceDetailsViewProps['actions'],
  t: TranslateNS<'science'>,
) {
  return (sourceVersionId: string) => (newLogicalName: string): Promise<{ ok: true } | { ok: false; message: string }> =>
    saveArtifactAs({ sourceVersionId, newLogicalName }).then((result) => {
      if (!result.ok) return { ok: false, message: saveAsErrorText(result.error.code, t) }
      actions.openTab({ artifactId: result.value.artifactId, version: result.value.version })
      return { ok: true }
    })
}

/** One open tab's body: the toolbar plus dispatched content, or — one toolbar click away — the provenance drill-in. */
function ArtifactTab({
  currentSessionId, rawArtifacts, chart, notes, view, loadImage, loadText, loadChartState,
  addToConversation, removeFromConversation, composerSelections,
  addArtifactNote, removeArtifactNote, saveArtifactAs, applyChartOps, previewChartOps, actions, t,
}: {
  currentSessionId: SessionId
  /** The session-log identity list, used only to derive the stepper's sibling version numbers. */
  rawArtifacts: readonly ScienceClientArtifactVersion[]
  chart: ScienceRenderableVersion
  notes: readonly ScienceArtifactNote[]
  view: ScienceArtifactView
} & ArtifactControls) {
  const versions = versionsOf(rawArtifacts, chart.artifactId)
  const saveAs = createSaveAsHandler(saveArtifactAs, actions, t)
  const [target, setTarget] = useState<ScienceEditTarget | undefined>(undefined)
  const [previewSrc, setPreviewSrc] = useState<string>()
  const staged = useSyncExternalStore(
    notify => composerSelections.subscribe(notify),
    () => composerSelections.getSnapshot(),
    /* v8 ignore next -- the browser-only Science viewer has no server render path. */
    () => composerSelections.getSnapshot(),
  )
  useEffect(() => {
    setTarget(undefined)
    setPreviewSrc(undefined)
  }, [chart.artifactId, chart.version])

  // B4: when the model (or another client) commits a newer version of this
  // exact open tab's artifact WHILE the tab is open, step the tab to it
  // automatically. Tracked against the latest version last observed for this
  // artifactId (not against chart.version, the tab's currently shown
  // version) so opening a tab deliberately at an older version, or the
  // toolbar's own manual stepper walking back through history, never gets
  // yanked forward — only a genuine increase in the known latest triggers
  // this. A chart panel with a pending (unsaved) direct edit reports it
  // through onPendingChartEditsChange below and suppresses this: stepping
  // out from under an in-progress edit would either discard it silently or
  // surface a confusing CHART_STALE_VERSION on Save, and the existing
  // stale-version notice already covers that case once the user does Save.
  const [hasPendingChartEdits, setHasPendingChartEdits] = useState(false)
  // `versions` always includes `chart` itself, so `versions.at(-1)` is never
  // empty in practice; `Math.max` over both stays correct even if that ever
  // stopped holding, with no separate empty-versions fallback to maintain.
  const latestVersion = Math.max(chart.version, ...versions.map(candidate => candidate.version))
  const knownLatest = useRef({ artifactId: chart.artifactId, version: latestVersion })
  useEffect(() => {
    if (knownLatest.current.artifactId !== chart.artifactId) {
      knownLatest.current = { artifactId: chart.artifactId, version: latestVersion }
      return
    }
    if (hasPendingChartEdits) return
    if (latestVersion > knownLatest.current.version) {
      actions.setTabVersion({ artifactId: chart.artifactId, version: latestVersion })
    }
    knownLatest.current = { artifactId: chart.artifactId, version: latestVersion }
  }, [latestVersion, hasPendingChartEdits, chart.artifactId, actions])

  const selectTarget = (next: ScienceEditTarget): void => {
    setTarget(next)
  }
  const selectionFor = (next: ScienceEditTarget): ScienceEditSelection | undefined => staged.find(selection =>
    selection.artifactId === chart.artifactId && selection.version === chart.version
    && JSON.stringify(selection.target) === JSON.stringify(next))

  // Scoped to this exact open tab's artifact/version: a successful apply
  // steps the tab to the committed human-edit version so the viewer renders
  // the kernel's real output, matching the toolbar's own version stepper.
  const saveChartOps = (ops: readonly ScienceChartOp[]): Promise<ScienceChartSaveOutcome> =>
    applyChartOps({ artifactId: chart.artifactId, version: chart.version, ops }).then((result) => {
      if (!result.ok) return { ok: false, error: result.error.message }
      actions.setTabVersion({ artifactId: chart.artifactId, version: result.value.version })
      return { ok: true, failedOps: result.value.failedOps }
    })
  const previewOps = useCallback((ops: readonly ScienceChartOp[]) => previewChartOps({
    artifactId: chart.artifactId, version: chart.version, ops,
  }).then(result => result.ok
    ? { ok: true as const, pngBase64: result.value.pngBase64, failedOps: result.value.failedOps }
    : { ok: false as const, error: result.error.message }), [previewChartOps, chart.artifactId, chart.version])

  if (view === 'provenance') {
    return <ScienceArtifactProvenance chart={chart} onBack={() => { actions.setView('content') }} t={t} />
  }

  return (
    <>
      <ArtifactToolbar
        chart={chart}
        versions={versions}
        onBack={() => { actions.showLibrary() }}
        onStepVersion={(version) => { actions.setTabVersion({ artifactId: chart.artifactId, version }) }}
        onOpenProvenance={() => { actions.setView('provenance') }}
        onMaximize={() => { actions.setLightboxOpen(true) }}
        onCloseTab={() => { actions.closeTab(`artifact:${chart.artifactId}`) }}
        sessionId={currentSessionId}
        onSaveAs={saveAs(chart.versionId)}
        t={t}
      />
      <ArtifactContent
        // Keyed by exact artifact identity: forces a full remount (comment
        // drafts and an in-progress raster
        // drag) on every tab switch or version step, so a typed-but-unstaged
        // comment for one artifact/version never pre-fills another's field
        // that happens to share the same spec path or region coordinates.
        key={`${chart.artifactId}:${String(chart.version)}`}
        chart={chart}
        loadImage={loadImage}
        loadText={loadText}
        loadChartState={loadChartState}
        {...previewSrc === undefined ? {} : { previewSrc }}
        selectionTarget={target}
        onSelectTarget={selectTarget}
        isTargetAdded={next => selectionFor(next) !== undefined}
        targetComment={next => selectionFor(next)?.comment ?? ''}
        onAddTarget={(next, comment) => { addToConversation([{
          artifactId: chart.artifactId,
          logicalName: chart.logicalName,
          version: chart.version,
          target: next,
          ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
        }]) }}
        onRemoveTarget={(next) => {
          const selection = selectionFor(next)
          /* v8 ignore next -- ArtifactContent only offers Remove for a target that is already staged. */
          if (selection !== undefined) removeFromConversation(selection)
        }}
        onSaveChartOps={saveChartOps}
        onPreviewChartOps={previewOps}
        onPreviewSrc={setPreviewSrc}
        onPendingChartEditsChange={setHasPendingChartEdits}
        t={t}
      />
      <ArtifactNotes chart={chart} notes={notes} addArtifactNote={addArtifactNote} removeArtifactNote={removeArtifactNote} t={t} />
    </>
  )
}

function ArtifactViewer({
  science, notes, currentSessionId, loadVersions,
  loadLibrary, loadWorkspaceFiles, loadWorkspaceFile, useStore, ...controls
}: {
  science: ScienceClientProjection
  notes: ScienceArtifactNotesProjection
  currentSessionId: SessionId
} & ArtifactControls & Pick<ScienceDetailsViewProps, 'loadLibrary' | 'loadWorkspaceFiles' | 'loadWorkspaceFile' | 'loadVersions' | 'useStore'>) {
  const { loadImage, loadText, actions, t } = controls
  const openArtifacts = useStore(s => s.openArtifacts)
  const lightboxOpen = useStore(s => s.lightboxOpen)
  const activeTabId = useStore(s => s.activeTabId)
  const libraryPage = useStore(s => s.libraryPage)
  const libraryCollapsed = useStore(s => s.libraryCollapsed)
  const view = useStore(s => s.view)
  const artifacts = science.artifacts
  const libraryTabs = useStore(state => state.libraryTabs)
  const libraryCharts = Object.values(libraryTabs).map(item => previewChart({
    artifactId: item.artifactId, logicalName: item.logicalName, title: item.title ?? item.logicalName,
    ...(item.caption === undefined ? {} : { caption: item.caption }), versionId: item.latest.versionId,
    version: item.latest.ordinal, mediaType: item.latest.mediaType, byteCount: item.latest.byteCount, createdAt: item.latest.createdAt,
  }))

  // `showLibrary` deliberately leaves open tabs intact while clearing the
  // active id; every non-null active id still names one open tab.
  const activeTab = openArtifacts.find(tab => scienceTabId(tab) === activeTabId)
  const activeArtifactTab = activeTab?.kind === 'artifact' ? activeTab : undefined
  // A live in-session artifact takes precedence over a same-id/version
  // library preview (matches the previous single-array `.find` order).
  const activeRawArtifact = artifacts.find(candidate =>
    candidate.artifactId === activeArtifactTab?.artifactId && candidate.version === activeArtifactTab.version)
  const activeLibraryChart = activeRawArtifact === undefined ? libraryCharts.find(candidate =>
    candidate.artifactId === activeArtifactTab?.artifactId && candidate.version === activeArtifactTab.version) : undefined
  // D9: current library facts for every version of the active live artifact,
  // batched once per artifact — a Hook, so it runs on every render
  // (including the two early-return branches below) with an empty request
  // while nothing is active.
  const liveVersionIds = activeRawArtifact === undefined ? [] : versionsOf(artifacts, activeRawArtifact.artifactId).map(v => v.versionId)
  const summaries = useScienceVersionSummaries(loadVersions, liveVersionIds)
  const renderChart = activeRawArtifact === undefined ? undefined : toRenderableVersion(activeRawArtifact, summaries)
  const saveAs = createSaveAsHandler(controls.saveArtifactAs, actions, t)

  if (activeTab === undefined) {
    return (
      <div className={css.body}>
        <ProjectLibrary key={science.artifacts.map(item => `${item.artifactId}:${String(item.version)}`).join('|')}
          page={libraryPage}
          collapsed={libraryCollapsed} onToggleGroup={actions.toggleLibraryGroup}
          loadLibrary={loadLibrary} loadWorkspaceFiles={loadWorkspaceFiles} loadImage={loadImage}
          currentSessionId={currentSessionId}
          onOpenArtifact={(item) => {
            actions.rememberLibraryArtifact(item)
            actions.openTab({ artifactId: item.artifactId as ScienceArtifactId, version: item.latest.ordinal })
          }}
          onOpenFile={(path) => { actions.openFileTab(path) }} t={t} />
      </div>
    )
  }

  if (activeTab.kind === 'file') {
    return <div className={css.body}><div className={css.fileHead}><button type="button" onClick={() => { actions.showLibrary() }}>‹ {t('details.artifact.back')}</button><strong>{activeTab.path.split('/').at(-1)}</strong></div><WorkspaceFilePreview key={activeTab.path} path={activeTab.path} loadWorkspaceFile={loadWorkspaceFile} t={t} /></div>
  }

  // T3 reconciliation: only a library-opened tab (never a live in-session
  // one) carries a `latest.health` mark at all — see `scienceLibrary`'s
  // response shape (`dsh-host-apiproxy`).
  const libraryContentUnavailable = activeLibraryChart !== undefined
    && libraryTabs[activeLibraryChart.artifactId]?.latest.health?.missingContent === true
  const resolvedChart = activeLibraryChart ?? renderChart

  return (
    <div className={css.body}>
      {activeRawArtifact === undefined && activeLibraryChart === undefined
        ? <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
        : activeLibraryChart !== undefined ? (
          view === 'provenance'
            ? <div className={css.body}>
              <nav className={css.breadcrumb} aria-label={t('provenance.label')}>
                <button type="button" className={css.breadcrumbRoot} onClick={() => { actions.setView('content') }}>
                  {activeLibraryChart.title}
                </button>
                <span className={css.breadcrumbSep} aria-hidden="true">›</span>
                <span className={css.breadcrumbCurrent}>{t('provenance.label')}</span>
              </nav>
              <section className={css.editPanel}>
                <strong>{t('provenance.messages.sourceSession')}</strong>
                <span>{libraryTabs[activeLibraryChart.artifactId]?.originSessionTitle
                  ?? libraryTabs[activeLibraryChart.artifactId]?.originSessionId}</span>
                <button type="button" disabled title={t('library.sourceNavigationUnavailable')}>
                  {t('provenance.messages.conversation')}
                </button>
              </section>
            </div>
            : <><ArtifactToolbar chart={activeLibraryChart} versions={[activeLibraryChart]} onBack={() => { actions.showLibrary() }}
              /* v8 ignore next -- the library RPC supplies only the latest version, so both step controls are disabled */
              onStepVersion={() => {}} onOpenProvenance={() => { actions.setView('provenance') }}
              onMaximize={() => { actions.setLightboxOpen(true) }}
              onCloseTab={() => { actions.closeTab(`artifact:${activeLibraryChart.artifactId}`) }}
              sessionId={currentSessionId} onSaveAs={saveAs(activeLibraryChart.versionId)}
              t={t} contentUnavailable={libraryContentUnavailable} />
            {libraryContentUnavailable
              ? <p className={css.notice} role="status">{t('library.reconcile.detailMissingContent')}</p>
              : <ReadOnlyPreview chart={activeLibraryChart} loadImage={loadImage} loadText={loadText} t={t} />}</>
        ) : renderChart === undefined ? (
          <p className={css.notice} role="status">{t('artifact.loading')}</p>
        ) : (
          <ArtifactTab
            currentSessionId={currentSessionId}
            rawArtifacts={artifacts}
            chart={renderChart}
            notes={notes.filter(note => note.artifactId === renderChart.artifactId)}
            view={view}
            {...controls}
          />
        )}
      {resolvedChart?.mediaType === 'image/png' && <ArtifactLightbox
        key={resolvedChart.versionId}
        chart={resolvedChart as ScienceRenderableVersion & { mediaType: 'image/png' }}
        loadImage={loadImage} open={lightboxOpen} onClose={() => { actions.setLightboxOpen(false) }} t={t} />}
    </div>
  )
}

/**
 * Client-safe projection rendered for a current Session that has not (yet)
 * bound Science mode (`useProjection('science')` returns `null` — a blank
 * Session, or one where the first `science/mode-bound` event has not
 * appended yet). Every field the artifact library and its viewer read
 * (`artifacts`, `runs`, `kernels`) is empty; `mode`/`environment`/`outcome`/
 * `metrics` are inert placeholders that no Details component under this
 * projection reads — `ArtifactViewer`'s no-tab landing view sources the
 * library entirely from the `loadLibrary` RPC (project-wide, grouped by
 * conversation), independent of this session's own projection.
 */
const EMPTY_SCIENCE_PROJECTION: ScienceClientProjection = {
  mode: { modeId: 'science', presetId: 'science', modeRevision: '' },
  environment: null,
  runs: [],
  kernels: [],
  artifacts: [],
  outcome: null,
  metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, kernelCount: 0, outcomeRevision: 0 },
  lastScienceEventSeq: -1,
}

/**
 * Render the Science Details entry (the artifact viewer) from the current
 * `science` projection and the shared selection store.
 * @param props - runtime slot currency, the injected loaders, the shared
 * selection store, the Details-seam jump handoff, and the science locale seat.
 * @returns the current-state Science surface for this session.
 */
export function ScienceDetailsView({
  sessionId, useProjection, useStore, actions,
  ...controls
}: ScienceDetailsViewProps) {
  const science = useProjection('science')
  const notes = useProjection('scienceArtifactNotes') ?? []

  if (science === undefined) {
    return (
      <div className={css.body}>
        <p className={css.notice} role="status">{controls.t('details.missingSupport')}</p>
      </div>
    )
  }

  return (
    <ArtifactViewer
      science={science ?? EMPTY_SCIENCE_PROJECTION} notes={notes} currentSessionId={sessionId}
      useStore={useStore} actions={actions} {...controls}
    />
  )
}
