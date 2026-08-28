/** Strict decoders for the durable Science event vocabulary. */

import { Buffer } from 'node:buffer'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import {
  SCIENCE_EVENT_VERSION,
  ScienceArtifactId,
  ScienceEnvironmentProfileId,
  ScienceProjectId,
  ScienceRunId,
  ScienceScratchKey,
  ScienceVersionId,
} from './ids.ts'
import type {
  ScienceArtifactSavedEvent,
  ScienceDomainEventType,
  ScienceEnvironmentBoundEvent,
  ScienceKernelStateEvent,
  ScienceModeBoundEvent,
  ScienceOutcomePublishedEvent,
  ScienceRunFinishedEvent,
  ScienceRunStartedEvent,
} from './domain.ts'
import type {
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceKernelEndReason,
  ScienceKernelState,
  ScienceModeRef,
  ScienceOutcomePublication,
  ScienceRunStarted,
  ScienceRunTerminal,
} from './types.ts'

const MAX_ID_LENGTH = 128
const MAX_PATH_LENGTH = 4096
const MAX_LABEL_LENGTH = 512
const MAX_REASON_LENGTH = 4096
const MAX_SUMMARY_BYTES = 32 * 1024
/**
 * Fixed decoder ceiling for durable run inputs, independent of the Runtime's
 * configurable materialization limit. The decoder accepts every value that a
 * conforming Runtime may append.
 */
const MAX_ARTIFACT_INPUTS = 4096
/**
 * Fixed decoder ceiling for a durable package inventory, independent of the
 * Runtime's configurable `packagesMaxEntries` cap. Comfortably above that
 * cap's own allowed maximum so the decoder accepts every value the Runtime
 * can produce.
 */
const MAX_PACKAGES_ENTRIES = 50_000
const SAFE_INTEGER = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const POSITIVE_INTEGER = SAFE_INTEGER.min(1)
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/)
const SAFE_ID = z.string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
/**
 * An artifact's stable logical name: the file's forward-slash path relative
 * to its run's artifact directory (auto-capture), or a flat name (curation).
 * Each segment uses the same safe grammar as {@link SAFE_ID}.
 */
const SAFE_LOGICAL_NAME = z.string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine(value => value.split('/').every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)), {
    message: 'logicalName must be forward-slash segments each matching the safe artifact-name grammar',
  })

const RUN_INPUT_PATH = z.string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine(value => value.split('/').every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)), {
    message: 'run input path must be forward-slash segments each matching the safe artifact-name grammar',
  })

const artifactVersionRefSchema = z.object({
  artifactId: SAFE_ID.transform(value => ScienceArtifactId(value)),
  version: POSITIVE_INTEGER,
}).strict()

const runArtifactInputSchema = artifactVersionRefSchema.extend({
  path: RUN_INPUT_PATH,
}).strict()

/** Require normalized, bounded durable text. */
function text(maximum: number): z.ZodString {
  return z.string().min(1).max(maximum).refine(value => value === value.trim(), {
    message: 'must not have surrounding whitespace',
  })
}

/** Accept a fully qualified POSIX, Windows drive, or Windows UNC path. */
function portableAbsolutePath(value: string): boolean {
  return value.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(value)
    || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value)
}

const ABSOLUTE_PATH = text(MAX_PATH_LENGTH).refine(portableAbsolutePath, {
  message: 'must be an absolute POSIX, Windows drive, or Windows UNC path',
})

/** Add one cross-field validation issue. */
function issue(ctx: z.RefinementCtx, message: string, path: PropertyKey[] = []): void {
  ctx.addIssue({ code: 'custom', message, path })
}

const scienceModeSchema = z.object({
  modeId: z.literal('science'),
  presetId: text(MAX_ID_LENGTH),
  modeRevision: text(MAX_ID_LENGTH),
}).strict()

const interpreterSelectionShape = {
  language: z.enum(['python', 'r']),
  configuredPrefix: ABSOLUTE_PATH,
} as const

const sciencePackageSchema = z.object({
  name: text(MAX_LABEL_LENGTH),
  version: text(MAX_LABEL_LENGTH),
}).strict()

const interpreterIdentityShape = {
  canonicalPrefix: ABSOLUTE_PATH,
  executable: ABSOLUTE_PATH,
  executableIdentity: text(MAX_LABEL_LENGTH),
  languageVersion: text(MAX_LABEL_LENGTH),
  condaHistorySha256: SHA256,
  bindingFingerprint: SHA256,
  packages: z.array(sciencePackageSchema).max(MAX_PACKAGES_ENTRIES),
  packagesSha256: SHA256,
  packagesTruncated: z.boolean(),
} as const

