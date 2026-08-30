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
  ScienceKernel,
  ScienceProjection,
  ScienceProjectionMetrics,
} from '@deepseek-ai/dsh-science-session'
import { closedKernelFacts, modelKernelEndReason, scienceFingerprintPreview, scienceModelObservedLabel } from './context.ts'
import { requireScienceSession } from './run.ts'
import { scienceArtifactSchemaProperties, scienceArtifactValueFields } from './artifact-schema.ts'

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

const stateKernelSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', enum: ['python', 'r'], required: true },
    kernelEpoch: { type: 'integer', required: true },
    state: { type: 'string', enum: ['running', 'exited', 'interrupted'], required: true },
    reason: { type: 'string' },
    startedAt: { type: 'integer', required: true },
  },
} as const

// Explicit field selection, not a verbatim passthrough of
// `ScienceProjectionMetrics`: a future Host-side metrics
// addition must be deliberately wired here to reach the model, rather than
// leaking through automatically. `kernelCount` is dropped rather than
// selected: it is the same fact `kernels`/`history.kernelsOmitted` already
// state per-kernel and in full, in model vocabulary; keeping a redundant raw
// counter alongside them would spend tokens without adding information and
// risks drifting from the bounded `kernels` list under a smaller
// `historyItemLimit`.
const stateMetricsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    runCount: { type: 'integer', required: true },
    successfulRunCount: { type: 'integer', required: true },
    artifactCount: { type: 'integer', required: true },
    artifactVersionCount: { type: 'integer', required: true },
  },
} as const

const stateArtifactSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...scienceArtifactSchemaProperties,
    environmentRevision: { type: 'integer', required: true },
    environmentFingerprintPreview: { type: 'string', required: true },
  },
} as const

const stateOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'json', required: true },
    environment: { ...stateEnvironmentSchema, required: true },
    runs: { type: 'array', items: { type: 'json' }, required: true },
    kernels: { type: 'array', items: stateKernelSchema, required: true },
    artifacts: { type: 'array', items: stateArtifactSchema, required: true },
    metrics: { ...stateMetricsSchema, required: true },
    history: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        runsOmitted: { type: 'integer', required: true },
        kernelsOmitted: { type: 'integer', required: true },
        artifactVersionsOmitted: { type: 'integer', required: true },
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
  if (!('failureMessage' in run)) return run as unknown as JsonValue
  const { failureMessage: _failureMessage, ...safe } = run
  return safe as unknown as JsonValue
}

/**
 * Remove the internal store version id, full environment fingerprint,
 * authorizing tool call, and request-header sequence from one durable
 * artifact version. The store content reference remains available only to
 * the durable projection, authorization, and Client presentation paths —
 * never to model state.
 *
 * Reconstructs the shared fields' key order rather than spreading
 * `scienceArtifactValueFields` as one block: this schema's pinned field
 * order interleaves `environmentRevision`/`environmentFingerprintPreview`
 * between `runId` and `mediaType`, which a trailing spread cannot produce.
 */
function stateArtifact(artifact: ScienceArtifactVersion): InferValue<typeof stateArtifactSchema> {
  const { artifactId, logicalName, version, title, caption, origin, parent, runId, mediaType, bytes, createdAt, edits, editCount } =
    scienceArtifactValueFields(artifact)
  return {
    artifactId,
    logicalName,
    version,
    title,
    ...caption === undefined ? {} : { caption },
    origin,
    ...parent === undefined ? {} : { parent },
    ...runId === undefined ? {} : { runId },
    environmentRevision: artifact.environmentRevision,
    environmentFingerprintPreview: scienceFingerprintPreview(artifact.environmentFingerprint),
    mediaType,
    bytes,
    createdAt,
    ...edits === undefined ? {} : { edits, editCount },
  }
}

/**
 * Render one kernel record in model vocabulary: `started` reads as
 * `running` (the durable word names a fact, not the kernel's current
 * state-of-being from the model's perspective), `exited`/`interrupted` carry
 * their own start time, and `exited` additionally carries the model-vocabulary
 * end reason.
 * @param kernel - one kernel record from a replayed Science projection.
 * @returns the bounded model-facing kernel entry.
 */
function stateKernel(kernel: ScienceKernel): InferValue<typeof stateKernelSchema> {
  if (kernel.state === 'interrupted') {
    return { language: kernel.language, kernelEpoch: kernel.kernelEpoch, state: 'interrupted', startedAt: kernel.startedAt }
  }
  if (kernel.state === 'started') {
    return { language: kernel.language, kernelEpoch: kernel.kernelEpoch, state: 'running', startedAt: kernel.at }
  }
  const facts = closedKernelFacts(kernel)
  /* v8 ignore next -- ScienceKernelState guarantees reason/startedAt are present iff state === 'exited' (types.ts) */
  if (facts === undefined) throw new Error('tool-science: exited kernel fact is missing its required fields')
  return {
    language: kernel.language,
    kernelEpoch: kernel.kernelEpoch,
    state: 'exited',
    reason: modelKernelEndReason(facts.reason),
    startedAt: facts.startedAt,
  }
}

/**
 * Select the model-facing counters explicitly: never spread
 * `ScienceProjectionMetrics` verbatim, so a future Host-side metrics field
 * requires a deliberate addition here to reach the model. `kernelCount` is
 * intentionally not selected — see {@link stateMetricsSchema}'s own doc.
 * @param metrics - the exact replayed projection's derived counters.
 * @returns the bounded model-facing metrics value.
 */
function stateMetrics(metrics: ScienceProjectionMetrics): InferValue<typeof stateMetricsSchema> {
  return {
    runCount: metrics.runCount,
    successfulRunCount: metrics.successfulRunCount,
    artifactCount: metrics.artifactCount,
    artifactVersionCount: metrics.artifactVersionCount,
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
  const kernelsOmitted = Math.max(0, projection.kernels.length - historyItemLimit)
  const artifactVersionsOmitted = Math.max(0, projection.artifacts.length - historyItemLimit)
  return {
    mode: projection.mode as unknown as JsonValue,
    environment: stateEnvironment(projection.environment),
    runs: projection.runs.slice(-historyItemLimit).map(stateRun),
    kernels: projection.kernels.slice(-historyItemLimit).map(stateKernel),
    artifacts: projection.artifacts.slice(-historyItemLimit).map(stateArtifact),
    metrics: stateMetrics(projection.metrics),
    history: { runsOmitted, kernelsOmitted, artifactVersionsOmitted },
    lastScienceEventSeq: projection.lastScienceEventSeq,
  }
}

/**
 * Register `get_science_state`, a no-argument read of the exact Session's
 * sanitized Science projection with bounded run and artifact-version history.
 * @param ctx - plugin context.
 * @param historyItemLimit - maximum recent entries returned per history collection.
 */
export function applyScienceStateTool(ctx: Context, historyItemLimit: number): void {
  ctx.tools.register(defineTool({
    name: 'get_science_state',
    description: 'Return the current Science session state: mode, sanitized bound environment, every language kernel\'s state (running/exited/interrupted, with its epoch, end reason, and start time), and recent run and artifact-version histories with omitted counts. Takes no arguments.',
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
