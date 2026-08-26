/** `run_python` and `run_r`: one fresh interpreter execution through `ctx.scienceRuntime`. */

import type { Context } from '@deepseek-ai/cordis'
import { formatBytes } from '@deepseek-ai/dsh-byte-size'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-science-runtime'
import type { ScienceRunResult } from '@deepseek-ai/dsh-science-runtime/types'
import { replayScience, ScienceArtifactId } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceArtifactMediaType,
  ScienceArtifactVersion,
  ScienceLanguage,
  ScienceProjection,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { closedKernelFacts, isScienceSession, modelKernelEndReason } from './context.ts'
import { requireDirectDispatch } from './guard.ts'
import { scienceArtifactPresentation } from './presentation.ts'
import type { ScienceArtifactPresentationItem } from './presentation.ts'

const outputStreamSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    truncated: { type: 'boolean', required: true },
  },
} as const

const artifactVersionRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    artifactId: { type: 'string', required: true },
    version: { type: 'integer', required: true },
  },
} as const

const runArtifactRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...artifactVersionRefSchema.properties,
    path: { type: 'string', required: true },
  },
} as const

const capturedArtifactSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    artifactId: { type: 'string', required: true },
    logicalName: { type: 'string', required: true },
    version: { type: 'integer', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    // `title` and the store version id are carried for `presentationMeta`
    // (below) to build a clickable Client reference per file; `render()`
    // deliberately omits both from the model-visible receipt text — `title`
    // duplicates `logicalName` for every auto-captured file (see capture.ts's
    // `basename` default), and versionId is an internal storage coordinate,
    // not a fact the model reasons about — the same split
    // `annotate_artifact`'s own receipt schema uses.
    title: { type: 'string', required: true },
    versionId: { type: 'string', required: true },
    parent: artifactVersionRefSchema,
  },
} as const

const runOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['success', 'failed', 'timed-out', 'cancelled'], required: true },
    // Present only when this is the first run on a kernel epoch that
    // followed an earlier one for this language — the one kernel fact the
    // model needs told: a fresh interpreter replaced the
    // one that held whatever state earlier runs left behind.
    kernelRestartReason: { type: 'string' },
    runId: { type: 'string', required: true },
    startedAt: { type: 'integer', required: true },
    finishedAt: { type: 'integer', required: true },
    failureCode: { type: 'string' },
    failureMessage: { type: 'string' },
    stdout: { ...outputStreamSchema, required: true },
    stderr: { ...outputStreamSchema, required: true },
    // Absent entirely for a non-quiescent settlement's async capture walk,
    // which has no synchronous result to attach to this call (see
    // ScienceRunResult.capture's own docstring); present (possibly with an
    // empty capturedArtifacts array) whenever capture ran synchronously.
    capturedArtifacts: { type: 'array', items: capturedArtifactSchema },
    captureSkippedOversizedCount: { type: 'integer' },
    captureTruncatedPerRun: { type: 'boolean' },
    captureTruncatedPerSession: { type: 'boolean' },
    // Undeclared `.png` paths this run wrote under SCIENCE_ARTIFACT_DIR but
    // that the 'declared' raster-capture policy left uncaptured — empty
    // under the 'always' policy, and absent (not an empty array) when
    // capture did not run synchronously, matching capturedArtifacts' own split.
    skippedRaster: { type: 'array', items: { type: 'string' } },
  },
} as const

/** Bounded structured value for a durably committed run terminal state. */
export type ScienceRunValue = InferValue<typeof runOutputSchema>

/**
 * Require the exact initiating Agent's live Session and its science-preset identity.
 * @param exec - tool execution identity carrying the optional initiating Agent.
 * @returns the initiating Agent's Session.
 */
export function requireScienceSession(exec: ToolExecution): Session {
  const session = exec.agent?.session
  if (session === undefined) throw new Error('tool-science: this tool requires an initiating Agent')
  if (!isScienceSession(session)) throw new Error('tool-science: this tool requires a session bound to the science preset')
  return session
}

