/**
 * The artifact viewer's per-media-type content dispatch: the seam
 * `ScienceDetailsView.tsx`'s toolbar/tab-strip never touches. An image
 * attachment renders through `MessageImage`; a text attachment fetches its
 * decoded bytes through `loadText` and dispatches again on media type — CSV
 * as a sortable table (`ArtifactTable`), Vega-Lite as an SVG visualization,
 * JSON as `JsonTree`, Markdown as `MarkdownText`, and plain text as
 * preformatted text. Adding a future accepted media type is a new `switch`
 * case here, never a change to the viewer's tab strip, toolbar, or gallery.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import embed from 'vega-embed'
import type { TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { formatBytes } from '@deepseek-ai/dsh-byte-size'
import { MessageImage } from '@deepseek-ai/dsh-client-ui-attachment/client'
import type { ImageLoader, MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment/client'
import { JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceClientArtifactVersion } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
import type { TextLoader } from './science-attachment-loader.ts'
import { ArtifactTable } from './ArtifactTable.tsx'
import { parseCsv } from './csv.ts'
import { capTextForDisplay, MAX_ARTIFACT_TEXT_CHARACTERS } from './format.ts'
import css from './ScienceDetailsView.module.css'

/** Closed-union exhaustiveness fence. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

/**
 * Build `MessageImage`'s labels from the `science` namespace. Shared by
 * every `MessageImage` mount in this package (`ArtifactContent.tsx`'s own
 * full-size render, `ScienceArtifactRow.tsx`'s transcript-row thumbnail,
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

/** Fetch one text attachment's decoded content, re-fetching whenever `retryToken` changes. */
function useLoadedText(attachment: TextAttachmentRef, loadText: TextLoader, retryToken: number): TextLoadState {
  const [state, setState] = useState<TextLoadState>({ status: 'loading' })
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    loadText(attachment)
      .then((text) => { if (live) setState({ status: 'ready', text }) })
      .catch(() => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  }, [attachment, loadText, retryToken])
  return state
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

/** A parsed Vega-Lite document accepted at the file boundary before the renderer performs schema validation. */
type VegaLiteDocument = Record<string, unknown>

/** Vega-Lite composition operators whose members are sub-specifications. */
const SPEC_ARRAY_OPERATORS = ['layer', 'hconcat', 'vconcat', 'concat'] as const

/**
 * Structural paths the viewer offers as edit targets: `mark` and `encoding.*`
 * at every composition level (`layer`/`hconcat`/`vconcat`/`concat` members
 * and the `facet`/`repeat` sub-`spec`).
 */
export function selectableSpecPaths(document: VegaLiteDocument): string[] {
  const paths: string[] = []
  const visit = (node: unknown, prefix: string): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return
    const at = (segment: string): string => prefix === '' ? segment : `${prefix}.${segment}`
    const record = node as Record<string, unknown>
    if (record['mark'] !== undefined) paths.push(at('mark'))
    const encoding = record['encoding']
    if (typeof encoding === 'object' && encoding !== null && !Array.isArray(encoding)) {
      for (const key of Object.keys(encoding)) paths.push(at(`encoding.${key}`))
    }
    for (const operator of SPEC_ARRAY_OPERATORS) {
      const members = record[operator]
      if (Array.isArray(members)) members.forEach((member, index) => { visit(member, at(`${operator}.${String(index)}`)) })
    }
    if (record['spec'] !== undefined) visit(record['spec'], at('spec'))
  }
  visit(document, '')
  return paths
}

/** Parse one Vega-Lite attachment as a JSON object; arrays and scalar JSON are not specifications. */
function parseVegaLiteDocument(text: string): VegaLiteDocument | undefined {
  const parsed = parseJsonForTree(text)
  return parsed === undefined || Array.isArray(parsed) ? undefined : parsed as VegaLiteDocument
}

/**
 * Render one Vega-Lite attachment: parse, mount through the maintained
 * client renderer, and finalize the view on replacement or unmount. Owns the
 * complete degrade ladder — unparseable text falls back to preformatted
 * text, a spec the renderer rejects falls back to `JsonTree`. The parse is
 * memoized on the text so a parent re-render never re-embeds, and the mount
 * container stays in the tree (hidden) while the fallback shows, so the
 * effect's element reference is never `null` across failure and re-render.
 */
