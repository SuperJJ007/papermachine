/**
 * Projections from a canonical `save_chart`/`publish_outcome` result to its
 * tagged, versioned `output.presentationMeta` value. The value shapes
 * themselves are client-safe and live in `./types.ts`, importable without
 * this package's host-only runtime.
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ScienceOutcomeResultValue } from './publish-outcome.ts'
import type { ScienceChartReceiptValue } from './save-chart.ts'
import type { ScienceChartPresentation, ScienceOutcomePresentation } from './types.ts'

export type {
  ScienceChartPresentation,
  ScienceChartPresentationAttachment,
  ScienceOutcomeEvidencePresentation,
  ScienceOutcomePresentation,
} from './types.ts'

/**
 * Project a `save_chart` canonical result into its tagged presentation value.
 * @param value - the canonical `save_chart` output value.
 * @returns the presentation value persisted as `tool/result.meta`.
 */
export function scienceChartPresentation(value: ScienceChartReceiptValue): JsonValue {
  const presentation: ScienceChartPresentation = {
    kind: 'science/chart',
    version: 1,
    chartId: value.chartId,
    logicalName: value.logicalName,
    chartVersion: value.version,
    title: value.title,
    ...value.caption === undefined ? {} : { caption: value.caption },
    runId: value.runId,
    attachment: {
      attachmentId: value.attachmentId,
      mediaType: value.mediaType,
      bytes: value.bytes,
      width: value.width,
      height: value.height,
      ...value.attachmentName === undefined ? {} : { name: value.attachmentName },
    },
    createdAt: value.createdAt,
  }
  return presentation as unknown as JsonValue
}

/**
 * Project a `publish_outcome` canonical result into its tagged presentation
 * value — the exact published revision, preserved for replay after a newer
 * Outcome later replaces the projection's current value.
 * @param value - the canonical `publish_outcome` output value.
 * @returns the presentation value persisted as `tool/result.meta`.
 */
export function scienceOutcomePresentation(value: ScienceOutcomeResultValue): JsonValue {
  const presentation: ScienceOutcomePresentation = {
    kind: 'science/outcome',
    version: 1,
    revision: value.revision,
    title: value.title,
    summaryMarkdown: value.summaryMarkdown,
    evidence: value.evidence,
    publishedAt: value.publishedAt,
  }
  return presentation as unknown as JsonValue
}
