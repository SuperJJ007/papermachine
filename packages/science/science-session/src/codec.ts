/** Strict decoders for the durable Science event vocabulary. */

import { Buffer } from 'node:buffer'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import {
  SCIENCE_EVENT_VERSION,
  ScienceChartId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from './ids.ts'
import type {
  ScienceChartSavedEvent,
  ScienceDomainEventType,
  ScienceEnvironmentBoundEvent,
  ScienceModeBoundEvent,
  ScienceOutcomePublishedEvent,
  ScienceRunFinishedEvent,
  ScienceRunStartedEvent,
} from './domain.ts'
import type {
  ScienceChartVersion,
  ScienceEnvironmentBinding,
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
  presetId: z.literal('science'),
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
} as const

const runStartedSchema = z.object({
  ...runIdentityShape,
  status: z.literal('running'),
}).strict().superRefine((run, ctx) => {
  if (run.runDirectoryRef !== `runs/${run.runId}/`) {
    issue(ctx, 'runDirectoryRef must be the canonical session-relative run path', ['runDirectoryRef'])
  }
})

const runTerminalSchema = z.object({
  ...runIdentityShape,
  status: z.enum(['success', 'failed', 'timed-out', 'cancelled']),
  finishedAt: SAFE_INTEGER,
  exitCode: z.number().int().min(-2147483648).max(2147483647).optional(),
  signal: text(MAX_LABEL_LENGTH).optional(),
  stdoutBytes: SAFE_INTEGER,
  stderrBytes: SAFE_INTEGER,
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/).max(MAX_ID_LENGTH).optional(),
  failureMessage: text(MAX_REASON_LENGTH).optional(),
}).strict().superRefine((run, ctx) => {
  if (run.runDirectoryRef !== `runs/${run.runId}/`) {
    issue(ctx, 'runDirectoryRef must be the canonical session-relative run path', ['runDirectoryRef'])
  }
  if (run.finishedAt < run.startedAt) issue(ctx, 'finishedAt cannot precede startedAt', ['finishedAt'])
  if (run.status === 'success') {
    if (run.exitCode !== 0) issue(ctx, 'a successful run requires exitCode 0', ['exitCode'])
    if (run.signal !== undefined || run.failureCode !== undefined || run.failureMessage !== undefined) {
      issue(ctx, 'a successful run cannot carry failure facts')
    }
  } else if (run.failureCode === undefined) {
    issue(ctx, 'a non-success run requires failureCode', ['failureCode'])
  }
})

const attachmentSchema = z.object({
  attachmentId: text(MAX_ID_LENGTH).transform(value => AttachmentId(value)),
  mediaType: z.literal('image/png'),
  bytes: POSITIVE_INTEGER,
  width: POSITIVE_INTEGER,
  height: POSITIVE_INTEGER,
  name: text(MAX_LABEL_LENGTH).refine(value => !/[\\/]/.test(value), {
    message: 'attachment name must not contain a path separator',
  }).optional(),
}).strict()

const chartSchema = z.object({
  chartId: SAFE_ID.transform(value => ScienceChartId(value)),
  logicalName: SAFE_ID,
  version: POSITIVE_INTEGER,
  title: text(MAX_LABEL_LENGTH),
  caption: text(MAX_REASON_LENGTH).optional(),
  attachment: attachmentSchema,
  runId: SAFE_ID.transform(value => ScienceRunId(value)),
  toolCallId: text(MAX_ID_LENGTH).transform(value => CallId(value)),
  requestHeaderSeq: SAFE_INTEGER,
  environmentRevision: POSITIVE_INTEGER,
  environmentFingerprint: SHA256,
  createdAt: SAFE_INTEGER,
}).strict()

const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run'), runId: SAFE_ID.transform(value => ScienceRunId(value)) }).strict(),
  z.object({
    kind: z.literal('chart'),
    chartId: SAFE_ID.transform(value => ScienceChartId(value)),
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
const chartSavedEventSchema = z.object({ version: z.literal(SCIENCE_EVENT_VERSION), chart: chartSchema }).strict()
const outcomePublishedEventSchema = z.object({
  version: z.literal(SCIENCE_EVENT_VERSION),
  outcome: outcomeSchema,
}).strict()

/** A Science event whose payload has passed the package's strict decoder. */
export type DecodedScienceDomainEvent =
  | { readonly type: 'science/mode-bound'; readonly seq: number; readonly time: number; readonly data: ScienceModeBoundEvent }
  | { readonly type: 'science/environment-bound'; readonly seq: number; readonly time: number; readonly data: ScienceEnvironmentBoundEvent }
  | { readonly type: 'science/run-started'; readonly seq: number; readonly time: number; readonly data: ScienceRunStartedEvent }
  | { readonly type: 'science/run-finished'; readonly seq: number; readonly time: number; readonly data: ScienceRunFinishedEvent }
  | { readonly type: 'science/chart-saved'; readonly seq: number; readonly time: number; readonly data: ScienceChartSavedEvent }
  | { readonly type: 'science/outcome-published'; readonly seq: number; readonly time: number; readonly data: ScienceOutcomePublishedEvent }

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
  return runStartedSchema.parse(value)
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
 * Decode one chart version value.
 * @param value - untrusted durable value.
 * @returns the strict chart-version value.
 */
export function decodeScienceChart(value: unknown): ScienceChartVersion {
  return chartSchema.parse(value) as ScienceChartVersion
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
 * Test whether a string names one of the six required Science event types.
 * @param type - Session event type to test.
 * @returns whether the type belongs to the Science domain.
 */
export function isScienceDomainEventType(type: string): type is ScienceDomainEventType {
  return type === 'science/mode-bound'
    || type === 'science/environment-bound'
    || type === 'science/run-started'
    || type === 'science/run-finished'
    || type === 'science/chart-saved'
    || type === 'science/outcome-published'
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
    case 'science/run-started':
      return { type: event.type, seq: event.seq, time: event.time, data: runStartedEventSchema.parse(event.data) }
    case 'science/run-finished': {
      const data = runFinishedEventSchema.parse(event.data) as ScienceRunFinishedEvent
      return { type: event.type, seq: event.seq, time: event.time, data }
    }
    case 'science/chart-saved':
      return { type: event.type, seq: event.seq, time: event.time, data: chartSavedEventSchema.parse(event.data) as ScienceChartSavedEvent }
    case 'science/outcome-published':
      return { type: event.type, seq: event.seq, time: event.time, data: outcomePublishedEventSchema.parse(event.data) }
    default:
      if (event.type.startsWith('science/') && event.ignorable !== true) {
        throw new Error(`unsupported required Science event type ${JSON.stringify(event.type)}`)
      }
      return undefined
  }
}