/**
 * Find the latest `request/header` event required to authorize a direct Science mutation.
 * @param session - exact Session whose request history authorizes the mutation.
 * @returns the latest request-header sequence, or `undefined` when none exists.
 */
export function latestRequestHeaderSeq(session: Session): number | undefined {
  return session.events.findLast(event => event.type === 'request/header')?.seq
}

/** Reject empty or whitespace-only source before it reaches the Runtime. */
function nonEmptyCode(code: string): string {
  if (code.trim().length === 0) throw new Error('tool-science: code must be a non-empty string')
  return code
}

/** Flatten one captured artifact version into the run result's bounded listing entry. */
function capturedArtifactValue(artifact: ScienceArtifactVersion): InferValue<typeof capturedArtifactSchema> {
  return {
    artifactId: String(artifact.artifactId),
    logicalName: artifact.logicalName,
    version: artifact.version,
    mediaType: artifact.mediaType,
    bytes: artifact.byteCount,
    title: artifact.title,
    versionId: String(artifact.versionId),
    ...artifact.parent === undefined ? {} : {
      parent: { artifactId: String(artifact.parent.artifactId), version: artifact.parent.version },
    },
  }
}

/** Flatten one captured artifact's bounded listing entry into its Client presentation reference. */
function capturedArtifactPresentationItem(artifact: InferValue<typeof capturedArtifactSchema>): ScienceArtifactPresentationItem {
  return {
    artifactId: artifact.artifactId,
    logicalName: artifact.logicalName,
    version: artifact.version,
    title: artifact.title,
    content: {
      versionId: artifact.versionId,
      mediaType: artifact.mediaType as ScienceArtifactMediaType,
      byteCount: artifact.bytes,
    },
  }
}

/**
 * Flatten a Runtime result into the tool's bounded canonical value.
 * @param result - the durably committed run result from `ctx.scienceRuntime.startRun(...).done`.
 * @returns the bounded structured value the tool returns.
 */
export function runValueFromResult(result: ScienceRunResult): ScienceRunValue {
  const { terminal, capture } = result
  return {
    status: terminal.status,
    runId: String(terminal.runId),
    startedAt: terminal.startedAt,
    finishedAt: terminal.finishedAt,
    ...terminal.failureCode === undefined ? {} : { failureCode: terminal.failureCode },
    ...terminal.failureMessage === undefined ? {} : { failureMessage: terminal.failureMessage },
    stdout: result.stdout,
    stderr: result.stderr,
    ...capture === undefined ? {} : {
      capturedArtifacts: capture.captured.map(capturedArtifactValue),
      ...capture.skippedRasterPaths.length > 0 ? { skippedRaster: [...capture.skippedRasterPaths] } : {},
      ...capture.skippedOversizedCount > 0 ? { captureSkippedOversizedCount: capture.skippedOversizedCount } : {},
      ...capture.truncatedPerRun ? { captureTruncatedPerRun: true } : {},
      ...capture.truncatedPerSession ? { captureTruncatedPerSession: true } : {},
    },
  }
}

/**
 * Whether this run's terminal is the first one recorded under its own
 * kernel epoch for its language, following an earlier epoch for that same
 * language — the only case the model needs told: the kernel that ran this
 * source is not the one that ran earlier calls, so whatever those calls left
 * in memory is gone. Absent for every other run: one reusing the same
 * kernel as the previous call, or a language's very first kernel (nothing
 * earlier to have lost).
 * @param projection - the exact replayed Science projection, taken after this run's terminal committed.
 * @param terminal - this run's own durable terminal fact.
 * @returns the model-vocabulary end reason of the kernel this run replaced, or `undefined`.
 */
export function kernelRestartReason(projection: ScienceProjection, terminal: ScienceRunTerminal): string | undefined {
  const sameLanguageRuns = projection.runs.filter(run => run.language === terminal.language)
  const firstOfEpoch = sameLanguageRuns.find(run => run.kernelEpoch === terminal.kernelEpoch)
  if (firstOfEpoch === undefined || firstOfEpoch.runId !== terminal.runId) return undefined
  const priorKernel = projection.kernels
    .filter(kernel => kernel.language === terminal.language && kernel.kernelEpoch < terminal.kernelEpoch)
    .at(-1)
  if (priorKernel === undefined) return undefined
  const facts = closedKernelFacts(priorKernel)
  return facts === undefined ? undefined : modelKernelEndReason(facts.reason)
}

