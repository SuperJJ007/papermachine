/** Shared display formatting for the artifact viewer and its rows. */

/**
 * Rendered-row cap for `ArtifactTable`: this component has no row
 * virtualization (unlike `dsh-client-ui-trajectory`'s `TrajectoryTable`), so
 * an unbounded auto-captured or model-annotated CSV — the deployment's
 * `textLimits` allow up to 5 MiB — renders every row into the DOM at once.
 * A presentation bound, not a `Config` field: the attachment byte cap that
 * admits the file is the deployment's own, durable choice; this cap only
 * protects the browser tab rendering it.
 */
export const MAX_ARTIFACT_TABLE_ROWS = 500

/**
 * Rendered-character cap for a text artifact's `<pre>`/`JsonTree` body,
 * mirroring `MAX_ARTIFACT_TABLE_ROWS`'s rationale for the non-CSV media
 * types: the deployment's `textLimits` allow up to 5 MiB, which is safe to
 * store and transfer but not to hand a browser's DOM/JSON-tree renderer
 * whole. Ordinary JSON applies this limit before parsing. Vega-Lite uses its
 * separate parse/render safety limit below and applies this display limit
 * only to fallback source text.
 */
export const MAX_ARTIFACT_TEXT_CHARACTERS = 100_000

/**
 * Browser-side Vega-Lite JSON parse and render safety limit. This is not a
 * text display limit: specifications at or below it are parsed in full so
 * large inline datasets remain renderable, while any fallback source text
 * is still bounded by `MAX_ARTIFACT_TEXT_CHARACTERS`.
 */
export const MAX_VEGA_LITE_SPEC_CHARACTERS = 8_000_000

/** One rendered slice of a larger value, plus whether the slice is shorter than the source. */
export interface RenderTruncation<T> {
  readonly value: T
  readonly truncated: boolean
  readonly total: number
}

/**
 * Cap an array to its first `max` entries for rendering.
 * @param items - the complete array a caller would otherwise render whole.
 * @param max - the maximum entries to keep.
 * @returns the capped array, whether it was shorter than `items`, and `items`' original length.
 */
export function capForDisplay<T>(items: readonly T[], max: number): RenderTruncation<readonly T[]> {
  return { value: items.length > max ? items.slice(0, max) : items, truncated: items.length > max, total: items.length }
}

/**
 * Cap text to its first `max` UTF-16 code units for rendering.
 * @param text - the complete string a caller would otherwise render whole.
 * @param max - the maximum characters to keep.
 * @returns the capped string, whether it was longer than `max`, and `text`'s original length.
 */
export function capTextForDisplay(text: string, max: number): RenderTruncation<string> {
  return { value: text.length > max ? text.slice(0, max) : text, truncated: text.length > max, total: text.length }
}
