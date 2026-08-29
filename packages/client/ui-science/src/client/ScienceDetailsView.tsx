// Science Details entry: the artifact viewer over the accepted client-safe
// `science` Session projection (packages/science/science-session/src/types.ts).
// Viewer-first, not a dashboard: a top tab strip holds one tab per opened
// artifact (logical chart); the active tab shows an in-panel toolbar
// (filename, version stepper, provenance, download, maximize [image only],
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
// "not applied" notice replaces them). The top-level missing-support/unbound
// states below are unrelated to that strip and are unchanged.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-attachment/client'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseFill14, IconCloseOutline16,
  IconDownloadOutline16, IconFullscreenOutline16, IconInspectOutline12, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, ISession, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.details.view,
// and its owner share's inspectCall).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ScienceArtifactId, ScienceArtifactMediaType, ScienceArtifactNote, ScienceArtifactNotesProjection,
  ScienceChartOp, ScienceClientArtifactVersion, ScienceClientProjection,
} from '@deepseek-ai/dsh-science-session/types'
import type {
  ScienceArtifactNoteReceipt, ScienceChartEditReceipt, ScienceChartPreviewReceipt, ScienceEditSelection, ScienceEditTarget,
} from '@deepseek-ai/dsh-tool-science/types'
import { artifactImageLabels, ArtifactContent } from './ArtifactContent.tsx'
import { ArtifactFileTile } from './ArtifactFileTile.tsx'
import { scienceArtifactDisplayTitle } from './artifact-display-title.ts'
import { foldIntermediateVersions } from './intermediate-versions.ts'
import type { ScienceChartSaveOutcome } from './ScienceChartEditPanel.tsx'
import { ScienceArtifactProvenance } from './ScienceArtifactProvenance.tsx'
import { scienceTabId } from './selection-store.ts'
import type { ScienceArtifactView, ScienceOpenTab, ScienceProvenanceSubTab, ScienceSelectionStore } from './selection-store.ts'
import type { ScienceImageLoader, TextLoader } from './science-attachment-loader.ts'
import { ScienceArtifactImage } from './ScienceArtifactImage.tsx'
import css from './ScienceDetailsView.module.css'