/**
 * Render one run result as plain text; failures stay inspectable, never
 * hidden. When capture ran synchronously and produced new versions, a
 * trailing listing names each — derived entirely from `value`'s own
 * `capturedArtifacts`/`captureSkipped*`/`captureTruncated*` fields, so it
 * cannot drift from the durable `science/artifact-saved` events those
 * fields describe.
 * @param value - the bounded run value to render.
 * @returns the rendered Native text.
 */
export function formatRunResult(value: ScienceRunValue): string {
  const header = [`status: ${value.status}`]
  const lines: string[] = []
  if (value.kernelRestartReason !== undefined) {
    lines.push(`kernel restarted (${value.kernelRestartReason}): variables from earlier runs are gone`)
  }
  lines.push(header.join(' '))
  if (value.failureCode !== undefined) lines.push(`failureCode: ${value.failureCode}`)
  if (value.failureMessage !== undefined) lines.push(`failureMessage: ${value.failureMessage}`)
  lines.push('--- stdout ---', value.stdout.text.length > 0 ? value.stdout.text : '(empty)')
  if (value.stdout.truncated) lines.push('(stdout truncated)')
  lines.push('--- stderr ---', value.stderr.text.length > 0 ? value.stderr.text : '(empty)')
  if (value.stderr.truncated) lines.push('(stderr truncated)')
  if (value.capturedArtifacts !== undefined && value.capturedArtifacts.length > 0) {
    const items = value.capturedArtifacts.map((artifact) => {
      const ancestry = artifact.parent === undefined
        ? ''
        : `, edited from ${artifact.parent.artifactId} v${String(artifact.parent.version)}`
      return `\`${artifact.logicalName}\` v${String(artifact.version)} (${artifact.artifactId}; ${artifact.mediaType}, ${formatBytes(artifact.bytes)}${ancestry})`
    })
    const noun = value.capturedArtifacts.length === 1 ? 'artifact' : 'artifacts'
    lines.push(`Captured ${String(value.capturedArtifacts.length)} ${noun}: ${items.join(', ')}.`)
  }
  if (value.skippedRaster !== undefined && value.skippedRaster.length > 0) {
    const noun = value.skippedRaster.length === 1 ? 'file' : 'files'
    lines.push(`(${String(value.skippedRaster.length)} PNG ${noun} not captured, not declared in raster_artifacts: ${value.skippedRaster.join(', ')})`)
  }
  if (value.captureSkippedOversizedCount !== undefined) {
    lines.push(`(${String(value.captureSkippedOversizedCount)} eligible file(s) skipped: too large to capture)`)
  }
  if (value.captureTruncatedPerRun === true) {
    lines.push('(more eligible files existed than this run\'s capture limit admits; the rest were not captured)')
  }
  if (value.captureTruncatedPerSession === true) {
    lines.push('(this session\'s artifact-capture limit was reached; further eligible files were not captured)')
  }
  return lines.join('\n')
}

/**
 * Register one persistent-kernel run tool for the given language.
 * @param ctx - plugin context; reads the optional `ctx.scienceRuntime` at call time.
 * @param language - `python` or `r`.
 */
