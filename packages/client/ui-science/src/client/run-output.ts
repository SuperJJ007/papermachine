/**
 * Pure client-side derivation for one `run_python`/`run_r` row's eight
 * presentation states, computed entirely from already-logged facts: the
 * flattened durable tool-result text `tool-science`'s `formatRunResult`
 * produces, and the joined `science` Session projection run entry. Nothing
 * here invents a Host fact — a field this module cannot recover degrades to
 * `null`/omission, never a guess.
 */

/** The two fixed section markers `formatRunResult` (tool-science `run.ts`) always emits, in order. */
const STDOUT_MARKER = '--- stdout ---\n'
const STDERR_MARKER = '\n--- stderr ---\n'
const EMPTY_SENTINEL = '(empty)'
const STDOUT_TRUNCATED_SUFFIX = '\n(stdout truncated)'
const STDERR_TRUNCATED_MARKER = '\n(stderr truncated)'
/**
 * Fixed capture-report line prefixes `formatRunResult` may append after the
 * stderr section; their presence marks where stderr's own text ends when no
 * `(stderr truncated)` marker precedes them.
 */
const STDERR_FOOTER_PREFIXES = [
  '\nCaptured ',
  '\n(more eligible files existed',
  "\n(this session's artifact-capture limit was reached",
  '\n(',
]

/** Raw stdout/stderr text recovered from one run's flattened tool-result content. */
export interface RunOutputSections {
  readonly stdout: string
  readonly stdoutTruncatedMarker: boolean
  readonly stderr: string
}

/**
 * Recover the raw stdout/stderr text `formatRunResult` folded into one
 * flattened content string, by locating its two fixed section markers.
 * Returns `null` when the text does not carry both markers — a hand-built
 * fixture or a future format change — so a caller degrades instead of
 * misattributing unrelated text as run output.
 * @param resultText - the tool-result's joined content text.
 * @returns the recovered sections, or `null` when the markers are absent.
 */
export function splitRunResultSections(resultText: string): RunOutputSections | null {
  const stdoutAt = resultText.indexOf(STDOUT_MARKER)
  if (stdoutAt === -1) return null
  const afterStdoutMarker = stdoutAt + STDOUT_MARKER.length
  const stderrAt = resultText.indexOf(STDERR_MARKER, afterStdoutMarker)
  if (stderrAt === -1) return null

  let stdoutBlock = resultText.slice(afterStdoutMarker, stderrAt)
  const stdoutTruncatedMarker = stdoutBlock.endsWith(STDOUT_TRUNCATED_SUFFIX)
  if (stdoutTruncatedMarker) stdoutBlock = stdoutBlock.slice(0, -STDOUT_TRUNCATED_SUFFIX.length)
  const stdout = stdoutBlock === EMPTY_SENTINEL ? '' : stdoutBlock

  let stderrBlock = resultText.slice(stderrAt + STDERR_MARKER.length)
  const truncatedAt = stderrBlock.indexOf(STDERR_TRUNCATED_MARKER)
  if (truncatedAt !== -1) {
    stderrBlock = stderrBlock.slice(0, truncatedAt)
  } else {
    let footerAt = -1
    for (const prefix of STDERR_FOOTER_PREFIXES) {
      const at = stderrBlock.indexOf(prefix)
      if (at !== -1 && (footerAt === -1 || at < footerAt)) footerAt = at
    }
    if (footerAt !== -1) stderrBlock = stderrBlock.slice(0, footerAt)
  }
  const stderr = stderrBlock === EMPTY_SENTINEL ? '' : stderrBlock

  return { stdout, stdoutTruncatedMarker, stderr }
}

/**
 * Count text lines the way a person reading a terminal would: a single
 * trailing newline (the common case for printed output) does not count as
 * one more blank line.
 * @param text - retained text to count.
 * @returns the line count, `0` for an empty string.
 */
export function countLines(text: string): number {
  if (text === '') return 0
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

/**
 * Exact UTF-8 byte length of retained text — used for both an untruncated
 * total and a truncated tail's retained size, since either way this is the
 * byte count of what is actually available to show, with no dependency on
 * the Runtime's internal retention cap.
 * @param text - retained text to measure.
 * @returns the byte length.
 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Format an elapsed duration as `mm:ss`, matching the running row's live
 * counter.
 * @param ms - elapsed milliseconds; negative values clamp to zero.
 * @returns the `mm:ss` label.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Format a settled duration as one-decimal seconds (`"0.9s"`), matching the
 * success/failure status line.
 * @param ms - elapsed milliseconds; negative values clamp to zero.
 * @returns the `X.Xs` label.
 */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
}

/**
 * First non-blank line of text, trimmed — the same "first informative line"
 * heuristic the fallback rows already use for a one-line summary.
 * @param text - candidate text.
 * @returns the first non-blank trimmed line, or `''` when none exists.
 */
export function firstLine(text: string): string {
  return text.split(/\r?\n/u).map(line => line.trim()).find(Boolean) ?? ''
}
