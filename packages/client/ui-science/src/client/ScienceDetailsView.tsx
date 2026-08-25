// Science Details entry: the artifact viewer over the accepted client-safe
// `science` Session projection (packages/science/science-session/src/types.ts).
// Viewer-first, not a dashboard: a single-row tab strip holds one tab per
// opened artifact (logical identity); the active tab shows its title and
// exact-version controls above the preview and user-only notes. With no
// active tab the panel shows the Files landing view: one latest-version tile
// per artifact identity. Outcome remains on its own Details route.
// It builds no second projection reader, artifact store, or Outcome editor;
// the one piece of local state it owns is the shared ui-science selection
// store (selection-store.ts). Thumbnails and content load through this
// package's own session-scoped loaders (science-attachment-loader.ts) —
// `loadImage` for an image attachment, `loadText` for CSV/JSON/Markdown/
// plain text.
//
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ImageLightbox, MessageImage, type ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment/client'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseFill14, IconCloseOutline16,
  IconDownloadOutline16, IconFullscreenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.details.view,
// and its owner share's inspectCall).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ScienceArtifactId, ScienceArtifactNote, ScienceClientArtifactVersion, ScienceClientProjection,
} from '@deepseek-ai/dsh-science-session/types'
import type {
  ScienceArtifactNoteReceipt, ScienceEditSelection, ScienceEditTarget, ScienceStyleEditReceipt, ScienceStyleEditRequest,
} from '@deepseek-ai/dsh-tool-science/types'
import { artifactImageLabels, ArtifactContent } from './ArtifactContent.tsx'
import { ArtifactFileTile } from './ArtifactFileTile.tsx'
import type { ScienceOpenArtifact, ScienceSelectionStore } from './selection-store.ts'
import type { TextLoader } from './science-attachment-loader.ts'
import css from './ScienceDetailsView.module.css'

/** Business face this entry's registration injects. */
export interface ScienceDetailsInjected {
  /** Session-scoped image artifact loader (science-attachment-loader.ts). */
  loadImage: ImageLoader
  /** Session-scoped text artifact loader (science-attachment-loader.ts). */
  loadText: TextLoader
  /** Add selected artifact elements to the main conversation composer. */
  addToConversation: (targets: readonly ScienceEditSelection[]) => void
  /** Remove one exact target from the main conversation composer. */
  removeFromConversation: (target: ScienceEditSelection) => void
  /** Observable exact targets currently staged in the main composer. */
  composerSelections: SnapshotStore<readonly ScienceEditSelection[]>
  /** Return to the assistant message that produced the selected version. */
  returnToConversation: (seq: number) => void
  /** Add one user-only note to a logical artifact. */
  addArtifactNote: (request: { artifactId: ScienceArtifactId; version: number; text: string }) => Promise<
    { readonly ok: true; readonly value: ScienceArtifactNoteReceipt } | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Remove one active user-only artifact note. */
  removeArtifactNote: (request: { artifactId: ScienceArtifactId; noteSeq: number }) => Promise<
    { readonly ok: true; readonly value: ScienceArtifactNoteReceipt } | { readonly ok: false; readonly error: { readonly message: string } }
  >
  /** Commit a complete styled Vega-Lite working copy over one exact current version. */
  commitStyleEdit: (request: ScienceStyleEditRequest) => Promise<
    | { readonly ok: true; readonly value: ScienceStyleEditReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
}

/** Full props for the Science Details entry. */
export type ScienceDetailsViewProps =
  PropsRuntime<'conversation.details.view'> & InjectFace<ScienceDetailsInjected>
  & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** Closed-union exhaustiveness fence. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

/** Latest accepted version per logical artifact, in first-appearance (commit) order. */
function latestArtifacts<T extends ScienceClientArtifactVersion>(artifacts: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const artifact of artifacts) {
    const current = byId.get(artifact.artifactId)
    if (current === undefined || artifact.version > current.version) byId.set(artifact.artifactId, artifact)
  }
  return [...byId.values()]
}

