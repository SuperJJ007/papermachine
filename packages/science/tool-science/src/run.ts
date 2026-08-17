/** `run_python` and `run_r`: one fresh interpreter execution through `ctx.scienceRuntime`. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-science-runtime'
import type { ScienceRunResult } from '@deepseek-ai/dsh-science-runtime/types'
import type { ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { isScienceSession } from './context.ts'
import { requireDirectDispatch } from './guard.ts'

const outputStreamSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    truncated: { type: 'boolean', required: true },
  },
} as const

const runOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['success', 'failed', 'timed-out', 'cancelled'], required: true },
    runId: { type: 'string', required: true },
    startedAt: { type: 'integer', required: true },
    finishedAt: { type: 'integer', required: true },
    exitCode: { type: 'integer' },
    signal: { type: 'string' },
    failureCode: { type: 'string' },
    failureMessage: { type: 'string' },
    stdout: { ...outputStreamSchema, required: true },
    stderr: { ...outputStreamSchema, required: true },
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

/**
 * Flatten a Runtime result into the tool's bounded canonical value.
 * @param result - the durably committed run result from `ctx.scienceRuntime.startRun(...).done`.
 * @returns the bounded structured value the tool returns.
 */
export function runValueFromResult(result: ScienceRunResult): ScienceRunValue {
  const { terminal } = result
  return {
    status: terminal.status,
    runId: String(terminal.runId),
    startedAt: terminal.startedAt,
    finishedAt: terminal.finishedAt,
    ...terminal.exitCode === undefined ? {} : { exitCode: terminal.exitCode },
    ...terminal.signal === undefined ? {} : { signal: terminal.signal },
    ...terminal.failureCode === undefined ? {} : { failureCode: terminal.failureCode },
    ...terminal.failureMessage === undefined ? {} : { failureMessage: terminal.failureMessage },
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

/**
 * Render one run result as plain text; failures stay inspectable, never hidden.
 * @param value - the bounded run value to render.
 * @returns the rendered Native text.
 */
export function formatRunResult(value: ScienceRunValue): string {
  const header = [`status: ${value.status}`]
  if (value.exitCode !== undefined) header.push(`exit ${String(value.exitCode)}`)
  if (value.signal !== undefined) header.push(`signal ${value.signal}`)
  const lines = [header.join(' ')]
  if (value.failureCode !== undefined) lines.push(`failureCode: ${value.failureCode}`)
  if (value.failureMessage !== undefined) lines.push(`failureMessage: ${value.failureMessage}`)
  lines.push('--- stdout ---', value.stdout.text.length > 0 ? value.stdout.text : '(empty)')
  if (value.stdout.truncated) lines.push('(stdout truncated)')
  lines.push('--- stderr ---', value.stderr.text.length > 0 ? value.stderr.text : '(empty)')
  if (value.stderr.truncated) lines.push('(stderr truncated)')
  return lines.join('\n')
}

/**
 * Register one fresh-process run tool for the given language.
 * @param ctx - plugin context; reads the optional `ctx.scienceRuntime` at call time.
 * @param language - `python` or `r`.
 */
export function applyRunTool(ctx: Context, language: ScienceLanguage): void {
  ctx.tools.register(defineTool({
    name: language === 'python' ? 'run_python' : 'run_r',
    description: language === 'python'
      ? 'Run Python source in a fresh interpreter process bound to the session\'s Science environment. Each call starts a new process; nothing persists in memory between calls. A non-zero exit or exception is a result to inspect in stdout/stderr, not a tool failure.'
      : 'Run R source in a fresh Rscript process bound to the session\'s Science environment. Each call starts a new process; nothing persists in memory between calls. A non-zero exit or condition is a result to inspect in stdout/stderr, not a tool failure.',
    parameters: {
      code: { type: 'string', required: true, description: 'Non-empty source to execute.' },
    },
    output: {
      schema: runOutputSchema,
      render: (_args, value) => [{ type: 'text', text: formatRunResult(value) }],
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
      const handle = await scienceRuntime.startRun({
        session,
        language,
        code,
        toolCallId: exec.callId,
        requestHeaderSeq,
        signal: exec.signal,
      })
      const result = await handle.done
      return runValueFromResult(result)
    },
  }))
}
