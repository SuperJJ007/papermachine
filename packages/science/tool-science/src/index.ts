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
import { applyAnnotateArtifactTool } from './annotate-artifact.ts'
import { applyScienceContext } from './context.ts'
import { Config, resolveConfig } from './config.ts'
import { applyPublishOutcomeTool } from './publish-outcome.ts'
import { applyRunTool } from './run.ts'
import { applyScienceStateTool } from './state.ts'

export { Config }

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-science'

/** Statically injects only registration services; `ctx.scienceRuntime` is read optionally at call time. */
export const inject = ['tools', 'systemPrompt']

const STATIC_GUIDANCE = [
  'Use run_python or run_r to execute source in the session\'s bound Science environment.',
  'Each language has one persistent kernel per session: variables, imports, and definitions stay in memory across calls to that language\'s run tool until the kernel restarts (idle timeout, environment re-bind, interrupt escalation, crash, or session end). A run result names the reason right after a restart.',
  'Store anything that must survive a kernel restart under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR; artifact_inputs materialize under SCIENCE_INPUT_DIR.',
  'A terminal program failure (exception, error condition, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction.',
  'A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed.',
  'Use get_science_state to read the current mode, environment, kernel state, and run history without starting a run.',
  'A run\'s eligible written files (csv/json/md/png/txt under SCIENCE_ARTIFACT_DIR) are durably captured automatically as versioned artifacts; no separate save step is needed. Use annotate_artifact to give the artifact that best demonstrates your result a human-readable title and optional caption, so it is highlighted for the reader.',
  'Use publish_outcome to publish the current result as a titled, cited Outcome revision once evidence (successful runs, saved artifact versions, and/or prior messages) supports it.',
].join(' ')

/** Register the Science Consumer's prompt, context, and tool contributions. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({ name: 'tool:science', order: 110, text: STATIC_GUIDANCE })
  applyScienceContext(ctx, resolved)
  applyScienceStateTool(ctx, resolved.stateHistoryLimit)
  applyRunTool(ctx, 'python')
  applyRunTool(ctx, 'r')
  applyAnnotateArtifactTool(ctx)
  applyPublishOutcomeTool(ctx)
}
