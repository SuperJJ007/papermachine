/**
 * Decorative, non-loading thumbnail for a non-image artifact: an icon plus
 * its short extension label, sized to match `MessageImage`'s `tile` variant
 * (64px) so an image and non-image artifact sit in the same grid or row
 * without a visible size jump. Unlike an image thumbnail, this never
 * fetches bytes — a CSV/JSON/Markdown file has no raster to decode, so the
 * tile is a pure function of `mediaType`. Every call site wraps this in its
 * own accessibly-named interactive element (a row or gallery button), so
 * the tile itself is `aria-hidden`.
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ArtifactFileTile.module.css'

/**
 * Dictionary-owned label for a known text media type, or the verbatim
 * uppercased subtype for an unknown media type.
 * @param mediaType - the artifact's durable text media type.
 * @param t - The owning Science translation seat.
 * @returns a short file-type label.
 */
export function artifactExtensionLabel(mediaType: string, t: TranslateNS<'science'>): string {
  switch (mediaType) {
    case 'text/csv': return t('display.file.csv')
    case 'application/json': return t('display.file.json')
    case 'text/markdown': return t('display.file.markdown')
    case 'text/plain': return t('display.file.plain')
    default: return (mediaType.split('/')[1] ?? mediaType).toUpperCase()
  }
}

/**
 * Render one non-image artifact's decorative file-type tile.
 * @param props - the artifact's durable text media type.
 * @returns a fixed 64px icon-plus-extension tile, hidden from the accessibility tree.
 */
export function ArtifactFileTile({ mediaType, t }: { mediaType: string; t: TranslateNS<'science'> }) {
  const kind = mediaType === 'text/csv'
    ? 'table'
    : mediaType === 'application/json'
      ? 'json'
      : 'document'
  return (
    <div className={css.tile} data-kind={kind} aria-hidden="true">
      {kind === 'table'
        ? <svg viewBox="0 0 72 52"><rect x="6" y="6" width="60" height="40" rx="4" /><path d="M6 17h60M6 28h60M6 39h60M26 6v40M46 6v40" /></svg>
        : kind === 'json'
          ? <svg viewBox="0 0 72 52"><path d="M28 10c-5 0-4 6-4 9s-4 4-6 4c2 0 6 1 6 4s-1 9 4 9M44 10c5 0 4 6 4 9s4 4 6 4c-2 0-6 1-6 4s1 9-4 9" /></svg>
          : <svg viewBox="0 0 72 52"><path d="M26 6h14l8 8v32H26a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM40 6v8h8M30 22h12M30 29h12M30 36h8" /></svg>}
      <span className={css.ext}>{artifactExtensionLabel(mediaType, t)}</span>
    </div>
  )
}
