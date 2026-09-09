/** `install_science_packages`: persist packages into this session's bound environment through `ctx.scienceRuntime`. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-science-runtime'
import type { InstallScienceEnvironmentPackagesResult } from '@deepseek-ai/dsh-science-runtime/types'
import { requireDirectDispatch } from './guard.ts'
import { requireScienceSession } from './run.ts'

const outputStreamSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    truncated: { type: 'boolean', required: true },
  },
} as const

const installOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['success', 'failed', 'timed-out', 'cancelled'], required: true },
    // Present iff status === 'success': the environment as it now stands —
    // fresh only when environmentChanged is true; a redundant install
    // (every requested package already present) reports the unchanged
    // current revision instead. Packages are not repeated here;
    // get_science_state already reports the current environment's full
    // package inventory per language.
    environmentRevision: { type: 'integer' },
    // Always present: whether this call appended environmentRevision as a
    // fresh revision (always false for a non-success status, since nothing
    // durable changed).
    environmentChanged: { type: 'boolean', required: true },
    stdout: { ...outputStreamSchema, required: true },
    stderr: { ...outputStreamSchema, required: true },
  },
} as const

/** Bounded structured value for one settled install attempt. */
export type ScienceInstallValue = InferValue<typeof installOutputSchema>

/**
 * Flatten a Runtime result into the tool's bounded canonical value.
 * @param result - the result from `ctx.scienceRuntime.installPackages(...)`.
 * @returns the bounded structured value the tool returns.
 */
export function installValueFromResult(result: InstallScienceEnvironmentPackagesResult): ScienceInstallValue {
  return {
    status: result.status,
    ...result.environment === undefined ? {} : { environmentRevision: result.environment.revision },
    environmentChanged: result.environmentChanged === true,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

/**
 * Render one install result as plain text; failures stay inspectable, never hidden.
 * @param value - the bounded install value to render.
 * @returns the rendered Native text.
 */
export function formatInstallResult(value: ScienceInstallValue): string {
  const lines = [`status: ${value.status}`]
  if (value.environmentRevision !== undefined) {
    lines.push(value.environmentChanged
      ? `environment revision ${String(value.environmentRevision)} applied — this takes effect on the next run_python/run_r call for this language, not now: that call restarts the kernel (an environment re-bind) and every variable, import, and definition it currently holds in memory is lost then`
      : `environment revision ${String(value.environmentRevision)} unchanged — every requested package was already present, so no revision was appended and no kernel restarts because of this call`)
  }
  if (value.status === 'failed') {
    lines.push('the environment is unchanged; try a different package name or version spec — do not fall back to pip/install.packages(), which is lost on the next kernel restart')
  }
  if (value.status === 'timed-out') {
    lines.push('the installer was stopped at its deadline before confirming completion — the environment may be partially or fully written; check get_science_state or try importing the package before deciding whether to retry, and retry at most once')
  }
  lines.push('--- stdout ---', value.stdout.text.length > 0 ? value.stdout.text : '(empty)')
  if (value.stdout.truncated) lines.push('(stdout truncated)')
  lines.push('--- stderr ---', value.stderr.text.length > 0 ? value.stderr.text : '(empty)')
  if (value.stderr.truncated) lines.push('(stderr truncated)')
  return lines.join('\n')
}

/**
 * Register `install_science_packages`.
 * @param ctx - plugin context; reads the optional `ctx.scienceRuntime` at call time.
 */
export function applyInstallPackagesTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'install_science_packages',
    description: 'Install one or more packages into this session\'s bound Python or R environment through conda-forge, persisting them across kernel restarts — unlike an in-kernel `pip install`/`install.packages()`, which is lost on restart. Package specs use conda syntax, e.g. "numpy" or "numpy=1.26"; R packages install as prebuilt conda-forge binaries, so no local compiler toolchain is required. On success the affected language\'s current kernel restarts on its next run_python/run_r call (an environment re-bind — the same event a run result already names), clearing whatever that kernel held in memory; nothing durable changes on failure.',
    parameters: {
      language: { type: 'string', required: true, enum: ['python', 'r'], description: 'Interpreter whose environment receives the install.' },
      packages: {
        type: 'array', required: true, items: { type: 'string' },
        description: 'One or more conda-forge package specs, e.g. "numpy" or "numpy=1.26".',
      },
    },
    output: {
      schema: installOutputSchema,
      render: (_args, value) => [{ type: 'text', text: formatInstallResult(value) }],
    },
    async execute(args, exec) {
      requireDirectDispatch(exec, 'install_science_packages')
      const session = requireScienceSession(exec)
      const scienceRuntime = ctx.get('scienceRuntime')
      if (scienceRuntime === undefined) {
        throw new Error('tool-science: no Science Runtime is mounted (ctx.scienceRuntime)')
      }
      const result = await scienceRuntime.installPackages({
        session,
        language: args.language,
        packages: args.packages,
        signal: exec.signal,
      })
      return installValueFromResult(result)
    },
  }))
}