function VegaLiteArtifact({ text, logicalName, selectionTarget, onSelectTarget, t }: {
  text: string
  logicalName: string
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  t: TranslateNS<'science'>
}) {
  const capped = useMemo(() => capTextForDisplay(text, MAX_ARTIFACT_TEXT_CHARACTERS), [text])
  const document = useMemo(() => parseVegaLiteDocument(capped.value), [capped.value])
  const paths = useMemo(() => document === undefined ? [] : selectableSpecPaths(document), [document])
  const container = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = container.current
    if (document === undefined || element === null) return
    let live = true
    let finalize: (() => void) | undefined
    setFailed(false)
    void embed(element, document, { actions: false, mode: 'vega-lite', renderer: 'svg' })
      .then((result) => {
        if (!live) result.view.finalize()
        else finalize = () => { result.view.finalize() }
      })
      .catch(() => { if (live) setFailed(true) })
    return () => {
      live = false
      finalize?.()
      element.replaceChildren()
    }
  }, [document])

  if (document === undefined) {
    return <BoundedPreText text={capped.value} truncated={capped.truncated} total={capped.total} t={t} />
  }
  return (
    <>
      <div ref={container} className={css.vegaLite} data-testid="vega-lite-view" hidden={failed} />
      {failed && <JsonTree data={document} label={logicalName} />}
      {paths.length > 0 && (
        <div className={css.specTargets} aria-label={t('edit.specTargets')}>
          {paths.map(path => (
            <button
              key={path}
              type="button"
              className={css.specTarget}
              aria-pressed={selectionTarget?.kind === 'spec-path' && selectionTarget.path === path}
              onClick={() => { onSelectTarget({ kind: 'spec-path', path }) }}
            >
              {path}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/** One text attachment's dispatched body: loading/error states, then the per-media-type renderer. */
function TextArtifactBody({ logicalName, attachment, loadText, selectionTarget, onSelectTarget, t }: {
  logicalName: string
  attachment: TextAttachmentRef
  loadText: TextLoader
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  t: TranslateNS<'science'>
}) {
  const [retryToken, setRetryToken] = useState(0)
  const state = useLoadedText(attachment, loadText, retryToken)

  if (state.status === 'loading') return <p className={css.notice} role="status">{t('artifact.loading')}</p>
  if (state.status === 'error') {
    return (
      <button type="button" className={css.notice} onClick={() => { setRetryToken(token => token + 1) }}>
        {t('artifact.loadFailed')}
      </button>
    )
  }

  switch (attachment.mediaType) {
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
    case 'application/vnd.vega-lite+json':
      return (
        <VegaLiteArtifact
          text={state.text} logicalName={logicalName} selectionTarget={selectionTarget}
          onSelectTarget={onSelectTarget} t={t}
        />
      )
    case 'text/markdown':
      return <MarkdownText text={state.text} />
    case 'text/plain': {
      const capped = capTextForDisplay(state.text, MAX_ARTIFACT_TEXT_CHARACTERS)
      return <BoundedPreText text={capped.value} truncated={capped.truncated} total={capped.total} t={t} />
    }
    /* v8 ignore next -- closed TextMediaType union; every current member has a case above */
    default: return assertNever(attachment.mediaType)
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
function RasterArtifact({ chart, loadImage, selectionTarget, onSelectTarget, t }: {
  chart: ScienceClientArtifactVersion & { attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }> }
  loadImage: ImageLoader
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  t: TranslateNS<'science'>
}) {
  const [selecting, setSelecting] = useState(false)
  const start = useRef<{ x: number; y: number } | undefined>(undefined)
  const [draft, setDraft] = useState<Extract<ScienceEditTarget, { kind: 'normalized-region' }> | undefined>(undefined)
  const region = draft ?? (selectionTarget?.kind === 'normalized-region' ? selectionTarget : undefined)

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

  return (
    <div className={css.rasterSelector}>
      <div className={css.rasterCanvas}>
        <MessageImage attachment={chart.attachment} load={loadImage} variant="single" labels={artifactImageLabels(t)} />
        {region !== undefined && (
          <span
            className={css.regionBox}
            style={{ left: `${String(region.x * 100)}%`, top: `${String(region.y * 100)}%`, width: `${String(region.width * 100)}%`, height: `${String(region.height * 100)}%` }}
          />
        )}
        {selecting && (
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
      <button type="button" className={css.regionButton} aria-pressed={selecting} onClick={() => { setSelecting(value => !value) }}>
        {selecting ? t('edit.regionCancel') : t('edit.regionSelect')}
      </button>
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
 * Render one artifact version's content: an image through `MessageImage`, or
 * a text attachment fetched through `loadText` and dispatched by media type.
 * @param props - the artifact version to render and both durable-byte loaders.
 * @returns the dispatched content, plus the shared caption/source-run/size facts row.
 */
export function ArtifactContent({ chart, loadImage, loadText, selectionTarget, onSelectTarget, t }: {
  chart: ScienceClientArtifactVersion
  loadImage: ImageLoader
  loadText: TextLoader
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  t: TranslateNS<'science'>
}) {
  const { attachment } = chart
  const isImage = 'width' in attachment
  return (
    <div className={css.content}>
      {isImage
        ? (
          <RasterArtifact
            chart={chart as ScienceClientArtifactVersion & { attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }> }}
            loadImage={loadImage} selectionTarget={selectionTarget} onSelectTarget={onSelectTarget} t={t}
          />
        )
        : (
          <TextArtifactBody
            logicalName={chart.logicalName} attachment={attachment} loadText={loadText}
            selectionTarget={selectionTarget} onSelectTarget={onSelectTarget} t={t}
          />
        )}
      {chart.caption !== undefined && <p className={css.caption}>{chart.caption}</p>}
      <div className={css.contentFacts}>
        <span>{t('artifact.sourceRun', { runId: chart.runId })}</span>
        <span>
          {isImage
            ? t('artifact.dimensions', { width: attachment.width, height: attachment.height, size: formatBytes(attachment.bytes) })
            : t('artifact.size', { size: formatBytes(attachment.bytes) })}
        </span>
      </div>
    </div>
  )
}