const observedInterpreterSchema = z.object({
  ...interpreterSelectionShape,
  ...interpreterIdentityShape,
  capability: z.literal('available'),
}).strict()

const failedInterpreterShape = {
  ...interpreterSelectionShape,
  canonicalPrefix: interpreterIdentityShape.canonicalPrefix.optional(),
  executable: interpreterIdentityShape.executable.optional(),
  executableIdentity: interpreterIdentityShape.executableIdentity.optional(),
  languageVersion: interpreterIdentityShape.languageVersion.optional(),
  condaHistorySha256: interpreterIdentityShape.condaHistorySha256.optional(),
  bindingFingerprint: interpreterIdentityShape.bindingFingerprint.optional(),
  packages: interpreterIdentityShape.packages.optional(),
  packagesSha256: interpreterIdentityShape.packagesSha256.optional(),
  packagesTruncated: interpreterIdentityShape.packagesTruncated.optional(),
  reason: text(MAX_REASON_LENGTH),
} as const

const interpreterSchema = z.discriminatedUnion('capability', [
  observedInterpreterSchema,
  z.object({ ...failedInterpreterShape, capability: z.literal('unavailable') }).strict(),
  z.object({ ...failedInterpreterShape, capability: z.literal('invalid') }).strict(),
  z.object({ ...failedInterpreterShape, capability: z.literal('drifted') }).strict(),
])

const environmentSchema = z.object({
  revision: POSITIVE_INTEGER,
  profileId: SAFE_ID.transform(value => ScienceEnvironmentProfileId(value)),
  configuredAt: SAFE_INTEGER,
  validatedAt: SAFE_INTEGER,
  status: z.enum(['applied', 'invalid', 'drifted']),
  python: interpreterSchema.optional(),
  r: interpreterSchema.optional(),
  failureReason: text(MAX_REASON_LENGTH).optional(),
}).strict().superRefine((environment, ctx) => {
  if (environment.python === undefined && environment.r === undefined) {
    issue(ctx, 'an environment requires at least one interpreter binding')
  }
  if (environment.python !== undefined && environment.python.language !== 'python') {
    issue(ctx, 'the python slot must carry a Python binding', ['python', 'language'])
  }
  if (environment.r !== undefined && environment.r.language !== 'r') {
    issue(ctx, 'the r slot must carry an R binding', ['r', 'language'])
  }
  if (environment.validatedAt < environment.configuredAt) {
    issue(ctx, 'validatedAt cannot precede configuredAt', ['validatedAt'])
  }
  const bindings = [environment.python, environment.r].filter(binding => binding !== undefined)
  if (environment.status === 'applied') {
    if (bindings.some(binding => binding.capability !== 'available')) {
      issue(ctx, 'an applied environment may contain only available bindings')
    }
    if (environment.failureReason !== undefined) {
      issue(ctx, 'an applied environment cannot carry failureReason', ['failureReason'])
    }
  } else if (environment.failureReason === undefined) {
    issue(ctx, `${environment.status} environment requires failureReason`, ['failureReason'])
  }
})

const runIdentityShape = {
  runId: SAFE_ID.transform(value => ScienceRunId(value)),
  language: z.enum(['python', 'r']),
  toolCallId: text(MAX_ID_LENGTH).transform(value => CallId(value)),
  requestHeaderSeq: SAFE_INTEGER,
  environmentRevision: POSITIVE_INTEGER,
  environmentFingerprint: SHA256,
  startedAt: SAFE_INTEGER,
  codeSha256: SHA256,
  scratchKey: SHA256.transform(value => ScienceScratchKey(value)),
  runDirectoryRef: text(MAX_PATH_LENGTH),
  inputs: z.array(runArtifactInputSchema).max(MAX_ARTIFACT_INPUTS).optional(),
  kernelEpoch: POSITIVE_INTEGER,
} as const

const runStartedSchema = z.object({
  ...runIdentityShape,
  status: z.literal('running'),
}).strict().superRefine((run, ctx) => {
  if (run.runDirectoryRef !== `runs/${run.runId}/`) {
    issue(ctx, 'runDirectoryRef must be the canonical session-relative run path', ['runDirectoryRef'])
  }
  const paths = (run.inputs ?? []).map(input => input.path)
  if (new Set(paths).size !== paths.length) issue(ctx, 'run input paths must be unique', ['inputs'])
})