export function applyRunTool(ctx: Context, language: ScienceLanguage): void {
  ctx.tools.register(defineTool({
    name: language === 'python' ? 'run_python' : 'run_r',
    description: language === 'python'
      ? 'Run Python source against this session\'s persistent Python kernel: variables, imports, and definitions stay in memory across calls until the kernel restarts. Materialize exact artifact versions under SCIENCE_INPUT_DIR with `artifact_inputs`; use `edit_of` to name the exact parent version for each output path being edited. The kernel restarts on an idle timeout, when the environment is re-bound to a new revision, after an interrupt escalation, on a crash, or when the session ends — each restart clears everything held in memory, and the next run result says so. `pip install` inside a run only affects the running kernel and is lost on restart; installing into the environment persists across kernels and is a separate operation. An exception is a result to inspect in stdout/stderr, not a tool failure.'
      : 'Run R source against this session\'s persistent R kernel: variables and loaded packages stay in memory across calls until the kernel restarts. Materialize exact artifact versions under SCIENCE_INPUT_DIR with `artifact_inputs`; use `edit_of` to name the exact parent version for each output path being edited. The kernel restarts on an idle timeout, when the environment is re-bound to a new revision, after an interrupt escalation, on a crash, or when the session ends — each restart clears everything held in memory, and the next run result says so. `install.packages()` inside a run only affects the running kernel and is lost on restart; installing into the environment persists across kernels and is a separate operation. An error condition is a result to inspect in stdout/stderr, not a tool failure.',
    parameters: {
      code: { type: 'string', required: true, description: 'Non-empty source to execute.' },
      artifact_inputs: {
        type: 'array',
        items: runArtifactRefSchema,
        description: 'Exact artifact versions to materialize below SCIENCE_INPUT_DIR. Each item is {artifactId, version, path}, where path is relative to SCIENCE_INPUT_DIR.',
      },
      edit_of: {
        type: 'array',
        items: runArtifactRefSchema,
        description: 'Exact parent versions for edited outputs. Each item is {artifactId, version, path}, where path is relative to SCIENCE_ARTIFACT_DIR and must be unique.',
      },
      raster_artifacts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relative paths (under SCIENCE_ARTIFACT_DIR) of PNG files this run writes that should become artifacts. PNG is for charts Vega-Lite cannot express; declare it here to capture it — otherwise a PNG this run writes is left uncaptured so an editable Vega-Lite chart stays the deliverable until export.',
      },
    },
    output: {
      schema: runOutputSchema,
      render: (_args, value) => [{ type: 'text', text: formatRunResult(value) }],
      presentationMeta: (_args, value) => scienceArtifactPresentation(
        (value.capturedArtifacts ?? []).map(capturedArtifactPresentationItem),
      ),
    },
    async execute(args, exec) {
      requireDirectDispatch(exec, language === 'python' ? 'run_python' : 'run_r')
      const session = requireScienceSession(exec)
      const scienceRuntime = ctx.get('scienceRuntime')
      if (scienceRuntime === undefined) {
        throw new Error('tool-science: no Science Runtime is mounted (ctx.scienceRuntime)')
      }
      const code = nonEmptyCode(args.code)
      const requestHeaderSeq = latestRequestHeaderSeq(session)
      if (requestHeaderSeq === undefined) {
        throw new Error('tool-science: no request/header is recorded for this session')
      }
      const editPaths = args.edit_of?.map(item => item.path)
      if (editPaths !== undefined && new Set(editPaths).size !== editPaths.length) {
        throw new Error('tool-science: edit_of paths must be unique')
      }
      const handle = await scienceRuntime.startRun({
        session,
        language,
        code,
        ...args.artifact_inputs === undefined ? {} : {
          artifactInputs: args.artifact_inputs.map(input => ({
            artifactId: ScienceArtifactId(input.artifactId), version: input.version, path: input.path,
          })),
        },
        ...args.edit_of === undefined ? {} : {
          editBaselines: Object.fromEntries(args.edit_of.map(edit => [
            edit.path,
            { artifactId: ScienceArtifactId(edit.artifactId), version: edit.version },
          ])),
        },
        ...args.raster_artifacts === undefined ? {} : { rasterArtifacts: args.raster_artifacts },
        toolCallId: exec.callId,
        requestHeaderSeq,
        signal: exec.signal,
      })
      const result = await handle.done
      const value = runValueFromResult(result)
      const projection = replayScience(session.events)
      /* v8 ignore next -- a run that just settled already required a bound mode; replay cannot be null here */
      const restartReason = projection === null ? undefined : kernelRestartReason(projection, result.terminal)
      return restartReason === undefined ? value : { ...value, kernelRestartReason: restartReason }
    },
  }))
}
