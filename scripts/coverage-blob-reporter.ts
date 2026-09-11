/** Preserve V8 source-range containment across Vitest's JSON blob transport. */
import { ReportersMap } from 'vitest/node'

/** Write ordinary Vitest blobs with JSON-safe, unbounded source columns. */
export default class CoverageBlobReporter extends ReportersMap.blob {
  /** Copy the provider map without changing counts or the in-process report. */
  override onCoverage(coverage: unknown): void {
    // ast-v8-to-istanbul uses Infinity for an unmapped end column. JSON would
    // turn it into null, preventing Istanbul from matching containing ranges
    // across Node and jsdom transforms. No source column can reach this bound.
    super.onCoverage(JSON.parse(JSON.stringify(coverage, (key, value: unknown) =>
      key === 'column' && value === Infinity ? Number.MAX_SAFE_INTEGER : value)))
  }
}
