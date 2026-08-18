/** Derivation of the client-safe Science projection from strict replay state. */

import type { ScienceFoldState } from './fold-state.ts'
import type {
  ScienceClientChartVersion,
  ScienceClientEnvironmentBinding,
  ScienceClientInterpreterBinding,
  ScienceClientOutcomePublication,
  ScienceClientProjection,
  ScienceClientRun,
  ScienceChartVersion,
  ScienceEnvironmentBinding,
  ScienceInterpreterBinding,
  ScienceOutcomePublication,
  ScienceProjection,
  ScienceProjectionMetrics,
  ScienceRun,
} from './types.ts'

/** Stable client-visible prefix of a full environment fingerprint. */
const fingerprintPreview = (fingerprint: string): string => fingerprint.slice(0, 12)

/** Keep a subprocess label only when it cannot carry a Host path. */
const pathFreeLabel = (label: string | undefined): string | undefined =>
  label !== undefined && !/[\\/]/.test(label) ? label : undefined

/**
 * Remove paths, executable identity, digests, and free-text failure from an
 * interpreter binding. Package names and versions carry no Host path, so
 * `packages` and `packagesTruncated` pass through unredacted; only the
 * inventory digest is truncated to a preview.
 */
function clientInterpreter(binding: ScienceInterpreterBinding): ScienceClientInterpreterBinding {
  const languageVersion = pathFreeLabel(binding.languageVersion)
  return {
    language: binding.language,
    capability: binding.capability,
    ...languageVersion === undefined ? {} : { languageVersion },
    ...binding.bindingFingerprint === undefined
      ? {}
      : { fingerprintPreview: fingerprintPreview(binding.bindingFingerprint) },
    ...binding.packages === undefined ? {} : { packages: binding.packages },
    ...binding.packagesTruncated === undefined ? {} : { packagesTruncated: binding.packagesTruncated },
    ...binding.packagesSha256 === undefined
      ? {}
      : { packagesSha256Preview: fingerprintPreview(binding.packagesSha256) },
  }
}

/** Remove Host-owned fields from an environment revision. */
function clientEnvironment(environment: ScienceEnvironmentBinding): ScienceClientEnvironmentBinding {
  return {
    revision: environment.revision,
    profileId: environment.profileId,
    configuredAt: environment.configuredAt,
    validatedAt: environment.validatedAt,
    status: environment.status,
    ...environment.python === undefined ? {} : { python: clientInterpreter(environment.python) },
    ...environment.r === undefined ? {} : { r: clientInterpreter(environment.r) },
  }
}

/**
 * Remove scratch key, run directory reference, full environment fingerprint,
 * and free-text failure fields from one run. `toolCallId` and
 * `requestHeaderSeq` pass through: the browser already holds both as
 * session-log identities, and they let the client join a run to its
 * authorizing transcript call. `codeSha256` passes through whole (not
 * truncated like the environment fingerprint): it is a digest over source
 * text the same transcript call already restates verbatim once resolved, so
 * it carries no Host-infrastructure fact, and provenance needs the durable
 * anchor to be exact.
 */
function clientRun(run: ScienceRun): ScienceClientRun {
  const common = {
    runId: run.runId,
    language: run.language,
    toolCallId: run.toolCallId,
    requestHeaderSeq: run.requestHeaderSeq,
    environmentRevision: run.environmentRevision,
    environmentFingerprintPreview: fingerprintPreview(run.environmentFingerprint),
    startedAt: run.startedAt,
    codeSha256: run.codeSha256,
  }
  if (run.status === 'running') return { ...common, status: run.status }
  if (run.status === 'interrupted') {
    return {
      ...common,
      status: run.status,
      finishedAt: run.finishedAt,
      interruptedAtSeq: run.interruptedAtSeq,
    }
  }
  const signal = pathFreeLabel(run.signal)
  return {
    ...common,
    status: run.status,
    finishedAt: run.finishedAt,
    ...run.exitCode === undefined ? {} : { exitCode: run.exitCode },
    ...signal === undefined ? {} : { signal },
    stdoutBytes: run.stdoutBytes,
    stderrBytes: run.stderrBytes,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
    ...run.failureCode === undefined ? {} : { failureCode: run.failureCode },
  }
}

/**
 * Remove the full environment fingerprint from one chart version.
 * `toolCallId` and `requestHeaderSeq` pass through: the browser already
 * holds both as session-log identities, and they let the client join a chart
 * version to its authorizing transcript call for provenance.
 */
function clientChart(chart: ScienceChartVersion): ScienceClientChartVersion {
  return {
    chartId: chart.chartId,
    logicalName: chart.logicalName,
    version: chart.version,
    title: chart.title,
    ...chart.caption === undefined ? {} : { caption: chart.caption },
    attachment: chart.attachment,
    runId: chart.runId,
    toolCallId: chart.toolCallId,
    requestHeaderSeq: chart.requestHeaderSeq,
    environmentRevision: chart.environmentRevision,
    environmentFingerprintPreview: fingerprintPreview(chart.environmentFingerprint),
    createdAt: chart.createdAt,
  }
}

/** Remove authorizing request facts from one Outcome publication. */
function clientOutcome(outcome: ScienceOutcomePublication): ScienceClientOutcomePublication {
  return {
    revision: outcome.revision,
    title: outcome.title,
    summaryMarkdown: outcome.summaryMarkdown,
    evidence: outcome.evidence,
    publishedAt: outcome.publishedAt,
    environmentRevisions: outcome.environmentRevisions,
  }
}

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

/**
 * Remove Host-only provenance and authorization fields from a strict replay value.
 * @param projection - complete Host-side replay value.
 * @returns the browser-safe Session projection, or `null` before mode binding.
 */
export function toClientScienceProjection(
  projection: ScienceProjection | null,
): ScienceClientProjection | null {
  if (projection === null) return null
  return {
    mode: projection.mode,
    environment: projection.environment === null ? null : clientEnvironment(projection.environment),
    runs: projection.runs.map(clientRun),
    charts: projection.charts.map(clientChart),
    outcome: projection.outcome === null ? null : clientOutcome(projection.outcome),
    metrics: projection.metrics,
    lastScienceEventSeq: projection.lastScienceEventSeq,
  }
}

/**
 * Derive the browser-safe projection from one accepted strict fold.
 * @param state - accepted strict replay state.
 * @returns the client projection, or `null` before mode binding.
 */
export function projectScienceClientFold(state: ScienceFoldState): ScienceClientProjection | null {
  return toClientScienceProjection(projectScienceFold(state))
}
