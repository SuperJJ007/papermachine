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

import css from './ArtifactFileTile.module.css'

/**
 * Short, language-neutral label for one text media type — the same register
 * as an unlocalized file extension (".csv", ".json"), never translated.
 * @param mediaType - the artifact's durable text media type.
 * @returns a short uppercase label.
 */
export function artifactExtensionLabel(mediaType: string): string {
  switch (mediaType) {
    case 'text/csv': return 'CSV'
    case 'application/json': return 'JSON'
    case 'application/vnd.vega-lite+json': return 'VL'
    case 'text/markdown': return 'MD'
    case 'text/plain': return 'TXT'
    default: return (mediaType.split('/')[1] ?? mediaType).toUpperCase()
  }
}

/**
 * Render one non-image artifact's decorative file-type tile.
 * @param props - the artifact's durable text media type.
 * @returns a fixed 64px icon-plus-extension tile, hidden from the accessibility tree.
 */
export function ArtifactFileTile({ mediaType }: { mediaType: string }) {
  const kind = mediaType === 'application/vnd.vega-lite+json'
    ? 'chart'
    : mediaType === 'text/csv'
      ? 'table'
      : mediaType === 'application/json'
        ? 'json'
        : 'document'
  return (
    <div className={css.tile} data-kind={kind} aria-hidden="true">
      {kind === 'chart'
        ? <svg viewBox="0 0 72 52"><path d="M12 44h52M12 44V8" /><rect x="19" y="36" width="10" height="8" /><rect x="35" y="26" width="10" height="18" /><rect x="51" y="14" width="10" height="30" /></svg>
        : kind === 'table'
          ? <svg viewBox="0 0 72 52"><rect x="6" y="6" width="60" height="40" rx="4" /><path d="M6 17h60M6 28h60M6 39h60M26 6v40M46 6v40" /></svg>
          : kind === 'json'
            ? <svg viewBox="0 0 72 52"><path d="M28 10c-5 0-4 6-4 9s-4 4-6 4c2 0 6 1 6 4s-1 9 4 9M44 10c5 0 4 6 4 9s4 4 6 4c-2 0-6 1-6 4s1 9-4 9" /></svg>
            : <svg viewBox="0 0 72 52"><path d="M26 6h14l8 8v32H26a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM40 6v8h8M30 22h12M30 29h12M30 36h8" /></svg>}
      <span className={css.ext}>{artifactExtensionLabel(mediaType)}</span>
    </div>
  )
}
