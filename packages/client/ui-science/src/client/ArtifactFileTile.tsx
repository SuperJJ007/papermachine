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

import { IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
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
  return (
    <div className={css.tile} aria-hidden="true">
      <IconDataOutline16 size={20} />
      <span className={css.ext}>{artifactExtensionLabel(mediaType)}</span>
    </div>
  )
}
