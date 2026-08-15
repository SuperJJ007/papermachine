/** Derivation of the client-safe Science projection from strict replay state. */

import type { ScienceFoldState } from './fold-state.ts'
import type {
  ScienceChartVersion,
  ScienceProjection,
  ScienceProjectionMetrics,
  ScienceRun,
} from './types.ts'

/**
 * Derive stable projection counters from whole-value collections.
 * @param runs - projected run history.
 * @param charts - projected chart-version history.
 * @param outcomeRevision - latest Outcome revision, or zero.
 * @returns counters derived from the supplied values.
 */
export function scienceProjectionMetrics(
  runs: readonly ScienceRun[],
  charts: readonly ScienceChartVersion[],
  outcomeRevision: number,
): ScienceProjectionMetrics {
  return {
    runCount: runs.length,
    successfulRunCount: runs.filter(run => run.status === 'success').length,
    chartCount: new Set(charts.map(chart => chart.chartId)).size,
    chartVersionCount: charts.length,
    outcomeRevision,
  }
}

/**
 * Derive the public value from one accepted strict fold accumulator.
 * @param state - accepted strict replay state.
 * @returns the public projection, or `null` before mode binding.
 */
export function projectScienceFold(state: ScienceFoldState): ScienceProjection | null {
  if (state.mode === undefined || state.lastScienceEventSeq === undefined) return null
  const outcome = state.outcomes.at(-1) ?? null
  return {
    mode: state.mode,
    environment: state.environments.at(-1) ?? null,
    runs: state.runs,
    charts: state.charts,
    outcome,
    metrics: scienceProjectionMetrics(state.runs, state.charts, outcome?.revision ?? 0),
    lastScienceEventSeq: state.lastScienceEventSeq,
  }
}