const runTerminalSchema = z.object({
  ...runIdentityShape,
  status: z.enum(['success', 'failed', 'timed-out', 'cancelled']),
  finishedAt: SAFE_INTEGER,
  stdoutBytes: SAFE_INTEGER,
  stderrBytes: SAFE_INTEGER,
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/).max(MAX_ID_LENGTH).optional(),
  failureMessage: text(MAX_REASON_LENGTH).optional(),
  outputDegraded: z.literal(true).optional(),
}).strict().superRefine((run, ctx) => {
  if (run.runDirectoryRef !== `runs/${run.runId}/`) {
    issue(ctx, 'runDirectoryRef must be the canonical session-relative run path', ['runDirectoryRef'])
  }
  if (run.finishedAt < run.startedAt) issue(ctx, 'finishedAt cannot precede startedAt', ['finishedAt'])
  if (run.status === 'success') {
    if (run.failureCode !== undefined || run.failureMessage !== undefined) {
      issue(ctx, 'a successful run cannot carry failure facts')
    }
  } else if (run.failureCode === undefined) {
    issue(ctx, 'a non-success run requires failureCode', ['failureCode'])
  }
})

const KERNEL_END_REASONS = [
  'idle',
  'session-end',
  'environment-rebound',
  'run-escalation',
  'protocol',
  'crash',
  'service-disposed',
] as const satisfies readonly ScienceKernelEndReason[]

const kernelStateSchema = z.object({
  kernelEpoch: POSITIVE_INTEGER,
  language: z.enum(['python', 'r']),
  state: z.enum(['started', 'exited']),
  reason: z.enum(KERNEL_END_REASONS).optional(),
  startedAt: SAFE_INTEGER.optional(),
  environmentRevision: POSITIVE_INTEGER,
  environmentFingerprint: SHA256,
  at: SAFE_INTEGER,
}).strict().superRefine((kernel, ctx) => {
  if (kernel.state === 'exited' && kernel.reason === undefined) {
    issue(ctx, 'an exited kernel state requires reason', ['reason'])
  }
  if (kernel.state === 'started' && kernel.reason !== undefined) {
    issue(ctx, 'a started kernel state cannot carry reason', ['reason'])
  }
  if (kernel.state === 'exited' && kernel.startedAt === undefined) {
    issue(ctx, 'an exited kernel state requires startedAt', ['startedAt'])
  }
  if (kernel.state === 'started' && kernel.startedAt !== undefined) {
    issue(ctx, 'a started kernel state cannot carry startedAt', ['startedAt'])
  }
})

/** Every media type an artifact version may carry: a PNG image, or admitted UTF-8 text. */
const ARTIFACT_MEDIA_TYPES = [
  'image/png',
  'text/csv',
  'application/json',
  'text/markdown',
  'text/plain',
] as const

const artifactBaseSchema = z.object({
  artifactId: SAFE_ID.transform(value => ScienceArtifactId(value)),
  producerSessionId: SAFE_ID.transform(value => value as SessionId),
  logicalName: SAFE_LOGICAL_NAME,
  version: POSITIVE_INTEGER,
  title: text(MAX_LABEL_LENGTH),
  caption: text(MAX_REASON_LENGTH).optional(),
  projectId: SAFE_ID.transform(value => ScienceProjectId(value)),
  versionId: SAFE_ID.transform(value => ScienceVersionId(value)),
  sha256: SHA256,
  mediaType: z.enum(ARTIFACT_MEDIA_TYPES),
  byteCount: POSITIVE_INTEGER,
  environmentRevision: POSITIVE_INTEGER,
  environmentFingerprint: SHA256,
  createdAt: SAFE_INTEGER,
})

const artifactSchema = z.discriminatedUnion('origin', [
  artifactBaseSchema.extend({
    parent: artifactVersionRefSchema.optional(),
    origin: z.enum(['auto', 'model']),
    runId: SAFE_ID.transform(value => ScienceRunId(value)),
    toolCallId: text(MAX_ID_LENGTH).transform(value => CallId(value)),
    requestHeaderSeq: SAFE_INTEGER,
  }).strict(),
  artifactBaseSchema.extend({
    parent: artifactVersionRefSchema,
    origin: z.literal('human-edit'),
    mediaType: z.literal('image/png'),
  }).strict(),
])

/**
 * Reject the pre-store `science/artifact-saved` value shape outright, with a
 * message naming the actual break instead of a generic unknown-key error.
 * Pre-release stance: embedded-attachment session logs are not readable and
 * there is no compatibility shim.
 */
