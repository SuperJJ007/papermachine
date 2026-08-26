/** Derivation of the client-safe Science projection from strict replay state. */

import { assertNever } from '@deepseek-ai/dsh-llm'
import type { ScienceFoldState } from './fold-state.ts'
import type {
  ScienceClientArtifactVersion,
  ScienceClientEnvironmentBinding,
  ScienceClientInterpreterBinding,
  ScienceClientKernel,
  ScienceClientOutcomePublication,
  ScienceClientProjection,
  ScienceClientRun,
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceInterpreterBinding,
  ScienceKernel,
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
 * Remove the full environment fingerprint from one kernel lifecycle fact or
 * its end-seed `interrupted` derivation. Neither durable shape carries a
 * Host path, so the fingerprint preview is the only redaction needed.
 */
function clientKernel(kernel: ScienceKernel): ScienceClientKernel {
  const common = {
    kernelEpoch: kernel.kernelEpoch,
    language: kernel.language,
    environmentRevision: kernel.environmentRevision,
    environmentFingerprintPreview: fingerprintPreview(kernel.environmentFingerprint),
  }
  switch (kernel.state) {
    case 'started':
    case 'exited':
      return {
        ...common,
        state: kernel.state,
        ...kernel.reason === undefined ? {} : { reason: kernel.reason },
        ...kernel.startedAt === undefined ? {} : { startedAt: kernel.startedAt },
        at: kernel.at,
      }
    case 'interrupted':
      return {
        ...common,
        state: kernel.state,
        startedAt: kernel.startedAt,
        finishedAt: kernel.finishedAt,
        interruptedAtSeq: kernel.interruptedAtSeq,
      }
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(kernel)
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
    ...run.inputs === undefined ? {} : { inputs: run.inputs },
    kernelEpoch: run.kernelEpoch,
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
  return {
    ...common,
    status: run.status,
    finishedAt: run.finishedAt,
    stdoutBytes: run.stdoutBytes,
    stderrBytes: run.stderrBytes,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
    ...run.failureCode === undefined ? {} : { failureCode: run.failureCode },
    ...run.outputDegraded === undefined ? {} : { outputDegraded: run.outputDegraded },
  }
}

/**
 * Remove the full environment fingerprint and the owning `projectId` from one
 * artifact version — content reads are session-addressed, so the client never
 * needs the store's project coordinate. `toolCallId` and `requestHeaderSeq`
 * pass through: the browser already holds both as session-log identities, and
 * they let the client join an artifact version to its authorizing transcript
 * call for provenance.
 */
function clientArtifact(artifact: ScienceArtifactVersion): ScienceClientArtifactVersion {
  const common = {
    artifactId: artifact.artifactId,
    logicalName: artifact.logicalName,
    version: artifact.version,
    title: artifact.title,
    ...artifact.caption === undefined ? {} : { caption: artifact.caption },
    versionId: artifact.versionId,
    sha256: artifact.sha256,
    byteCount: artifact.byteCount,
    environmentRevision: artifact.environmentRevision,
    environmentFingerprintPreview: fingerprintPreview(artifact.environmentFingerprint),
    createdAt: artifact.createdAt,
  }
  return artifact.origin === 'human-edit'
    ? { ...common, parent: artifact.parent, origin: artifact.origin, mediaType: artifact.mediaType }
    : {
      ...common,
      ...artifact.parent === undefined ? {} : { parent: artifact.parent },
      origin: artifact.origin,
      mediaType: artifact.mediaType,
      runId: artifact.runId,
      toolCallId: artifact.toolCallId,
      requestHeaderSeq: artifact.requestHeaderSeq,
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
 * @param kernels - projected kernel history.
 * @param artifacts - projected artifact-version history.
 * @param outcomeRevision - latest Outcome revision, or zero.
 * @returns counters derived from the supplied values.
 */
export function scienceProjectionMetrics(
  runs: readonly ScienceRun[],
  kernels: readonly ScienceKernel[],
  artifacts: readonly ScienceArtifactVersion[],
  outcomeRevision: number,
): ScienceProjectionMetrics {
  return {
    runCount: runs.length,
    successfulRunCount: runs.filter(run => run.status === 'success').length,
    artifactCount: new Set(artifacts.map(artifact => artifact.artifactId)).size,
    artifactVersionCount: artifacts.length,
    kernelCount: kernels.length,
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
    kernels: state.kernels,
    artifacts: state.artifacts,
    outcome,
    metrics: scienceProjectionMetrics(state.runs, state.kernels, state.artifacts, outcome?.revision ?? 0),
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
    kernels: projection.kernels.map(clientKernel),
    artifacts: projection.artifacts.map(clientArtifact),
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