/** Every durable version of one logical artifact, ascending — the version stepper's walk order. */
function versionsOf<T extends ScienceClientArtifactVersion>(artifacts: readonly T[], artifactId: ScienceArtifactId): T[] {
  return artifacts.filter(artifact => artifact.artifactId === artifactId).sort((left, right) => left.version - right.version)
}

/**
 * Filename base without its extension, plus the extension (including the
 * dot). Splits on the last dot, except the two-part `.vl.json` suffix, which
 * stays whole so a version insertion never breaks the suffix the Vega-Lite
 * capture rule keys on.
 */
function splitExtension(name: string): { stem: string; ext: string } {
  if (name.toLowerCase().endsWith('.vl.json') && name.length > '.vl.json'.length) {
    return { stem: name.slice(0, -'.vl.json'.length), ext: name.slice(-'.vl.json'.length) }
  }
  const dot = name.lastIndexOf('.')
  return dot === -1 ? { stem: name, ext: '' } : { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/**
 * The durable browser save name for one artifact version: the attachment's
 * own display name when it has one, else the logical name (already the
 * captured file's real path, extension included) with the version inserted
 * before that extension.
 */
function downloadFilename(chart: ScienceClientArtifactVersion): string {
  if (chart.attachment.name !== undefined) return chart.attachment.name
  const { stem, ext } = splitExtension(chart.logicalName)
  return `${stem}-v${String(chart.version)}${ext}`
}

/** Trigger a browser save of the durable bytes behind one artifact version through a throwaway URI anchor. */
async function downloadArtifact(chart: ScienceClientArtifactVersion, loadImage: ImageLoader, loadText: TextLoader): Promise<void> {
  const { attachment } = chart
  const url = 'width' in attachment
    ? await loadImage(attachment)
    : `data:${attachment.mediaType};charset=utf-8,${encodeURIComponent(await loadText(attachment))}`
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
  chart: ScienceClientArtifactVersion & { attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }> }
  loadImage: ImageLoader
  open: boolean
  onClose: () => void
  t: TranslateNS<'science'>
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setSrc(null); return }
    let live = true
    void loadImage(chart.attachment).then((url) => { if (live) setSrc(url) }).catch(() => {})
    return () => { live = false }
  }, [open, chart.attachment, loadImage])

  if (!open || src === null) return null
  return (
    <ImageLightbox
      src={src}
      alt={chart.attachment.name ?? t('artifact.title')}
      labels={{ dialog: t('artifact.lightboxOriginal'), close: t('artifact.lightboxClose') }}
      onClose={onClose}
    />
  )
}

function ArtifactToolbar({
  chart, versions, sourceSeq, onBack, onStepVersion, onReturnToConversation, onMaximize, onCloseTab, loadImage, loadText, t,
}: {
  chart: ScienceClientArtifactVersion
  versions: readonly ScienceClientArtifactVersion[]
  sourceSeq: number | undefined
  onBack: () => void
  onStepVersion: (version: number) => void
  onReturnToConversation: (seq: number) => void
  onMaximize: () => void
  onCloseTab: () => void
  loadImage: ImageLoader
  loadText: TextLoader
  t: TranslateNS<'science'>
}) {
  const index = versions.findIndex(candidate => candidate.version === chart.version)
  const prev = index > 0 ? versions[index - 1] : undefined
  const next = index < versions.length - 1 ? versions[index + 1] : undefined
  const isImage = 'width' in chart.attachment
  const [downloadError, setDownloadError] = useState(false)

  useEffect(() => { setDownloadError(false) }, [chart.artifactId, chart.version])

  return (
    <div className={css.toolbar}>
      <div className={css.toolbarHeading}>
        <div className={css.toolbarTitle}>
          <button type="button" className={css.libraryBack} onClick={onBack}>
            <IconChevronLeftOutline14 size={12} />{t('details.artifact.back')}
          </button>
          <span className={css.viewerTitle}>{chart.title}</span>
        </div>
        <div className={css.toolbarActions}>
          <button
            type="button" className={css.toolbarAction} aria-label={t('toolbar.download')}
            onClick={() => {
              setDownloadError(false)
              void downloadArtifact(chart, loadImage, loadText).catch(() => { setDownloadError(true) })
            }}
          >
            <IconDownloadOutline16 size={14} />
          </button>
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
      <div className={css.toolbarNavigation}>
        <button type="button" className={css.conversationBack} disabled={sourceSeq === undefined}
          onClick={sourceSeq === undefined ? undefined : () => { onReturnToConversation(sourceSeq) }}>
          {t('toolbar.returnToConversation')}
        </button>
        <div className={css.stepper}>
          <button
            type="button" className={css.stepperButton} disabled={prev === undefined}
            aria-label={t('toolbar.versionPrev')}
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
      </div>
      {next !== undefined && (
        <p className={css.historicalNotice} role="status">
          {t('toolbar.historicalVersion', { version: chart.version, total: versions.length })}
        </p>
      )}
      {downloadError && <p className={css.viewerError} role="alert">{t('toolbar.downloadFailed')}</p>}
    </div>
  )
}

