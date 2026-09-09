/**
 * The artifact viewer's per-media-type content dispatch: the seam
 * `ScienceDetailsView.tsx`'s toolbar/tab-strip never touches. An image
 * image renders through `ScienceArtifactImage`; a text artifact fetches its
 * decoded bytes through `loadText` and dispatches again on media type — CSV
 * as a sortable table (`ArtifactTable`), JSON as `JsonTree`, Markdown as `MarkdownText`, and plain text as
 * preformatted text. Adding a future accepted media type is a new `switch`
 * case here, never a change to the viewer's tab strip, toolbar, or gallery.
 */

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment/client'
import { JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactMediaType, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
import type { ScienceArtifactContentRef, ScienceImageLoader, TextLoader } from './science-attachment-loader.ts'
import type { ScienceChartStateLoader } from './science-chart-state-loader.ts'
import { ScienceArtifactImage } from './ScienceArtifactImage.tsx'
import { ScienceChartEditPanel, type ScienceChartPreview, type ScienceChartSaveOutcome } from './ScienceChartEditPanel.tsx'
import { ArtifactTable } from './ArtifactTable.tsx'
import { parseCsv } from './csv.ts'
import {
  capTextForDisplay,
  MAX_ARTIFACT_TEXT_CHARACTERS,
} from './format.ts'
import type { ScienceRenderableVersion } from './version-summaries.ts'
import css from './ScienceDetailsView.module.css'

/** Closed-union exhaustiveness fence. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

/**
 * Build `MessageImage`'s labels from the `science` namespace. Shared by
 * every `MessageImage` mount in this package (`ArtifactContent.tsx`'s own
 * full-size render, the Turn-tail artifact thumbnail,
 * `ScienceDetailsView.tsx`'s gallery tile) so the five strings and the
 * lightbox pair stay defined once.
 * @param t - the `science` namespace translator.
 * @returns the complete `MessageImageLabels` value.
 */
export function artifactImageLabels(t: TranslateNS<'science'>): MessageImageLabels {
  return {
    image: t('artifact.title'),
    open: t('artifact.open'),
    openNamed: label => t('artifact.openNamed', { label }),
    loading: t('artifact.loading'),
    loadFailed: t('artifact.loadFailed'),
    lightbox: { dialog: t('artifact.lightboxOriginal'), close: t('artifact.lightboxClose') },
  }
}

type TextLoadState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error' }

type TextArtifactContentRef = Omit<ScienceArtifactContentRef, 'mediaType'> & {
  readonly mediaType: Exclude<ScienceArtifactMediaType, 'image/png'>
}

/** Fetch one text attachment's decoded content, re-fetching whenever `retryToken` changes. */
function useLoadedText(content: ScienceArtifactContentRef, loadText: TextLoader, retryToken: number): TextLoadState {
  const [state, setState] = useState<TextLoadState>({ status: 'loading' })
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    loadText(content)
      .then((text) => { if (live) setState({ status: 'ready', text }) })
      .catch(() => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  // `content.versionId` is this immutable version's stable identity: a
  // structurally-equal `content` object rebuilt for the same version (every
  // projection re-derives fresh artifact objects) must not reset the loaded
  // text and refetch.
  }, [content.versionId, loadText, retryToken])
  return state
}

type ChartStateLoadState =
  | { status: 'loading' }
  | { status: 'ready'; chart: ScienceChartState | null }
  | { status: 'error' }

/**
 * Fetch one PNG version's live chart-object state once per version — the
 * chart edit panel's mount trigger. Keyed by `content.versionId` the same
 * way {@link useLoadedText} is, so a structurally-equal `content` rebuilt for
 * the same version does not refetch.
 */
function useLoadedChartState(content: ScienceArtifactContentRef, loadChartState: ScienceChartStateLoader): ChartStateLoadState {
  const [state, setState] = useState<ChartStateLoadState>({ status: 'loading' })
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    loadChartState(content)
      .then((chart) => { if (live) setState({ status: 'ready', chart }) })
      .catch(() => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  }, [content.versionId, loadChartState])
  return state
}

