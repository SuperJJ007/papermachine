/** `get_science_state`: a sanitized, bounded view of one durable Science projection. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { replayScience } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceInterpreterBinding,
  ScienceProjection,
} from '@deepseek-ai/dsh-science-session'
import { scienceFingerprintPreview, scienceModelObservedLabel } from './context.ts'
import { requireScienceSession } from './run.ts'
import { scienceChartSchemaProperties } from './chart-schema.ts'

const stateInterpreterSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', enum: ['python', 'r'], required: true },
    capability: { type: 'string', enum: ['available', 'unavailable', 'invalid', 'drifted'], required: true },
    languageVersion: { type: 'string' },
    fingerprint: { type: 'string' },
  },
} as const

const stateEnvironmentSchema = {
  oneOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        revision: { type: 'integer', required: true },
        profileId: { type: 'string', required: true },
        validatedAt: { type: 'integer', required: true },
        status: { type: 'string', enum: ['applied', 'invalid', 'drifted'], required: true },
        python: stateInterpreterSchema,
        r: stateInterpreterSchema,
      },
    },
  ],
} as const

const stateChartSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...scienceChartSchemaProperties,
    environmentRevision: { type: 'integer', required: true },
    environmentFingerprintPreview: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    createdAt: { type: 'integer', required: true },
  },
} as const

const stateOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'json', required: true },
    environment: { ...stateEnvironmentSchema, required: true },
    runs: { type: 'array', items: { type: 'json' }, required: true },
    charts: { type: 'array', items: stateChartSchema, required: true },
    outcome: { type: 'json', required: true },
    metrics: { type: 'json', required: true },
    history: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        runsOmitted: { type: 'integer', required: true },
        chartVersionsOmitted: { type: 'integer', required: true },
      },
    },
    lastScienceEventSeq: { type: 'integer', required: true },
  },
} as const

/** Sanitized, bounded replay view inferred from the advertised output schema. */
type ScienceStateValue = InferValue<typeof stateOutputSchema>

type ScienceStateInterpreter = InferValue<typeof stateInterpreterSchema>

/** Remove Host paths and executable identity while retaining model-relevant capability facts. */
function stateInterpreter(binding: ScienceInterpreterBinding): ScienceStateInterpreter {
  const observedVersion = binding.languageVersion
  const languageVersion = observedVersion === undefined ? undefined : scienceModelObservedLabel(observedVersion)
  return {
    language: binding.language,
    capability: binding.capability,
    ...languageVersion === undefined ? {} : { languageVersion },
    ...binding.bindingFingerprint === undefined
      ? {}
      : { fingerprint: scienceFingerprintPreview(binding.bindingFingerprint) },
  }
}

/** Remove Host-only fields from one durable environment revision. */
function stateEnvironment(environment: ScienceEnvironmentBinding | null): ScienceStateValue['environment'] {
  if (environment === null) return null
  return {
    revision: environment.revision,
    profileId: String(environment.profileId),
    validatedAt: environment.validatedAt,
    status: environment.status,
    ...environment.python === undefined ? {} : { python: stateInterpreter(environment.python) },
    ...environment.r === undefined ? {} : { r: stateInterpreter(environment.r) },
  }
}

/** Remove Runtime-owned free text that could contain a Host path from one recent run. */
function stateRun(run: ScienceProjection['runs'][number]): JsonValue {
  if (!('failureMessage' in run) && !('signal' in run)) return run as unknown as JsonValue
  const { failureMessage: _failureMessage, signal, ...safe } = run
  const modelSignal = signal === undefined ? undefined : scienceModelObservedLabel(signal)
  return { ...safe, ...modelSignal === undefined ? {} : { signal: modelSignal } }
}

/**
 * Narrow a durable artifact version to one carrying an image attachment.
 * `get_science_state`'s `charts` field is PNG-only until PR4's
 * `stateArtifact` generalization; an auto-captured text artifact is durably
 * logged (`science/artifact-saved`) but not yet surfaced through this tool —
 * see the runtime README's Known Limitations.
 */
function hasImageAttachment(
  artifact: ScienceArtifactVersion,
): artifact is ScienceArtifactVersion & { attachment: Extract<ScienceArtifactVersion['attachment'], { width: number }> } {
  return 'width' in artifact.attachment
}

/**
 * Remove the internal attachment id, full environment fingerprint,
 * authorizing tool call, and request-header sequence from one durable chart
 * version. The full `ImageAttachmentRef` remains available only to the
 * durable projection, authorization, export, and Client presentation paths —
 * never to model state.
 */
function stateChart(chart: ScienceArtifactVersion & { attachment: Extract<ScienceArtifactVersion['attachment'], { width: number }> }): InferValue<typeof stateChartSchema> {
  return {
    chartId: String(chart.artifactId),
    logicalName: chart.logicalName,
    version: chart.version,
    title: chart.title,
    ...chart.caption === undefined ? {} : { caption: chart.caption },
    runId: String(chart.runId),
    environmentRevision: chart.environmentRevision,
    environmentFingerprintPreview: scienceFingerprintPreview(chart.environmentFingerprint),
    mediaType: chart.attachment.mediaType,
    bytes: chart.attachment.bytes,
    width: chart.attachment.width,
    height: chart.attachment.height,
    createdAt: chart.createdAt,
  }
}

/**
 * Build the bounded model-facing value from one exact replay projection.
 * Durable codecs bound every retained item; this owner additionally caps both
 * growing history collections and reports the omitted counts.
 * @param projection - exact replayed Science projection.
 * @param historyItemLimit - maximum recent entries retained per history collection.
 * @returns sanitized, bounded tool value.
 */
export function stateValueFromProjection(
  projection: ScienceProjection,
  historyItemLimit: number,
): ScienceStateValue {
  const runsOmitted = Math.max(0, projection.runs.length - historyItemLimit)
  const imageArtifacts = projection.artifacts.filter(hasImageAttachment)
  const chartVersionsOmitted = Math.max(0, imageArtifacts.length - historyItemLimit)
  return {
    mode: projection.mode as unknown as JsonValue,
    environment: stateEnvironment(projection.environment),
    runs: projection.runs.slice(-historyItemLimit).map(stateRun),
    charts: imageArtifacts.slice(-historyItemLimit).map(stateChart),
    outcome: projection.outcome as unknown as JsonValue,
    metrics: projection.metrics as unknown as JsonValue,
    history: { runsOmitted, chartVersionsOmitted },
    lastScienceEventSeq: projection.lastScienceEventSeq,
  }
}

/**
 * Register `get_science_state`, a no-argument read of the exact Session's
 * sanitized Science projection with bounded run and chart-version history.
 * @param ctx - plugin context.
 * @param historyItemLimit - maximum recent entries returned per history collection.
 */
export function applyScienceStateTool(ctx: Context, historyItemLimit: number): void {
  ctx.tools.register(defineTool({
    name: 'get_science_state',
    description: 'Return the current Science session state: mode, sanitized bound environment, recent run and chart-version histories with omitted counts, and the latest published outcome. Takes no arguments.',
    parameters: {},
    output: {
      schema: stateOutputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, undefined, 2) }],
    },
    isConcurrencySafe: () => true,
    execute(_args, exec): Promise<ScienceStateValue> {
      const session = requireScienceSession(exec)
      const projection = replayScience(session.events)
      if (projection === null) throw new Error('tool-science: Science mode is not bound for this session')
      return Promise.resolve(stateValueFromProjection(projection, historyItemLimit))
    },
  }))
}
