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
import embed, { vega } from 'vega-embed'
import type { TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
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

type StyleField = 'color' | 'font-size' | 'label'
type StyleCommitResult = { readonly ok: true } | { readonly ok: false; readonly error: string }

const EXTERNAL_VEGA_URL_BLOCKED = 'SCIENCE_VEGA_EXTERNAL_URL_BLOCKED'
const defaultVegaLoader: ReturnType<typeof vega.loader> = vega.loader()
/**
 * Rejects every HTTP(S)/protocol-relative resource before Vega resolves it.
 * `sanitize` is the one seam every Vega resource path funnels through —
 * `load()`'s own default implementation calls `this.sanitize` before
 * dispatching to `http`/`file`, and vega-scenegraph's `ResourceLoader` calls
 * `sanitize(uri, {context: 'image'})` directly for an image mark and
 * `sanitize(uri, {context: 'href'})` directly for a link, neither of which
 * ever calls `load()`. Overriding only `load` (as an earlier version of this
 * loader did) leaves image marks and hrefs unrestricted; overriding
 * `sanitize` alone covers every path, including `load`'s own inherited
 * implementation below.
 */
export const restrictedVegaLoader: ReturnType<typeof vega.loader> = {
  ...defaultVegaLoader,
  sanitize(uri, options) {
    if (/^(?:https?:)?\/\//iu.test(uri)) {
      return Promise.reject(new Error(`${EXTERNAL_VEGA_URL_BLOCKED}: external Vega-Lite resource URLs are disabled`))
    }
    return defaultVegaLoader.sanitize(uri, options)
  },
}

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
    if (record['title'] !== undefined) paths.push(at('title'))
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

/**
 * Return the localized display label for a structural Vega-Lite target.
 * @param path - exact Vega-Lite target path.
 * @param t - the `science` namespace translator.
 * @returns the known localized label, or the original path when no label is defined.
 */
export function specPathLabel(path: string, t: TranslateNS<'science'>): string {
  if (path === 'title') return t('edit.specPath.title')
  if (path === 'encoding.y') return t('edit.specPath.y')
  if (path === 'encoding.x') return t('edit.specPath.x')
  if (path === 'mark') return t('edit.specPath.mark')
  if (path === 'encoding.color') return t('edit.specPath.color')
  return path
}

function updateSpecPath(
  value: unknown, segments: readonly string[], update: (target: unknown) => unknown,
): unknown {
  if (segments.length === 0) return update(value)
  const [head, ...tail] = segments
  /* v8 ignore next -- the zero-segment case returns above before destructuring. */
  if (head === undefined) return value
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    const index = Number(head)
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) return value
    const copy = Array.from(value as unknown[])
    copy[index] = updateSpecPath(copy[index], tail, update)
    return copy
  }
  const record = value as Record<string, unknown>
  return { ...record, [head]: updateSpecPath(record[head], tail, update) }
}

export function applyStyle(document: VegaLiteDocument, path: string, field: StyleField, value: string | number): VegaLiteDocument {
  return updateSpecPath(document, path.split('.'), (target) => {
    if (path.endsWith('title')) {
      if (field === 'label') {
        if (typeof target === 'string') return value
        const title = typeof target === 'object' && target !== null && !Array.isArray(target) ? target : {}
        return { ...title, text: value }
      }
      const title = typeof target === 'string'
        ? { text: target }
        : typeof target === 'object' && target !== null && !Array.isArray(target) ? target : {}
      return { ...title, [field === 'font-size' ? 'fontSize' : field]: value }
    }
    if (path.endsWith('mark')) {
      const mark = typeof target === 'string' ? { type: target } : typeof target === 'object' && target !== null ? target : {}
      return { ...mark, [field === 'font-size' ? 'fontSize' : field]: value }
    }
    const channel = typeof target === 'object' && target !== null && !Array.isArray(target)
      ? target as Record<string, unknown> : {}
    if (field === 'label') return { ...channel, title: value }
    if (field === 'color') {
      const scale = typeof channel['scale'] === 'object' && channel['scale'] !== null && !Array.isArray(channel['scale'])
        ? channel['scale'] as Record<string, unknown> : {}
      return { ...channel, scale: { ...scale, range: [value] } }
    }
    const guideKey = path.endsWith('encoding.color') ? 'legend' : 'axis'
    const guide = typeof channel[guideKey] === 'object' && channel[guideKey] !== null && !Array.isArray(channel[guideKey])
      ? channel[guideKey] as Record<string, unknown> : {}
    return { ...channel, [guideKey]: { ...guide, labelFontSize: value } }
  }) as VegaLiteDocument
}