function rejectEmbeddedAttachmentArtifact(value: unknown): void {
  if (typeof value === 'object' && value !== null && 'attachment' in value) {
    throw new Error(
      'science/artifact-saved value embeds a session attachment; artifact bytes now live in the'
      + ' project artifact store, and pre-store session logs are rejected outright (pre-release, no compatibility shim)',
    )
  }
}

const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run'), runId: SAFE_ID.transform(value => ScienceRunId(value)) }).strict(),
  z.object({
    kind: z.literal('chart'),
    chartId: SAFE_ID.transform(value => ScienceArtifactId(value)),
    version: POSITIVE_INTEGER,
  }).strict(),
  z.object({ kind: z.literal('message'), seq: SAFE_INTEGER }).strict(),
])

const outcomeSchema = z.object({
  revision: POSITIVE_INTEGER,
  title: text(MAX_LABEL_LENGTH),
  summaryMarkdown: text(MAX_SUMMARY_BYTES).refine(
    value => Buffer.byteLength(value, 'utf8') <= MAX_SUMMARY_BYTES,
    { message: `summaryMarkdown must be at most ${String(MAX_SUMMARY_BYTES)} UTF-8 bytes` },
  ),
  evidence: z.array(evidenceSchema).min(1).max(256),
  publishedAt: SAFE_INTEGER,
  toolCallId: text(MAX_ID_LENGTH).transform(value => CallId(value)),
  requestHeaderSeq: SAFE_INTEGER,
  environmentRevisions: z.array(POSITIVE_INTEGER).max(256),
}).strict().superRefine((outcome, ctx) => {
  const evidenceKeys = outcome.evidence.map((ref) => {
    switch (ref.kind) {
      case 'run': return `run:${ref.runId}`
      case 'chart': return `chart:${ref.chartId}:${String(ref.version)}`
      case 'message': return `message:${String(ref.seq)}`
    }
  })
  if (new Set(evidenceKeys).size !== evidenceKeys.length) issue(ctx, 'evidence references must be unique', ['evidence'])
  if (new Set(outcome.environmentRevisions).size !== outcome.environmentRevisions.length
    || outcome.environmentRevisions.some((revision, index) => {
      const previous = outcome.environmentRevisions[index - 1]
      return previous !== undefined && revision <= previous
    })) {
    issue(ctx, 'environmentRevisions must be unique and strictly increasing', ['environmentRevisions'])
  }
})

const modeEventSchema = z.object({ version: z.literal(SCIENCE_EVENT_VERSION), mode: scienceModeSchema }).strict()
const environmentEventSchema = z.object({
  version: z.literal(SCIENCE_EVENT_VERSION),
  environment: environmentSchema,
}).strict()
const runStartedEventSchema = z.object({ version: z.literal(SCIENCE_EVENT_VERSION), run: runStartedSchema }).strict()
const runFinishedEventSchema = z.object({ version: z.literal(SCIENCE_EVENT_VERSION), run: runTerminalSchema }).strict()
const artifactSavedEventSchema = z.object({ version: z.literal(SCIENCE_EVENT_VERSION), artifact: artifactSchema }).strict()
const outcomePublishedEventSchema = z.object({
  version: z.literal(SCIENCE_EVENT_VERSION),
  outcome: outcomeSchema,
}).strict()
const kernelStateEventSchema = z.object({
  version: z.literal(SCIENCE_EVENT_VERSION),
  kernel: kernelStateSchema,
}).strict()

/** A Science event whose payload has passed the package's strict decoder. */
export type DecodedScienceDomainEvent =
  | { readonly type: 'science/mode-bound'; readonly seq: number; readonly time: number; readonly data: ScienceModeBoundEvent }
  | { readonly type: 'science/environment-bound'; readonly seq: number; readonly time: number; readonly data: ScienceEnvironmentBoundEvent }
  | { readonly type: 'science/run-started'; readonly seq: number; readonly time: number; readonly data: ScienceRunStartedEvent }
  | { readonly type: 'science/run-finished'; readonly seq: number; readonly time: number; readonly data: ScienceRunFinishedEvent }
  | { readonly type: 'science/artifact-saved'; readonly seq: number; readonly time: number; readonly data: ScienceArtifactSavedEvent }
  | { readonly type: 'science/outcome-published'; readonly seq: number; readonly time: number; readonly data: ScienceOutcomePublishedEvent }
  | { readonly type: 'science/kernel-state'; readonly seq: number; readonly time: number; readonly data: ScienceKernelStateEvent }