/**
 * The live chart-edit panel for one open PNG version: direct title/legend/
 * grid/font operations and element-level annotation targeting. Fetches
 * `content`'s chart state once on mount — a full remount per artifact/
 * version already happens at `ArtifactContent`'s own call site (keyed by
 * `artifactId:version`), so this fires exactly once per opened version, never
 * on an unrelated re-render. Renders nothing while loading, on a fetch
 * error, and for a version whose chart state is `null` (a non-PNG version
 * never reaches this component; a PNG version with no stored figure state —
 * imported or legacy content — has no edit affordance to offer).
 */
function ChartEditSlot({
  content, loadChartState, onSave, onPreview, onPreviewSrc, onPendingChange,
  referencesDisabled, isTargetAdded, onAddTarget, onRemoveTarget, t,
}: {
  content: ScienceArtifactContentRef & { version: number }
  loadChartState: ScienceChartStateLoader
  onSave: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>
  onPreview?: ScienceChartPreview
  onPreviewSrc?: (src: string | undefined) => void
  onPendingChange?: (hasPending: boolean) => void
  referencesDisabled: boolean
  isTargetAdded: (target: ScienceEditTarget) => boolean
  onAddTarget: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget: (target: ScienceEditTarget) => void
  t: TranslateNS<'science'>
}) {
  const state = useLoadedChartState(content, loadChartState)
  if (state.status !== 'ready' || state.chart === null) return null
  return (
    <ScienceChartEditPanel
      version={content.version} chart={state.chart} onSave={onSave}
      referencesDisabled={referencesDisabled}
      {...onPreview === undefined ? {} : { onPreview }}
      {...onPreviewSrc === undefined ? {} : { onPreviewSrc }}
      {...onPendingChange === undefined ? {} : { onPendingChange }}
      isTargetAdded={isTargetAdded} onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget}
      t={t}
    />
  )
}

/** Parse JSON text into a `JsonTree`-acceptable value, or `undefined` for malformed or non-object/array content. */
function parseJsonForTree(text: string): object | unknown[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  return typeof value === 'object' && value !== null ? value : undefined
}

/** One text attachment's dispatched body: loading/error states, then the per-media-type renderer. */
function TextArtifactBody({
  logicalName, content, loadText, t,
}: {
  logicalName: string
  content: TextArtifactContentRef
  loadText: TextLoader
  t: TranslateNS<'science'>
}) {
  const [retryToken, setRetryToken] = useState(0)
  const state = useLoadedText(content, loadText, retryToken)

  if (state.status === 'loading') return <p className={css.notice} role="status">{t('artifact.loading')}</p>
  if (state.status === 'error') {
    return (
      <button type="button" className={css.notice} onClick={() => { setRetryToken(token => token + 1) }}>
        {t('artifact.loadFailed')}
      </button>
    )
  }

  switch (content.mediaType as string) {
    case 'text/csv':
      return (
        <ArtifactTable
          data={parseCsv(state.text)}
          label={logicalName}
          labels={{
            empty: t('table.empty'),
            sortBy: column => t('table.sortBy', { column }),
            truncated: (shown, total) => t('table.truncated', { shown, total }),
          }}
        />
      )
    case 'application/json': {
      // Capped before the parse attempt, not after: a truncated JSON
      // document almost never re-parses (cutting off mid-value breaks
      // syntax), so an oversized file already falls through to the
      // preformatted-text branch below with its own truncation notice,
      // rather than JsonTree rendering the complete, potentially huge, value.
      const capped = capTextForDisplay(state.text, MAX_ARTIFACT_TEXT_CHARACTERS)
      const parsed = parseJsonForTree(capped.value)
      return parsed === undefined
        ? <BoundedPreText text={capped.value} truncated={capped.truncated} total={capped.total} t={t} />
        : <JsonTree data={parsed} label={logicalName} />
    }
    case 'text/markdown':
      return <MarkdownText text={state.text} />
    case 'text/plain': {
      const capped = capTextForDisplay(state.text, MAX_ARTIFACT_TEXT_CHARACTERS)
      return <BoundedPreText text={capped.value} truncated={capped.truncated} total={capped.total} t={t} />
    }
    /* v8 ignore next -- closed TextMediaType union; every current member has a case above */
    default: return assertNever(content.mediaType as never)
  }
}

function normalizedPoint(event: ReactMouseEvent<HTMLDivElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  }
}

