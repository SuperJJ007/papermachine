/**
 * Model-facing Science mode Consumer: first-use mode/environment binding, the
 * `science:environment` dynamic context, and five Science tools. It never spawns a process, writes run
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
import { applyInstallPackagesTool } from './install.ts'
import { applyRunTool } from './run.ts'
import { applyScienceStateTool } from './state.ts'

export { Config }
export type * from './types.ts'
export {
  createScienceEditMessage,
  resolveScienceEdit,
  ScienceEditError,
  ScienceEditService,
  renderScienceEditMessage,
} from './edit-message.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-science'

/** Statically injects only registration services; `ctx.scienceRuntime` is read optionally at call time. */
export const inject = ['tools', 'systemPrompt']

const STATIC_GUIDANCE = [
  'Use run_python or run_r to execute source in the session\'s bound Science environment.',
  'Each language has one persistent kernel per session: variables, imports, and definitions stay in memory across calls to that language\'s run tool until the kernel restarts (idle timeout, environment re-bind, interrupt escalation, crash, or session end). A run result names the reason right after a restart.',
  'Store anything that must survive a kernel restart under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR; artifact_inputs materialize under SCIENCE_INPUT_DIR.',
  'The current directory is a private scratch directory that is not captured; write outputs under SCIENCE_ARTIFACT_DIR, and access workspace files through SCIENCE_WORKSPACE_DIR or an absolute path.',
  'When modifying or regenerating an existing artifact, reference its exact version through edit_of for a direct edit or artifact_inputs for an input, and write the output to the same relative path under SCIENCE_ARTIFACT_DIR so automatic capture appends the existing version chain. artifactId is the UUID printed in the capture receipt and by get_science_state, never the file name.',
  'A terminal program failure (exception, error condition, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction.',
  'A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed.',
  'Use get_science_state to read the current mode, environment, kernel state, and run history without starting a run.',
  'Make charts with matplotlib (Python) or ggplot2 (R), save each one as a PNG under SCIENCE_ARTIFACT_DIR, and name it in raster_artifacts so it is captured. Do not use Altair or Vega-Lite.',
  'Save matplotlib figures with fig.savefig()/plt.savefig() and ggplot2 charts with ggsave(); figures saved that way stay addressable for direct edits in the viewer.',
  'A run\'s eligible written files (csv/json/md/txt under SCIENCE_ARTIFACT_DIR) are durably captured automatically as versioned artifacts, and a PNG only when named in raster_artifacts; no separate save step is needed otherwise. If a result says a PNG was not captured, rerun the code that writes it and declare the same path in raster_artifacts. Use annotate_artifact to give the artifact that best demonstrates your result a human-readable title and optional caption, so it is highlighted for the reader.',
  'Write a render, preview, or debug dump meant only for your own inspection outside SCIENCE_ARTIFACT_DIR (for example a temp directory), never into it, so it is never captured as an artifact.',
  'Do not open a new artifact version to reconcile a cosmetic difference the user did not ask for; mention the difference in your reply instead.',
  'Use install_science_packages to persist a package into the bound environment across kernel restarts; an in-kernel pip install/install.packages() only lasts until the current kernel restarts.',
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
  applyInstallPackagesTool(ctx)
}
