/**
 * The artifact viewer's per-media-type content dispatch: the seam
 * `ScienceDetailsView.tsx`'s toolbar/tab-strip never touches. An image
 * attachment renders through `MessageImage`; a text attachment fetches its
 * decoded bytes through `loadText` and dispatches again on media type — CSV
 * as a sortable table (`ArtifactTable`), JSON as `JsonTree`, Markdown as
 * `MarkdownText`, and plain text as preformatted text. Adding a future
 * accepted media type is a new `switch` case here, never a change to the
 * viewer's tab strip, toolbar, or gallery.
 */

import { useEffect, useState } from 'react'
import type { TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { formatBytes } from '@deepseek-ai/dsh-byte-size'
import { MessageImage } from '@deepseek-ai/dsh-client-ui-attachment'
import type { ImageLoader, MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import { JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceClientArtifactVersion } from '@deepseek-ai/dsh-science-session/types'
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

/** One text attachment's dispatched body: loading/error states, then the per-media-type renderer. */
function TextArtifactBody({ logicalName, attachment, loadText, t }: {
  logicalName: string
  attachment: TextAttachmentRef
  loadText: TextLoader
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
export function ArtifactContent({ chart, loadImage, loadText, t }: {
  chart: ScienceClientArtifactVersion
  loadImage: ImageLoader
  loadText: TextLoader
  t: TranslateNS<'science'>
}) {
  const { attachment } = chart
  const isImage = 'width' in attachment
  return (
    <div className={css.content}>
      {isImage
        ? <MessageImage attachment={attachment} load={loadImage} variant="single" labels={artifactImageLabels(t)} />
        : <TextArtifactBody logicalName={chart.logicalName} attachment={attachment} loadText={loadText} t={t} />}
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