/** Raster display with an opt-in drag layer that emits normalized coordinates. */
function RasterArtifact({
  chart, loadImage, previewSrc, selectionTarget, onSelectTarget, isTargetAdded, targetComment, onAddTarget, onRemoveTarget,
  t,
}: {
  chart: ScienceRenderableVersion & { mediaType: 'image/png' }
  loadImage: ScienceImageLoader
  previewSrc?: string
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  isTargetAdded: (target: ScienceEditTarget) => boolean
  targetComment: (target: ScienceEditTarget) => string
  onAddTarget: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget: (target: ScienceEditTarget) => void
  t: TranslateNS<'science'>
}) {
  const [selecting, setSelecting] = useState(false)
  const start = useRef<{ x: number; y: number } | undefined>(undefined)
  const [draft, setDraft] = useState<Extract<ScienceEditTarget, { kind: 'normalized-region' }> | undefined>(undefined)
  const region = draft ?? (selectionTarget?.kind === 'normalized-region' ? selectionTarget : undefined)
  // Keyed by the region's own normalized coordinates: a fresh drag is a distinct key, so
  // its input starts from the staged comment (or empty) rather than whatever
  // was typed for a previous region on this same artifact version.
  const [comments, setComments] = useState<Record<string, string>>({})

  const update = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (start.current === undefined) return
    const point = normalizedPoint(event)
    setDraft({
      kind: 'normalized-region',
      x: Math.min(start.current.x, point.x),
      y: Math.min(start.current.y, point.y),
      width: Math.abs(point.x - start.current.x),
      height: Math.abs(point.y - start.current.y),
    })
  }
  const finish = (event: ReactMouseEvent<HTMLDivElement>): void => {
    update(event)
    const point = normalizedPoint(event)
    const origin = start.current
    start.current = undefined
    if (origin === undefined) return
    const next = {
      kind: 'normalized-region' as const,
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    }
    setDraft(undefined)
    if (next.width === 0 || next.height === 0) return
    onSelectTarget(next)
    setSelecting(false)
  }

  const regionKey = region === undefined ? undefined
    : `${String(region.x)}:${String(region.y)}:${String(region.width)}:${String(region.height)}`
  const regionLabel = region === undefined ? undefined
    : t('edit.regionTarget', { x: Math.round(region.x * 100), y: Math.round(region.y * 100) })
  const added = region !== undefined && isTargetAdded(region)
  const comment = region === undefined || regionKey === undefined ? ''
    : comments[regionKey] ?? targetComment(region)

  return (
    <div className={css.rasterSelector}>
      <div className={css.rasterCanvas}>
        <ScienceArtifactImage content={chart} label={chart.title} load={loadImage} variant="single" labels={artifactImageLabels(t)}
          {...previewSrc === undefined ? {} : { srcOverride: previewSrc }} />
        {region !== undefined && (
          <span
            className={css.regionBox}
            style={{ left: `${String(region.x * 100)}%`, top: `${String(region.y * 100)}%`, width: `${String(region.width * 100)}%`, height: `${String(region.height * 100)}%` }}
          />
        )}
        {previewSrc === undefined && selecting && (
          <div
            className={css.regionGesture}
            aria-label={t('edit.regionGesture')}
            onMouseDown={(event) => { start.current = normalizedPoint(event); setDraft(undefined) }}
            onMouseMove={update}
            onMouseUp={finish}
            onMouseLeave={() => { start.current = undefined; setDraft(undefined) }}
          />
        )}
      </div>
      <button type="button" className={css.regionButton} aria-pressed={selecting} disabled={previewSrc !== undefined}
        title={previewSrc === undefined ? undefined : t('edit.savePreviewFirst')} onClick={() => { setSelecting(value => !value) }}>
        {selecting ? t('edit.regionCancel') : t('edit.regionSelect')}
      </button>
      {previewSrc !== undefined && <p className={css.notice}>{t('edit.savePreviewFirst')}</p>}
      {/* Staging row for the current drawn region: a comment field and one add/remove
          control that push the exact region target into the composer
          selections store (ScienceDetailsView's addToConversation/
          removeFromConversation), producing the edit.regionTarget chip. */}
      {region !== undefined && regionKey !== undefined && regionLabel !== undefined && (
        <div className={css.specTargetRow}>
          <span className={css.specTarget}>{regionLabel}</span>
          <input
            className={css.specComment}
            disabled={previewSrc !== undefined}
            value={comment}
            aria-label={t('edit.targetComment', { target: regionLabel })}
            placeholder={t('edit.targetCommentPlaceholder')}
            onChange={(event) => {
              const value = event.target.value
              setComments(current => ({ ...current, [regionKey]: value }))
              // Already staged: an edit must not silently diverge from the
              // chip and the outgoing science-edit message, so it updates the
              // staged selection immediately rather than waiting for another
              // Add click.
              if (added) onAddTarget(region, value)
            }}
          />
          <button
            type="button"
            className={css.specAdd}
            disabled={!added && previewSrc !== undefined}
            aria-label={added ? t('edit.removeTarget', { target: regionLabel }) : t('edit.addTarget', { target: regionLabel })}
            onClick={() => { if (added) onRemoveTarget(region); else onAddTarget(region, comment) }}
          >
            {added ? '−' : '+'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Preformatted text capped to `MAX_ARTIFACT_TEXT_CHARACTERS`, with a "showing first N" notice when it was longer. */
function BoundedPreText({ text, truncated, total, t }: {
  text: string
  truncated: boolean
  total: number
  t: TranslateNS<'science'>
}) {
  return (
    <>
      <pre className={css.textContent}>{text}</pre>
      {truncated && <p className={css.notice} role="status">{t('artifact.textTruncated', { shown: text.length, total })}</p>}
    </>
  )
}

/**
 * Render one artifact version's content: an image preview (with its live
 * chart-edit panel, `ChartEditSlot`, whenever the store has chart state for
 * this exact version) or text fetched through `loadText` and dispatched by
 * media type.
 * @param props - the artifact version to render, its loaders, and the chart-edit callbacks the edit panel invokes.
 * @returns the dispatched content and optional human-edit ancestry.
 */
export function ArtifactContent({
  chart, loadImage, loadText, loadChartState, previewSrc, selectionTarget, onSelectTarget, isTargetAdded,
  targetComment, onAddTarget, onRemoveTarget, onSaveChartOps, onPreviewChartOps, onPreviewSrc, onPendingChartEditsChange, t,
}: {
  chart: ScienceRenderableVersion
  loadImage: ScienceImageLoader
  loadText: TextLoader
  loadChartState: ScienceChartStateLoader
  previewSrc?: string
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  isTargetAdded: (target: ScienceEditTarget) => boolean
  targetComment: (target: ScienceEditTarget) => string
  onAddTarget: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget: (target: ScienceEditTarget) => void
  /** Apply pending chart operations through the caller's `applyChartOps` Remote, already scoped to this artifact/version. */
  onSaveChartOps: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>
  onPreviewChartOps?: ScienceChartPreview
  onPreviewSrc?: (src: string | undefined) => void
  /**
   * Reported whenever the chart edit panel's unsaved direct-edit count
   * crosses zero, so the caller can suppress auto-stepping the tab to a
   * newer version mid-edit (B4).
   */
  onPendingChartEditsChange?: (hasPending: boolean) => void
  t: TranslateNS<'science'>
}) {
  const isImage = chart.mediaType === 'image/png'
  return (
    <div className={css.content}>
      {isImage
        ? (
          <>
            <RasterArtifact
              chart={chart as ScienceRenderableVersion & { mediaType: 'image/png' }}
              loadImage={loadImage} {...previewSrc === undefined ? {} : { previewSrc }}
              selectionTarget={selectionTarget} onSelectTarget={onSelectTarget}
              isTargetAdded={isTargetAdded} targetComment={targetComment} onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget}
              t={t}
            />
            <ChartEditSlot
              content={chart} loadChartState={loadChartState} onSave={onSaveChartOps}
              referencesDisabled={previewSrc !== undefined}
              {...onPreviewChartOps === undefined ? {} : { onPreview: onPreviewChartOps }}
              {...onPreviewSrc === undefined ? {} : { onPreviewSrc }}
              {...onPendingChartEditsChange === undefined ? {} : { onPendingChange: onPendingChartEditsChange }}
              isTargetAdded={isTargetAdded} onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget}
              t={t}
            />
          </>
        )
        : (
          <TextArtifactBody
            logicalName={chart.logicalName} content={chart as TextArtifactContentRef} loadText={loadText}
            t={t}
          />
        )}
      {chart.caption !== undefined && <p className={css.caption}>{chart.caption}</p>}
      {chart.contentOrigin === 'human-edit' && <div className={css.contentFacts}><span>{t('artifact.humanEdit', { version: chart.version - 1 })}</span></div>}
    </div>
  )
}