/**
 * Decode one mode binding value.
 * @param value - untrusted durable value.
 * @returns the strict Science mode value.
 */
export function decodeScienceMode(value: unknown): ScienceModeRef {
  return scienceModeSchema.parse(value)
}

/**
 * Decode one environment binding value.
 * @param value - untrusted durable value.
 * @returns the strict Science environment value.
 */
export function decodeScienceEnvironment(value: unknown): ScienceEnvironmentBinding {
  return environmentSchema.parse(value) as ScienceEnvironmentBinding
}

/**
 * Decode one run-start value.
 * @param value - untrusted durable value.
 * @returns the strict running-run value.
 */
export function decodeScienceRunStarted(value: unknown): ScienceRunStarted {
  return runStartedSchema.parse(value) as ScienceRunStarted
}

/**
 * Decode one run-terminal value.
 * @param value - untrusted durable value.
 * @returns the strict terminal-run value.
 */
export function decodeScienceRunTerminal(value: unknown): ScienceRunTerminal {
  return runTerminalSchema.parse(value) as ScienceRunTerminal
}

/**
 * Decode one artifact version value.
 * @param value - untrusted durable value.
 * @returns the strict artifact-version value.
 */
export function decodeScienceArtifact(value: unknown): ScienceArtifactVersion {
  rejectEmbeddedAttachmentArtifact(value)
  return artifactSchema.parse(value) as ScienceArtifactVersion
}

/**
 * Decode one outcome publication value.
 * @param value - untrusted durable value.
 * @returns the strict Outcome publication value.
 */
export function decodeScienceOutcome(value: unknown): ScienceOutcomePublication {
  return outcomeSchema.parse(value)
}

/**
 * Decode one kernel lifecycle transition value.
 * @param value - untrusted durable value.
 * @returns the strict kernel-state value.
 */
export function decodeScienceKernelState(value: unknown): ScienceKernelState {
  return kernelStateSchema.parse(value) as ScienceKernelState
}

/**
 * Test whether a string names one of the seven required Science event types.
 * @param type - Session event type to test.
 * @returns whether the type belongs to the Science domain.
 */
export function isScienceDomainEventType(type: string): type is ScienceDomainEventType {
  return type === 'science/mode-bound'
    || type === 'science/environment-bound'
    || type === 'science/run-started'
    || type === 'science/run-finished'
    || type === 'science/artifact-saved'
    || type === 'science/outcome-published'
    || type === 'science/kernel-state'
}

/**
 * Decode one Science event and ignore unrelated event types.
 * @param event - Session event from durable replay.
 * @returns the decoded Science event, or `undefined` for another domain.
 */
export function decodeScienceDomainEvent(event: SessionEvent): DecodedScienceDomainEvent | undefined {
  if (event.ignorable === true && isScienceDomainEventType(event.type)) {
    throw new Error('Science domain events must be required, not ignorable')
  }
  switch (event.type) {
    case 'science/mode-bound':
      return { type: event.type, seq: event.seq, time: event.time, data: modeEventSchema.parse(event.data) }
    case 'science/environment-bound': {
      const data = environmentEventSchema.parse(event.data) as ScienceEnvironmentBoundEvent
      return { type: event.type, seq: event.seq, time: event.time, data }
    }
    case 'science/run-started': {
      const data = runStartedEventSchema.parse(event.data) as ScienceRunStartedEvent
      return { type: event.type, seq: event.seq, time: event.time, data }
    }
    case 'science/run-finished': {
      const data = runFinishedEventSchema.parse(event.data) as ScienceRunFinishedEvent
      return { type: event.type, seq: event.seq, time: event.time, data }
    }
    case 'science/artifact-saved': {
      const candidate = event.data as { readonly artifact?: unknown } | null
      rejectEmbeddedAttachmentArtifact(candidate?.artifact)
      const data = artifactSavedEventSchema.parse(event.data) as ScienceArtifactSavedEvent
      return { type: event.type, seq: event.seq, time: event.time, data }
    }
    case 'science/outcome-published':
      return { type: event.type, seq: event.seq, time: event.time, data: outcomePublishedEventSchema.parse(event.data) }
    case 'science/kernel-state': {
      const data = kernelStateEventSchema.parse(event.data) as ScienceKernelStateEvent
      return { type: event.type, seq: event.seq, time: event.time, data }
    }
    default:
      if (event.type.startsWith('science/') && event.ignorable !== true) {
        throw new Error(`unsupported required Science event type ${JSON.stringify(event.type)}`)
      }
      return undefined
  }
}
