/**
 * Model-facing Science mode Consumer: first-use mode/environment binding, the
 * `science:environment` dynamic context, and the `get_science_state`,
 * `run_python`, and `run_r` tools. It never spawns a process, writes run
 * source, classifies termination, manages Conda, or appends Runtime-owned
 * events — those remain owned by `@deepseek-ai/dsh-science-runtime`, called
 * through the optional `ctx.scienceRuntime` service.
 * @module @deepseek-ai/dsh-tool-science
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-science-runtime'
import { applyScienceContext } from './context.ts'
import { Config, resolveConfig } from './config.ts'
import { applyRunTool } from './run.ts'
import { applyScienceStateTool } from './state.ts'

export { Config }

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-science'

/** Statically injects only registration services; `ctx.scienceRuntime` is read optionally at call time. */
export const inject = ['tools', 'systemPrompt']

const STATIC_GUIDANCE = [
  'Use run_python or run_r to execute source in the session\'s bound Science environment.',
  'Each call starts a fresh interpreter process; no in-memory state survives between calls.',
  'Store anything that must survive between calls under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR.',
  'A terminal program failure (non-zero exit, exception, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction.',
  'A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed.',
  'Use get_science_state to read the current mode, environment, and run history without starting a process.',
].join(' ')

/** Register the Science Consumer's prompt, context, and tool contributions. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({ name: 'tool:science', order: 110, text: STATIC_GUIDANCE })
  applyScienceContext(ctx, resolved)
  applyScienceStateTool(ctx)
  applyRunTool(ctx, 'python')
  applyRunTool(ctx, 'r')
}