/** Business face this entry's registration injects. */
export interface ScienceDetailsInjected {
  /** Session-scoped image artifact loader (science-attachment-loader.ts). */
  loadImage: ScienceImageLoader
  /** Session-scoped text artifact loader (science-attachment-loader.ts). */
  loadText: TextLoader
  /** Read the project-level latest-artifact library. */
  loadLibrary: ISession['readScienceLibrary']
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
 * Filename base without its extension, plus the extension (including the dot).
 */
function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? { stem: name, ext: '' } : { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/**
 * The durable browser save name for one artifact version: its logical path
 * with the version inserted before the extension.
 */
function downloadFilename(chart: ScienceClientArtifactVersion): string {
  const { stem, ext } = splitExtension(chart.logicalName)
  return `${stem}-v${String(chart.version)}${ext}`
}

/** Trigger a browser save of the durable bytes behind one artifact version through a throwaway URI anchor. */
async function downloadArtifact(chart: ScienceClientArtifactVersion, loadImage: ScienceImageLoader, loadText: TextLoader): Promise<void> {
  const url = chart.mediaType === 'image/png'
    ? await loadImage(chart)
    : `data:${chart.mediaType};charset=utf-8,${encodeURIComponent(await loadText(chart))}`
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = downloadFilename(chart)
  anchor.click()
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
  chart: ScienceClientArtifactVersion & { mediaType: 'image/png' }
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

function ArtifactToolbar({ chart, versions, onBack, onStepVersion, onOpenProvenance, onMaximize, onCloseTab, loadImage, loadText, t }: {
  chart: ScienceClientArtifactVersion
  versions: readonly ScienceClientArtifactVersion[]
  onBack: () => void
  onStepVersion: (version: number) => void
  onOpenProvenance: () => void
  onMaximize: () => void
  onCloseTab: () => void
  loadImage: ScienceImageLoader
  loadText: TextLoader
  t: TranslateNS<'science'>
}) {
  // C2: same-turn intermediate drafts (a self-check re-render the model made
  // within one turn before curating a title) collapse out of the stepper's
  // default walk order; they stay reachable behind the expand toggle below,
  // and the currently open version is always kept walkable even if it is
  // itself one of them (a provenance drill-in or a direct link can still
  // open one directly).
  const [showIntermediates, setShowIntermediates] = useState(false)
  // The toolbar instance is not remounted on a tab switch (`ArtifactTab`
  // resolves the same component at the same position); reset the toggle so
  // a different artifact's tab never opens already expanded.
  useEffect(() => { setShowIntermediates(false) }, [chart.artifactId])
  const intermediateVersions = foldIntermediateVersions(versions)
  const walkable = showIntermediates
    ? versions
    : versions.filter(candidate => candidate.version === chart.version || !intermediateVersions.has(candidate.version))
  // `chart` is always one of `walkable` (either it is not collapsed, or the
  // filter above keeps the open version in regardless), so `index` is never
  // -1 — no defensive branch for it.
  const index = walkable.findIndex(candidate => candidate.version === chart.version)
  const prev = index > 0 ? walkable[index - 1] : undefined
  const next = index < walkable.length - 1 ? walkable[index + 1] : undefined
  const isImage = chart.mediaType === 'image/png'
  const exportUnavailableId = useId()

  return (
    <div className={css.toolbar}>
      <div className={css.toolbarTitle}>
        <button type="button" className={css.libraryBack} onClick={onBack}>
          <IconChevronLeftOutline14 size={12} />{t('details.artifact.back')}
        </button>
        {/* C1: the artifact's latest known title, fixed across the version stepper below. */}
        <span className={css.viewerTitle}>{scienceArtifactDisplayTitle(versions, chart.artifactId) ?? chart.title}</span>
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
        {intermediateVersions.size > 0 && (
          <button
            type="button"
            className={css.intermediateToggle}
            aria-pressed={showIntermediates}
            onClick={() => { setShowIntermediates(value => !value) }}
          >
            {showIntermediates ? t('toolbar.intermediateCollapse') : t('toolbar.intermediateExpand', { count: intermediateVersions.size })}
          </button>
        )}
        <button type="button" className={css.toolbarAction} aria-label={t('details.artifact.provenance')} onClick={onOpenProvenance}>
          <IconInspectOutline12 size={12} />
        </button>
        <button
          type="button" className={css.toolbarAction} aria-label={t('toolbar.download')}
          onClick={() => { void downloadArtifact(chart, loadImage, loadText).catch(() => {}) }}
        >
          <IconDownloadOutline16 size={14} />
        </button>
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
        {isImage && (
          <button type="button" className={css.toolbarAction} aria-label={t('details.artifact.expand')} onClick={onMaximize}>
            <IconFullscreenOutline16 size={14} />
          </button>
        )}
        <button type="button" className={css.toolbarAction} aria-label={t('toolbar.closeTab')} onClick={onCloseTab}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
    </div>
  )
}

function TabStrip({ tabs, artifacts, activeTabId, onActivate, onClose, t }: {
  tabs: readonly ScienceOpenTab[]
  artifacts: readonly ScienceClientArtifactVersion[]
  activeTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.tabStrip} role="tablist" aria-label={t('toolbar.openArtifacts')}>
      {tabs.map((tab) => {
        // C1: the tab label is the artifact's latest known title, not the
        // exact open version's own title, so it stays fixed while the
        // toolbar's version stepper walks the tab between versions.
        const label = tab.kind === 'artifact'
          ? scienceArtifactDisplayTitle(artifacts, tab.artifactId) ?? tab.artifactId
          : workspaceFileName(tab.path)
        const id = scienceTabId(tab)
        const active = id === activeTabId
        return (
          <div key={id} className={active ? `${css.tab} ${css.tabActive}` : css.tab}>
            <button type="button" role="tab" aria-selected={active} className={css.tabButton} onClick={() => { onActivate(id) }}>
              {label}
            </button>
            <button
              type="button" className={css.tabClose} aria-label={t('toolbar.closeNamedTab', { title: label })}
              onClick={() => { onClose(id) }}
            >
              <IconCloseFill14 size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${String(bytes)} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

interface LibraryArtifact {
  artifactId: string
  logicalName: string
  title?: string
  caption?: string
  originSessionId: string
  originSessionTitle?: string
  latest: {
    versionId: string
    ordinal: number
    mediaType: ScienceArtifactMediaType
    byteCount: number
    createdAt: number
  }
}
interface WorkspaceEntry {
  name: string
  kind: 'file' | 'dir'
  byteCount?: number
  modifiedAt: number
  mediaType?: string
}

/** Project-level library home: latest artifacts plus bounded workspace browsing. */
function ProjectLibrary({ page, loadLibrary, loadWorkspaceFiles, loadImage, onOpenArtifact, onOpenFile, currentSessionId, t }: {
  page: 'artifacts' | 'files'
  loadLibrary: ScienceDetailsInjected['loadLibrary']
  loadWorkspaceFiles: ScienceDetailsInjected['loadWorkspaceFiles']
  loadImage: ScienceImageLoader
  onOpenArtifact: (artifact: LibraryArtifact) => void
  onOpenFile: (path: string) => void
  currentSessionId: string
  t: TranslateNS<'science'>
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([])
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (page !== 'artifacts') return
    let live = true
    setError(undefined)
    void loadLibrary().then((result) => {
      if (!live) return
      if (result.ok) setArtifacts(result.value.artifacts)
      else setError(result.error.message)
    })
    return () => { live = false }
  }, [loadLibrary, page])

  useEffect(() => {
    if (page !== 'files') return
    let live = true
    setError(undefined)
    void loadWorkspaceFiles(path).then((result) => {
      if (!live) return
      if (result.ok) setEntries(result.value.entries)
      else setError(result.error.message)
    })
    return () => { live = false }
  }, [loadWorkspaceFiles, path, page])

  const needle = query.trim().toLocaleLowerCase()
  const visibleArtifacts = artifacts.filter(item => `${item.logicalName}\n${item.title ?? ''}`.toLocaleLowerCase().includes(needle)).sort((a, b) => {
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
      {page === 'artifacts' ? <>
        {visibleArtifacts.length === 0 && <p className={css.libraryEmpty} role="status">{t('details.artifacts.empty')}</p>}
        <ul className={layout === 'grid' ? css.chartList : css.libraryList}>{visibleArtifacts.map((item) => {
          const title = item.title ?? item.logicalName
          const source = item.originSessionId === currentSessionId
            ? t('library.currentSession')
            : item.originSessionTitle ?? item.originSessionId
          return <li key={item.artifactId} className={css.chartItem}><div role="button" tabIndex={0} aria-label={t('details.artifact.select', { title, version: item.latest.ordinal })} className={css.libraryCard} onClick={() => { onOpenArtifact(item) }} onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onOpenArtifact(item)
          }}>
            {item.latest.mediaType === 'image/png'
              ? <ScienceArtifactImage content={item.latest} label={title} load={loadImage} variant="tile" labels={artifactImageLabels(t)} />
              : <ArtifactFileTile mediaType={item.latest.mediaType} />}
            <span className={css.chartMeta}>
              <strong className={css.chartTitle}>{title}</strong>
              <span className={css.libraryFacts}>
                v{String(item.latest.ordinal)} · {item.latest.mediaType} · {source}
              </span>
            </span>
          </div></li>
        })}</ul>
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
}): ScienceClientArtifactVersion {
  return {
    ...ref, producerSessionId: '' as never, sha256: '', environmentRevision: 0, environmentFingerprintPreview: '',
    origin: 'auto', runId: '' as never, toolCallId: '' as never, requestHeaderSeq: 0,
  } as unknown as ScienceClientArtifactVersion
}

function ReadOnlyPreview({ chart, loadImage, loadText, t }: {
  chart: ScienceClientArtifactVersion
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
    /* v8 ignore next -- read-only previews never carry an addressable chart, so Save is never invoked */
    onSaveChartOps={() => Promise.resolve({ ok: false, error: '' })}
    t={t}
  />
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
      if (result.ok) setLoaded(result.value); else setError(result.error.message)
    })
    return () => { live = false }
  }, [loadWorkspaceFile, path])
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
  chart: ScienceClientArtifactVersion
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
      {notes.length === 0 ? <p>{t('notes.empty')}</p> : <ul>{notes.map(note => (
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
        <textarea value={text} aria-label={t('notes.input')} placeholder={t('notes.placeholder')}
          onChange={(event) => { setText(event.currentTarget.value) }} />
        <button type="submit" disabled={pending || text.trim() === ''}>{t('notes.add')}</button>
      </form>
      <p className={css.notesPrivacy}>{t('notes.privacy')}</p>
      {error !== undefined && <p role="alert">{error}</p>}
    </section>
  )
}

/** One open tab's body: the toolbar plus dispatched content, or — one toolbar click away — the provenance drill-in. */
function ArtifactTab({
  science, artifacts, chart, notes, currentSessionId, sourceSessionTitle, view, provenanceSubTab, snapshot, loadImage, loadText,
  addToConversation, removeFromConversation, composerSelections, returnToConversation, selectDetailed,
  addArtifactNote, removeArtifactNote, applyChartOps, previewChartOps, useStore, actions, inspectCall, t,
}: {
  science: ScienceClientProjection
  artifacts: readonly ScienceClientArtifactVersion[]
  chart: ScienceClientArtifactVersion
  notes: readonly ScienceArtifactNote[]
  currentSessionId: ScienceDetailsViewProps['sessionId']
  sourceSessionTitle: string | undefined
  view: ScienceArtifactView
  provenanceSubTab: ScienceProvenanceSubTab
  snapshot: ConversationSnapshot
  loadImage: ScienceImageLoader
  loadText: TextLoader
  addToConversation: ScienceDetailsInjected['addToConversation']
  removeFromConversation: ScienceDetailsInjected['removeFromConversation']
  composerSelections: ScienceDetailsInjected['composerSelections']
  returnToConversation: ScienceDetailsInjected['returnToConversation']
  selectDetailed: ScienceDetailsInjected['selectDetailed']
  addArtifactNote: ScienceDetailsInjected['addArtifactNote']
  removeArtifactNote: ScienceDetailsInjected['removeArtifactNote']
  applyChartOps: ScienceDetailsInjected['applyChartOps']
  previewChartOps: ScienceDetailsInjected['previewChartOps']
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  inspectCall: (callId: string) => void
  t: TranslateNS<'science'>
}) {
  const lightboxOpen = useStore(s => s.lightboxOpen)
  const versions = versionsOf(artifacts, chart.artifactId)
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
  // automatically — matching Save's existing step-to-committed-version
  // behavior above. Tracked against the latest version last observed for
  // this artifactId (not against chart.version, the tab's currently shown
  // version) so opening a tab deliberately at an older version, or the
  // toolbar's own manual stepper walking back through history, never gets
  // yanked forward — only a genuine increase in the known latest triggers
  // this. A chart panel with a pending (unsaved) direct edit reports it
  // through onPendingChartEditsChange below and suppresses this: stepping
  // out from under an in-progress edit would either discard it silently or
  // surface a confusing CHART_STALE_VERSION on Save, and the existing
  // stale-version notice already covers that case once the user does Save.
  const [hasPendingChartEdits, setHasPendingChartEdits] = useState(false)
  const latestVersion = versions.at(-1)?.version ?? chart.version
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
  const previewOps = (ops: readonly ScienceChartOp[]) => previewChartOps({
    artifactId: chart.artifactId, version: chart.version, ops,
  }).then(result => result.ok
    ? { ok: true as const, pngBase64: result.value.pngBase64, failedOps: result.value.failedOps }
    : { ok: false as const, error: result.error.message })

  if (view === 'provenance') {
    if (chart.origin === 'human-edit') {
      return (
        <div className={css.body}>
          <nav className={css.breadcrumb} aria-label={t('provenance.label')}>
            <button type="button" className={css.breadcrumbRoot} onClick={() => { actions.setView('content') }}>
              {scienceArtifactDisplayTitle(versions, chart.artifactId) ?? chart.title}
            </button>
            <span className={css.breadcrumbSep} aria-hidden="true">›</span>
            <span className={css.breadcrumbCurrent}>{t('provenance.label')}</span>
          </nav>
          <section className={css.editPanel}>
            <strong>{t('artifact.humanEdit', { version: chart.parent.version })}</strong>
            <span>{chart.artifactId} v{String(chart.version)}</span>
          </section>
        </div>
      )
    }
    const run = science.runs.find(candidate => candidate.runId === chart.runId)
    if (run === undefined) return <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
    return (
      <ScienceArtifactProvenance
        chart={chart}
        run={run}
        environment={science.environment}
        snapshot={snapshot}
        subTab={provenanceSubTab}
        onSubTabChange={(subTab) => { actions.setProvenanceSubTab(subTab) }}
        onBack={() => { actions.setView('content') }}
        inspectCall={inspectCall}
        selectDetailed={selectDetailed}
        currentSessionId={currentSessionId}
        sourceSessionTitle={sourceSessionTitle}
        returnToConversation={returnToConversation}
        t={t}
      />
    )
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
        loadImage={loadImage}
        loadText={loadText}
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
        {...previewSrc === undefined ? {} : { previewSrc }}
        loadImage={loadImage}
        loadText={loadText}
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
      {chart.mediaType === 'image/png' && (
        <ArtifactLightbox
          chart={chart as ScienceClientArtifactVersion & { mediaType: 'image/png' }}
          loadImage={loadImage}
          open={lightboxOpen}
          onClose={() => { actions.setLightboxOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}

function ArtifactViewer({
  science, notes, currentSessionId, sessionTitles, snapshot, loadImage, loadText,
  loadLibrary, loadWorkspaceFiles, loadWorkspaceFile, addToConversation, removeFromConversation,
  composerSelections, returnToConversation, selectDetailed, addArtifactNote, removeArtifactNote, applyChartOps, previewChartOps,
  useStore, actions, inspectCall, t,
}: {
  science: ScienceClientProjection
  notes: ScienceArtifactNotesProjection
  currentSessionId: ScienceDetailsViewProps['sessionId']
  sessionTitles: Readonly<Record<string, string>>
  snapshot: ConversationSnapshot
  loadImage: ScienceImageLoader
  loadText: TextLoader
  loadLibrary: ScienceDetailsInjected['loadLibrary']
  loadWorkspaceFiles: ScienceDetailsInjected['loadWorkspaceFiles']
  loadWorkspaceFile: ScienceDetailsInjected['loadWorkspaceFile']
  addToConversation: ScienceDetailsInjected['addToConversation']
  removeFromConversation: ScienceDetailsInjected['removeFromConversation']
  composerSelections: ScienceDetailsInjected['composerSelections']
  returnToConversation: ScienceDetailsInjected['returnToConversation']
  selectDetailed: ScienceDetailsInjected['selectDetailed']
  addArtifactNote: ScienceDetailsInjected['addArtifactNote']
  removeArtifactNote: ScienceDetailsInjected['removeArtifactNote']
  applyChartOps: ScienceDetailsInjected['applyChartOps']
  previewChartOps: ScienceDetailsInjected['previewChartOps']
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  inspectCall: (callId: string) => void
  t: TranslateNS<'science'>
}) {
  const openArtifacts = useStore(s => s.openArtifacts)
  const activeTabId = useStore(s => s.activeTabId)
  const libraryPage = useStore(s => s.libraryPage)
  const view = useStore(s => s.view)
  const provenanceSubTab = useStore(s => s.provenanceSubTab)
  const artifacts = science.artifacts
  const [libraryTabs, setLibraryTabs] = useState<Record<string, LibraryArtifact>>({})
  const libraryCharts = Object.values(libraryTabs).map(item => previewChart({
    artifactId: item.artifactId, logicalName: item.logicalName, title: item.title ?? item.logicalName,
    ...(item.caption === undefined ? {} : { caption: item.caption }), versionId: item.latest.versionId,
    version: item.latest.ordinal, mediaType: item.latest.mediaType, byteCount: item.latest.byteCount, createdAt: item.latest.createdAt,
  }))
  const tabArtifacts = [...artifacts, ...libraryCharts]

  // `showLibrary` deliberately leaves open tabs intact while clearing the
  // active id; every non-null active id still names one open tab.
  const activeTab = openArtifacts.find(tab => scienceTabId(tab) === activeTabId)
  const tabStrip = openArtifacts.length === 0 ? null : <TabStrip tabs={openArtifacts} artifacts={tabArtifacts} activeTabId={activeTabId}
    onActivate={(tabId) => { actions.activateTab(tabId) }}
    onClose={(tabId) => { actions.closeTab(tabId) }} t={t} />
  if (activeTab === undefined) {
    return (
      <div className={css.body}>
        {tabStrip}
        <ProjectLibrary key={science.artifacts.map(item => `${item.artifactId}:${String(item.version)}`).join('|')}
          page={libraryPage}
          loadLibrary={loadLibrary} loadWorkspaceFiles={loadWorkspaceFiles} loadImage={loadImage}
          currentSessionId={currentSessionId}
          onOpenArtifact={(item) => {
            setLibraryTabs(current => ({ ...current, [item.artifactId]: item }))
            actions.openTab({ artifactId: item.artifactId as ScienceArtifactId, version: item.latest.ordinal })
          }}
          onOpenFile={(path) => { actions.openFileTab(path) }} t={t} />
      </div>
    )
  }

  if (activeTab.kind === 'file') {
    return <div className={css.body}>{tabStrip}<div className={css.fileHead}><button type="button" onClick={() => { actions.showLibrary() }}>‹ {t('details.artifact.back')}</button><strong>{activeTab.path.split('/').at(-1)}</strong></div><WorkspaceFilePreview path={activeTab.path} loadWorkspaceFile={loadWorkspaceFile} t={t} /></div>
  }

  // The one remaining way `activeChart` resolves to undefined is the
  // durable projection not having this exact (artifactId, version) pair — a
  // stale tab, handled below as "artifact unavailable".
  const activeChart = tabArtifacts.find(candidate =>
    candidate.artifactId === activeTab.artifactId && candidate.version === activeTab.version)

  return (
    <div className={css.body}>
      {tabStrip}
      {activeChart === undefined
        ? <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
        : libraryTabs[activeChart.artifactId] !== undefined && !artifacts.includes(activeChart) ? (
          view === 'provenance'
            ? <div className={css.body}>
              <nav className={css.breadcrumb} aria-label={t('provenance.label')}>
                <button type="button" className={css.breadcrumbRoot} onClick={() => { actions.setView('content') }}>
                  {activeChart.title}
                </button>
                <span className={css.breadcrumbSep} aria-hidden="true">›</span>
                <span className={css.breadcrumbCurrent}>{t('provenance.label')}</span>
              </nav>
              <section className={css.editPanel}>
                <strong>{t('provenance.messages.sourceSession')}</strong>
                <span>{libraryTabs[activeChart.artifactId]?.originSessionTitle
                  ?? libraryTabs[activeChart.artifactId]?.originSessionId}</span>
                <button type="button" disabled title={t('library.sourceNavigationUnavailable')}>
                  {t('provenance.messages.conversation')}
                </button>
              </section>
            </div>
            : <><ArtifactToolbar chart={activeChart} versions={[activeChart]} onBack={() => { actions.showLibrary() }}
              /* v8 ignore next -- the library RPC supplies only the latest version, so both step controls are disabled */
              onStepVersion={() => {}} onOpenProvenance={() => { actions.setView('provenance') }}
              onMaximize={() => { actions.setLightboxOpen(true) }}
              onCloseTab={() => { actions.closeTab(`artifact:${activeChart.artifactId}`) }}
              loadImage={loadImage} loadText={loadText} t={t} />
            <ReadOnlyPreview chart={activeChart} loadImage={loadImage} loadText={loadText} t={t} /></>
        ) : (
          <ArtifactTab
            science={science}
            artifacts={artifacts}
            chart={activeChart}
            notes={notes.filter(note => note.artifactId === activeChart.artifactId)}
            currentSessionId={currentSessionId}
            sourceSessionTitle={sessionTitles[activeChart.producerSessionId]}
            view={view}
            provenanceSubTab={provenanceSubTab}
            snapshot={snapshot}
            loadImage={loadImage}
            loadText={loadText}
            addToConversation={addToConversation}
            removeFromConversation={removeFromConversation}
            composerSelections={composerSelections}
            returnToConversation={returnToConversation}
            selectDetailed={selectDetailed}
            addArtifactNote={addArtifactNote}
            removeArtifactNote={removeArtifactNote}
            applyChartOps={applyChartOps}
            previewChartOps={previewChartOps}
            useStore={useStore}
            actions={actions}
            inspectCall={inspectCall}
            t={t}
          />
        )}
    </div>
  )
}

/**
 * Render the Science Details entry (the artifact viewer) from the current
 * `science` projection and the shared selection store.
 * @param props - runtime slot currency, the injected loaders, the shared
 * selection store, the Details-seam jump handoff, and the science locale seat.
 * @returns the current-state Science surface for this session.
 */
export function ScienceDetailsView({
  sessionId, useSessions, useSession, useProjection, useStore, actions,
  inspectCall, loadImage, loadText, loadLibrary, loadWorkspaceFiles, loadWorkspaceFile,
  addToConversation, removeFromConversation, composerSelections,
  returnToConversation, selectDetailed, addArtifactNote, removeArtifactNote, applyChartOps, previewChartOps, t,
}: ScienceDetailsViewProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  // Session display titles change only when a title or the session list
  // itself changes, not on every streamed event — shallowEqual over the
  // derived record keeps the returned reference stable across unrelated frames.
  const sessionTitles = useSessions(
    state => Object.fromEntries(state.ids.map(id => [id, state.byId[id]?.displayTitle ?? id])),
    shallowEqual,
  )
  const science = useProjection('science')
  const notes = useProjection('scienceArtifactNotes') ?? []
  // ArtifactViewer's subtree reads only `nodes` (artifactTurn, here and in
  // ScienceArtifactProvenance.tsx) and `chat.nodes` (ScienceArtifactProvenance.tsx's
  // resolveRunCall) off the session snapshot; comparing just those two fields
  // keeps the returned snapshot reference stable across unrelated streaming
  // events (composer, queue, running-call byte updates) instead of on every one.
  const snapshot = useSession(s => s, (a, b) => a.nodes === b.nodes && a.chat === b.chat)

  if (science === undefined) {
    return (
      <div className={css.body}>
        <p className={css.notice} role="status">{t('details.missingSupport')}</p>
      </div>
    )
  }

  if (science === null) {
    return (
      <div className={css.body}>
        {preset !== undefined && <p className={css.preset}>{t('details.preset', { preset })}</p>}
        <p className={css.notice} role="status">{t('details.unbound')}</p>
      </div>
    )
  }

  return (
    <ArtifactViewer
      science={science} notes={notes} currentSessionId={sessionId} sessionTitles={sessionTitles}
      snapshot={snapshot} loadImage={loadImage} loadText={loadText}
      loadLibrary={loadLibrary} loadWorkspaceFiles={loadWorkspaceFiles} loadWorkspaceFile={loadWorkspaceFile}
      addToConversation={addToConversation}
      removeFromConversation={removeFromConversation} composerSelections={composerSelections} returnToConversation={returnToConversation}
      selectDetailed={selectDetailed}
      addArtifactNote={addArtifactNote} removeArtifactNote={removeArtifactNote}
      applyChartOps={applyChartOps} previewChartOps={previewChartOps}
      useStore={useStore} actions={actions} inspectCall={inspectCall} t={t}
    />
  )
}