function StyleEditor({ target, document, onChange, onCommit, t }: {
  target: Extract<ScienceEditTarget, { kind: 'spec-path' }>
  document: VegaLiteDocument
  onChange: (document: VegaLiteDocument) => void
  onCommit: (spec: string) => Promise<StyleCommitResult>
  t: TranslateNS<'science'>
}) {
  const [state, setState] = useState<'idle' | 'pending' | { readonly error: string }>('idle')
  const setStyle = (field: StyleField, value: string | number): void => {
    onChange(applyStyle(document, target.path, field, value))
    setState('idle')
  }
  const commit = (): void => {
    /* v8 ignore next -- the pending state disables the only button that invokes this handler. */
    if (state === 'pending') return
    setState('pending')
    void onCommit(JSON.stringify(document, null, 2))
      .then((result) => { setState(result.ok ? 'idle' : { error: result.error }) })
      .catch((error: unknown) => { setState({ error: error instanceof Error ? error.message : String(error) }) })
  }
  const encoding = target.path.includes('encoding.')
  const title = target.path.endsWith('title')
  const color = title || target.path.endsWith('mark') || target.path.endsWith('encoding.color')
  return (
    <section className={css.stylePanel} aria-label={t('style.title')}>
      <div className={css.styleHeader}>
        <span>{t('style.title')}</span>
        <code>{target.path}</code>
      </div>
      {color && (
        <label className={css.styleControl}>
          <span>{t('style.color')}</span>
          <input type="color" defaultValue="#4c78a8" onChange={(event) => { setStyle('color', event.currentTarget.value) }} />
        </label>
      )}
      <label className={css.styleControl}>
        <span>{t('style.fontSize')}</span>
        <input
          type="number" min={6} max={96} defaultValue={12}
          onChange={(event) => {
            const size = Number(event.currentTarget.value)
            setStyle('font-size', Math.min(96, Math.max(6, size)))
          }}
        />
      </label>
      {(encoding || title) && (
        <label className={css.styleControl}>
          <span>{t('style.label')}</span>
          <input type="text" onChange={(event) => { setStyle('label', event.currentTarget.value) }} />
        </label>
      )}
      <button type="button" className={css.editSubmit} disabled={state === 'pending'} onClick={commit}>
        {state === 'pending' ? t('style.committing') : t('style.commit')}
      </button>
      {typeof state === 'object' && <p className={css.notice} role="alert">{t('style.failed', { message: state.error })}</p>}
    </section>
  )
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
function VegaLiteArtifact({
  text, logicalName, selectionTarget, onSelectTarget, isTargetAdded,
  targetComment, onAddTarget, onRemoveTarget, onCommitStyle, t,
}: {
  text: string
  logicalName: string
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  isTargetAdded: (target: ScienceEditTarget) => boolean
  targetComment: (target: ScienceEditTarget) => string
  onAddTarget: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget: (target: ScienceEditTarget) => void
  onCommitStyle: (spec: string) => Promise<StyleCommitResult>
  t: TranslateNS<'science'>
}) {
  const capped = useMemo(() => capTextForDisplay(text, MAX_ARTIFACT_TEXT_CHARACTERS), [text])
  const document = useMemo(() => parseVegaLiteDocument(capped.value), [capped.value])
  const [workingDocument, setWorkingDocument] = useState<VegaLiteDocument | undefined>(document)
  useEffect(() => { setWorkingDocument(document) }, [document])
  const renderedDocument = workingDocument ?? document
  const paths = useMemo(() => renderedDocument === undefined ? [] : selectableSpecPaths(renderedDocument), [renderedDocument])
  const container = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<'render' | 'external-url' | undefined>(undefined)
  const [comments, setComments] = useState<Record<string, string>>({})

  useEffect(() => {
    const element = container.current
    if (renderedDocument === undefined || element === null) return
    let live = true
    let finalize: (() => void) | undefined
    setFailure(undefined)
    void embed(element, renderedDocument, {
      actions: false, loader: restrictedVegaLoader, mode: 'vega-lite', renderer: 'svg',
    })
      .then((result) => {
        if (!live) result.view.finalize()
        else finalize = () => { result.view.finalize() }
      })
      .catch((error: unknown) => {
        if (live) setFailure(String(error).includes(EXTERNAL_VEGA_URL_BLOCKED) ? 'external-url' : 'render')
      })
    return () => {
      live = false
      finalize?.()
      element.replaceChildren()
    }
  }, [renderedDocument])

  if (document === undefined) {
    return <BoundedPreText text={capped.value} truncated={capped.truncated} total={capped.total} t={t} />
  }
  const chartTarget = paths[0]
  return (
    <>
      <div
        ref={container}
        className={css.vegaLite}
        data-testid="vega-lite-view"
        hidden={failure !== undefined}
        role={paths.length === 0 ? undefined : 'button'}
        tabIndex={paths.length === 0 ? undefined : 0}
        aria-label={paths.length === 0 ? undefined : t('edit.chartStyle')}
        onClick={chartTarget === undefined ? undefined : () => { onSelectTarget({ kind: 'spec-path', path: chartTarget }) }}
        onKeyDown={chartTarget === undefined ? undefined : (event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelectTarget({ kind: 'spec-path', path: chartTarget })
        }}
      />
      {failure === 'external-url' && <p className={css.notice} role="note">{t('artifact.externalDataBlocked')}</p>}
      {failure !== undefined && <JsonTree data={renderedDocument as VegaLiteDocument} label={logicalName} />}
      {paths.length > 0 && (
        <section className={css.elementPanel} aria-label={t('edit.specTargets')}>
          <h3>{t('edit.elements')}</h3>
          <div className={css.specTargets}>
            {paths.map((path) => {
              const target = { kind: 'spec-path' as const, path }
              const added = isTargetAdded(target)
              const comment = comments[path] ?? targetComment(target)
              return (
                <div className={css.specTargetRow} key={path}>
                  <button
                    type="button"
                    className={css.specTarget}
                    aria-pressed={selectionTarget?.kind === 'spec-path' && selectionTarget.path === path}
                    onClick={() => { onSelectTarget(target) }}
                  >
                    {specPathLabel(path, t)}
                  </button>
                  <input
                    className={css.specComment}
                    value={comment}
                    aria-label={t('edit.targetComment', { target: specPathLabel(path, t) })}
                    placeholder={t('edit.targetCommentPlaceholder')}
                    onChange={(event) => {
                      const value = event.target.value
                      setComments(current => ({ ...current, [path]: value }))
                      if (added) onAddTarget(target, value)
                    }}
                  />
                  <button
                    type="button"
                    className={css.specAdd}
                    aria-label={added
                      ? t('edit.removeTarget', { target: specPathLabel(path, t) })
                      : t('edit.addTarget', { target: specPathLabel(path, t) })}
                    onClick={() => { if (added) onRemoveTarget(target); else onAddTarget(target, comment) }}
                  >
                    {added ? '−' : '+'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}
      {selectionTarget?.kind === 'spec-path' && renderedDocument !== undefined && (
        <StyleEditor
          key={selectionTarget.path}
          target={selectionTarget}
          document={renderedDocument}
          onChange={setWorkingDocument}
          onCommit={onCommitStyle}
          t={t}
        />
      )}
    </>
  )
}

/** One text attachment's dispatched body: loading/error states, then the per-media-type renderer. */
function TextArtifactBody({
  logicalName, attachment, loadText, selectionTarget, onSelectTarget, isTargetAdded,
  targetComment, onAddTarget, onRemoveTarget, onCommitStyle, t,
}: {
  logicalName: string
  attachment: TextAttachmentRef
  loadText: TextLoader
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  isTargetAdded: (target: ScienceEditTarget) => boolean
  targetComment: (target: ScienceEditTarget) => string
  onAddTarget: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget: (target: ScienceEditTarget) => void
  onCommitStyle: (spec: string) => Promise<StyleCommitResult>
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
          onSelectTarget={onSelectTarget} isTargetAdded={isTargetAdded} targetComment={targetComment}
          onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget} onCommitStyle={onCommitStyle} t={t}
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
function RasterArtifact({
  chart, loadImage, selectionTarget, onSelectTarget, isTargetAdded, targetComment, onAddTarget, onRemoveTarget, t,
}: {
  chart: ScienceClientArtifactVersion & { attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }> }
  loadImage: ImageLoader
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
  // Keyed by the region's own normalized coordinates, mirroring
  // VegaLiteArtifact's per-path comments: a fresh drag is a distinct key, so
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
      {/* Staging row for the current drawn region — same shape as the
          Vega-Lite spec-path rows below: a comment field and one add/remove
          control that push the exact region target into the composer
          selections store (ScienceDetailsView's addToConversation/
          removeFromConversation), producing the edit.regionTarget chip. */}
      {region !== undefined && regionKey !== undefined && regionLabel !== undefined && (
        <div className={css.specTargetRow}>
          <span className={css.specTarget}>{regionLabel}</span>
          <input
            className={css.specComment}
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
 * Render one artifact version's content: an image through `MessageImage`, or
 * a text attachment fetched through `loadText` and dispatched by media type.
 * @param props - the artifact version to render and both durable-byte loaders.
 * @returns the dispatched content and optional human-edit ancestry.
 */
export function ArtifactContent({
  chart, loadImage, loadText, selectionTarget, onSelectTarget, isTargetAdded,
  targetComment, onAddTarget, onRemoveTarget, onCommitStyle, t,
}: {
  chart: ScienceClientArtifactVersion
  loadImage: ImageLoader
  loadText: TextLoader
  selectionTarget: ScienceEditTarget | undefined
  onSelectTarget: (target: ScienceEditTarget) => void
  isTargetAdded: (target: ScienceEditTarget) => boolean
  targetComment: (target: ScienceEditTarget) => string
  onAddTarget: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget: (target: ScienceEditTarget) => void
  onCommitStyle: (spec: string) => Promise<StyleCommitResult>
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
            loadImage={loadImage} selectionTarget={selectionTarget} onSelectTarget={onSelectTarget}
            isTargetAdded={isTargetAdded} targetComment={targetComment} onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget}
            t={t}
          />
        )
        : (
          <TextArtifactBody
            logicalName={chart.logicalName} attachment={attachment} loadText={loadText}
            selectionTarget={selectionTarget} onSelectTarget={onSelectTarget}
            isTargetAdded={isTargetAdded} targetComment={targetComment} onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget}
            onCommitStyle={onCommitStyle} t={t}
          />
        )}
      {chart.caption !== undefined && <p className={css.caption}>{chart.caption}</p>}
      {chart.origin === 'human-edit' && <div className={css.contentFacts}><span>{t('artifact.humanEdit', { version: chart.parent.version })}</span></div>}
    </div>
  )
}