function TabStrip({ tabs, artifacts, activeArtifactId, onActivate, onClose, t }: {
  tabs: readonly ScienceOpenArtifact[]
  artifacts: readonly ScienceClientArtifactVersion[]
  activeArtifactId: ScienceArtifactId | null
  onActivate: (artifactId: ScienceArtifactId) => void
  onClose: (artifactId: ScienceArtifactId) => void
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.tabStrip} role="tablist" aria-label={t('toolbar.openArtifacts')}>
      {tabs.map((tab) => {
        const artifact = artifacts.find(candidate => candidate.artifactId === tab.artifactId && candidate.version === tab.version)
        const label = artifact?.title ?? tab.artifactId
        const active = tab.artifactId === activeArtifactId
        return (
          <div key={tab.artifactId} className={active ? `${css.tab} ${css.tabActive}` : css.tab}>
            <button type="button" role="tab" aria-selected={active} className={css.tabButton}
              onClick={() => { onActivate(tab.artifactId) }}>
              {label}
            </button>
            <button
              type="button" className={css.tabClose} aria-label={t('toolbar.closeNamedTab', { title: label })}
              onClick={() => { onClose(tab.artifactId) }}
            >
              <IconCloseFill14 size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function artifactType(chart: ScienceClientArtifactVersion, t: TranslateNS<'science'>): string {
  // Captured so the switch narrows this single literal-union binding rather
  // than the `chart.attachment.mediaType` member expression, which does not
  // narrow to `never` in the default case because `attachment`'s type
  // itself varies across ScienceClientArtifactVersion's union members.
  const mediaType = chart.attachment.mediaType
  switch (mediaType) {
    case 'application/vnd.vega-lite+json': return t('details.artifact.typeChart')
    case 'text/csv': return t('details.artifact.typeDataset')
    case 'application/json': return t('details.artifact.typeJson')
    case 'image/png': case 'image/jpeg': case 'image/webp': case 'image/gif': return t('details.artifact.typeImage')
    case 'text/markdown': case 'text/plain': return t('details.artifact.typeDocument')
    /* v8 ignore next -- closed media-type union */
    default: return assertNever(mediaType)
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${String(bytes)} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function artifactFacts(chart: ScienceClientArtifactVersion, t: TranslateNS<'science'>): string {
  const dimensions = 'width' in chart.attachment
    ? t('details.artifact.dimensions', { width: chart.attachment.width, height: chart.attachment.height })
    : undefined
  return [artifactType(chart, t), t('artifact.version', { version: chart.version }), dimensions, formatBytes(chart.attachment.bytes)]
    .filter((value): value is string => value !== undefined).join(' · ')
}

function ArtifactGallery({ artifacts, loadImage, onOpen, t }: {
  artifacts: readonly ScienceClientArtifactVersion[]
  loadImage: ImageLoader
  onOpen: (selection: { artifactId: ScienceArtifactId; version: number }) => void
  t: TranslateNS<'science'>
}) {
  const latest = latestArtifacts(artifacts)
  return (
    <div className={css.library}>
      <section className={css.librarySection}>
        <div className={css.librarySectionHead}><h3>{t('details.artifacts.generated')}</h3><span>{latest.length}</span></div>
        {latest.length === 0
          ? <p className={css.libraryEmpty} role="status">{t('details.artifacts.empty')}</p>
          : <ul className={css.chartList}>{latest.map((artifact) => {
            const { attachment } = artifact
            return (
              <li key={artifact.artifactId} className={css.chartItem}>
                {/* A real <button> wrapping MessageImage's own thumbnail <button>
                is invalid HTML that also breaks click delivery (a nested
                button swallows clicks meant for its ancestor, even from a
                sibling outside the inner button — proven by this exact
                structure in this package's own tests); a div with a button
                role is the same pattern ScienceArtifactRow's row uses. */}
                {/* An explicit label: without it this role="button" wrapper's
                accessible name is computed from its contents, which include
                MessageImage's own button — so the wrapper would announce (and
                match by role+name as) whatever state that thumbnail is in. */}
                <div
                  className={css.galleryButton}
                  role="button"
                  aria-label={t('details.artifact.select', { title: artifact.title, version: artifact.version })}
                  tabIndex={0}
                  onClick={() => { onOpen({ artifactId: artifact.artifactId, version: artifact.version }) }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onOpen({ artifactId: artifact.artifactId, version: artifact.version })
                  }}
                >
                  {'width' in attachment
                    ? <MessageImageTile attachment={attachment} loadImage={loadImage} t={t} />
                    : <ArtifactFileTile mediaType={attachment.mediaType} />}
                  <div className={css.chartMeta}>
                    <span className={css.chartTitle}>{artifact.title}</span>
                    <span className={css.libraryFacts}>{artifactFacts(artifact, t)}</span>
                  </div>
                </div>
              </li>
            )
          })}</ul>}
      </section>
    </div>
  )
}

/** Thin `MessageImage` wrapper isolating the `variant`/`labels` construction the gallery's `tile` thumbnails share. */
function MessageImageTile({ attachment, loadImage, t }: {
  attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }>
  loadImage: ImageLoader
  t: TranslateNS<'science'>
}) {
  return (
    <MessageImage
      attachment={attachment}
      load={loadImage}
      variant="tile"
      labels={artifactImageLabels(t)}
    />
  )
}

/** No active tab: the Files projection with one latest tile per artifact identity. */
function LandingView({ artifacts, loadImage, onOpenTab, t }: {
  artifacts: readonly ScienceClientArtifactVersion[]
  loadImage: ImageLoader
  onOpenTab: (selection: { artifactId: ScienceArtifactId; version: number }) => void
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.landing}>
      <section className={css.section}>
        <div className={css.sectionLabel}>{t('details.artifacts.title')}</div>
        <ArtifactGallery artifacts={artifacts} loadImage={loadImage} onOpen={onOpenTab} t={t} />
      </section>
    </div>
  )
}

/** User-only notes attached to the logical artifact across versions. */
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
          <span>{note.text}</span><small>{t('notes.version', {
            version: note.version, time: new Date(note.createdAt).toLocaleString(),
          })}</small>
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
        <textarea value={text} maxLength={8_192} aria-label={t('notes.input')} placeholder={t('notes.placeholder')}
          onChange={(event) => { setText(event.currentTarget.value) }} />
        <button type="submit" disabled={pending || text.trim() === ''}>{t('notes.add')}</button>
      </form>
      {error !== undefined && <p role="alert">{error}</p>}
    </section>
  )
}

function sourceAssistantSeq(
  chart: ScienceClientArtifactVersion,
  artifacts: readonly ScienceClientArtifactVersion[],
  snapshot: ConversationSnapshot,
): number | undefined {
  const source = chart.origin === 'human-edit'
    ? artifacts.find(candidate => candidate.artifactId === chart.parent.artifactId && candidate.version === chart.parent.version)
    : chart
  return source === undefined || source.origin === 'human-edit' ? undefined
    : snapshot.nodes.find(candidate => candidate.kind === 'assistant'
      && candidate.blocks.some(block => block.kind === 'tool-call' && block.callId === source.toolCallId))?.seq
}

/** One open tab's preview, version history controls, notes, and conversation return action. */
function ArtifactTab({
  artifacts, chart, notes, snapshot, loadImage, loadText, addToConversation, removeFromConversation,
  composerSelections, returnToConversation, addArtifactNote, removeArtifactNote, commitStyleEdit, useStore, actions, t,
}: {
  artifacts: readonly ScienceClientArtifactVersion[]
  chart: ScienceClientArtifactVersion
  notes: readonly ScienceArtifactNote[]
  snapshot: ConversationSnapshot
  loadImage: ImageLoader
  loadText: TextLoader
  addToConversation: ScienceDetailsInjected['addToConversation']
  removeFromConversation: ScienceDetailsInjected['removeFromConversation']
  composerSelections: ScienceDetailsInjected['composerSelections']
  returnToConversation: ScienceDetailsInjected['returnToConversation']
  addArtifactNote: ScienceDetailsInjected['addArtifactNote']
  removeArtifactNote: ScienceDetailsInjected['removeArtifactNote']
  commitStyleEdit: ScienceDetailsInjected['commitStyleEdit']
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  t: TranslateNS<'science'>
}) {
  const lightboxOpen = useStore(s => s.lightboxOpen)
  const versions = versionsOf(artifacts, chart.artifactId)
  const [target, setTarget] = useState<ScienceEditTarget | undefined>(undefined)
  const staged = useSyncExternalStore(
    notify => composerSelections.subscribe(notify), () => composerSelections.getSnapshot(),
    /* v8 ignore next -- getServerSnapshot; this package renders client-only (no SSR/hydration path calls it) */
    () => composerSelections.getSnapshot(),
  )
  const [committedVersion, setCommittedVersion] = useState<number | undefined>()
  useEffect(() => { setTarget(undefined) }, [chart.artifactId, chart.version])
  const selectionFor = (next: ScienceEditTarget): ScienceEditSelection | undefined => staged.find(selection =>
    selection.artifactId === chart.artifactId && selection.version === chart.version
    && JSON.stringify(selection.target) === JSON.stringify(next))
  return (
    <>
      <ArtifactToolbar chart={chart} versions={versions} sourceSeq={sourceAssistantSeq(chart, artifacts, snapshot)}
        onBack={() => { actions.showLibrary() }}
        onStepVersion={(version) => { actions.setTabVersion({ artifactId: chart.artifactId, version }) }}
        onReturnToConversation={returnToConversation} onMaximize={() => { actions.setLightboxOpen(true) }}
        onCloseTab={() => { actions.closeTab(chart.artifactId) }} loadImage={loadImage} loadText={loadText} t={t} />
      <ArtifactContent key={`${chart.artifactId}:${String(chart.version)}`} chart={chart} loadImage={loadImage} loadText={loadText}
        selectionTarget={target} onSelectTarget={(next) => { setTarget(next); setCommittedVersion(undefined) }}
        isTargetAdded={next => selectionFor(next) !== undefined} targetComment={next => selectionFor(next)?.comment ?? ''}
        onAddTarget={(next, comment) => { addToConversation([{ artifactId: chart.artifactId, version: chart.version,
          target: next, ...(comment.trim() === '' ? {} : { comment: comment.trim() }) }]) }}
        onRemoveTarget={(next) => {
          const selection = selectionFor(next)
          /* v8 ignore next -- type-safety guard only: ArtifactContent invokes this callback exclusively when
             its own `isTargetAdded(next)` (the same `selectionFor(next) !== undefined` check) was true */
          if (selection !== undefined) removeFromConversation(selection)
        }}
        onCommitStyle={async (spec) => { const result = await commitStyleEdit({
          artifactId: chart.artifactId, version: chart.version, spec,
        })
        if (!result.ok) return { ok: false, error: result.error.message }
        actions.setTabVersion({ artifactId: result.value.artifactId, version: result.value.version })
        setCommittedVersion(result.value.version); return { ok: true } }} t={t} />
      {committedVersion === chart.version && <p className={css.notice} role="status">{t('style.committed')}</p>}
      <ArtifactNotes chart={chart} notes={notes} addArtifactNote={addArtifactNote} removeArtifactNote={removeArtifactNote} t={t} />
      {'width' in chart.attachment && <ArtifactLightbox chart={chart as ScienceClientArtifactVersion & {
        attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }>
      }} loadImage={loadImage} open={lightboxOpen} onClose={() => { actions.setLightboxOpen(false) }} t={t} />}
    </>
  )
}

function ArtifactViewer({
  science, snapshot, loadImage, loadText, addToConversation, removeFromConversation,
  notes, composerSelections, returnToConversation, addArtifactNote, removeArtifactNote,
  commitStyleEdit, useStore, actions, t,
}: {
  science: ScienceClientProjection
  notes: readonly ScienceArtifactNote[]
  snapshot: ConversationSnapshot
  loadImage: ImageLoader
  loadText: TextLoader
  addToConversation: ScienceDetailsInjected['addToConversation']
  removeFromConversation: ScienceDetailsInjected['removeFromConversation']
  composerSelections: ScienceDetailsInjected['composerSelections']
  returnToConversation: ScienceDetailsInjected['returnToConversation']
  addArtifactNote: ScienceDetailsInjected['addArtifactNote']
  removeArtifactNote: ScienceDetailsInjected['removeArtifactNote']
  commitStyleEdit: ScienceDetailsInjected['commitStyleEdit']
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  t: TranslateNS<'science'>
}) {
  const openArtifacts = useStore(s => s.openArtifacts)
  const activeArtifactId = useStore(s => s.activeArtifactId)
  const artifacts = science.artifacts

  // `showLibrary` deliberately leaves open tabs intact while clearing the
  // active id; every non-null active id still names one open tab.
  const activeTab = openArtifacts.find(tab => tab.artifactId === activeArtifactId)
  if (activeTab === undefined) {
    return (
      <div className={css.body}>
        <LandingView
          artifacts={artifacts}
          loadImage={loadImage}
          onOpenTab={(selection) => { actions.openTab(selection) }}
          t={t}
        />
      </div>
    )
  }

  // The one remaining way `activeChart` resolves to undefined is the
  // durable projection not having this exact (artifactId, version) pair — a
  // stale tab, handled below as "artifact unavailable".
  const activeChart = artifacts.find(candidate =>
    candidate.artifactId === activeTab.artifactId && candidate.version === activeTab.version)

  return (
    <div className={css.body}>
      <TabStrip
        tabs={openArtifacts}
        artifacts={artifacts}
        activeArtifactId={activeArtifactId}
        onActivate={(artifactId) => { actions.activateTab(artifactId) }}
        onClose={(artifactId) => { actions.closeTab(artifactId) }}
        t={t}
      />
      {activeChart === undefined
        ? <p className={css.notice} role="status">{t('details.artifactUnavailable')}</p>
        : (
          <ArtifactTab
            artifacts={artifacts}
            chart={activeChart}
            notes={notes.filter(note => note.artifactId === activeChart.artifactId)}
            snapshot={snapshot}
            loadImage={loadImage}
            loadText={loadText}
            addToConversation={addToConversation}
            removeFromConversation={removeFromConversation}
            composerSelections={composerSelections}
            returnToConversation={returnToConversation}
            addArtifactNote={addArtifactNote}
            removeArtifactNote={removeArtifactNote}
            commitStyleEdit={commitStyleEdit}
            useStore={useStore}
            actions={actions}
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
  inspectCall: _inspectCall, loadImage, loadText, addToConversation, removeFromConversation, composerSelections,
  returnToConversation, addArtifactNote, removeArtifactNote, commitStyleEdit, t,
}: ScienceDetailsViewProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const science = useProjection('science')
  const notes = useProjection('scienceArtifactNotes') ?? []
  const snapshot = useSession(s => s)

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
      science={science} notes={notes} snapshot={snapshot} loadImage={loadImage} loadText={loadText}
      addToConversation={addToConversation} commitStyleEdit={commitStyleEdit}
      removeFromConversation={removeFromConversation} composerSelections={composerSelections}
      returnToConversation={returnToConversation} addArtifactNote={addArtifactNote} removeArtifactNote={removeArtifactNote}
      useStore={useStore} actions={actions} t={t}
    />
  )
}
