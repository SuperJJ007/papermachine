/** Shared direct-dispatch guard for every Science tool that mutates durable Science state. */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * Reject a nested Code Mode sub-dispatch before Runtime lookup, filesystem
 * work, or a Session append. `run_python`, `run_r`, `annotate_artifact`, and
 * `publish_outcome` all durably require the direct `tool/call` provenance
 * every R1 Science transition checks; a nested dispatch instead logs
 * `tool/code-dispatch*` and core tools omit `presentationMeta` for nested
 * results, so letting a mutation reach the Runtime or an append under
 * `exec.parent !== undefined` would only fail late, after a side effect
 * already ran. The shipped Science preset never mounts Code Mode, so this
 * never fires in the shipped composition; it protects a different
 * composition that does.
 * @param exec - the pending tool execution.
 * @param toolName - the tool's own name, for the rejection message.
 * @throws when `exec.parent` is set (a nested sub-dispatch).
 */
export function requireDirectDispatch(exec: Pick<ToolExecution, 'parent'>, toolName: string): void {
  if (exec.parent !== undefined) {
    throw new Error(`tool-science: ${toolName} cannot run as a nested Code Mode sub-dispatch; call it directly`)
  }
}
