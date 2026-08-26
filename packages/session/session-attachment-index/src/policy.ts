/**
 * Exhaustive, single-owner attachment-reference policy for every currently
 * known Session event type (`@deepseek-ai/dsh-session`'s generated
 * `KNOWN_SESSION_EVENT_TYPES`). Every member is classified exactly once as
 * `built-in`, `attachment-free`, or implicitly `extractor-required` (any
 * known type absent from both closed lists below). This package needs no
 * dependency on a domain package to carry that classification: the type
 * strings themselves are already public through the repo-wide generated
 * type set, and `extractor-required` types authorize nothing until their
 * owning package calls `ctx.sessionAttachments.register()` at runtime.
 *
 * The freshness test in `tests/policy.spec.ts` compares this file's two
 * lists against the live `KNOWN_SESSION_EVENT_TYPES` set: adding a known
 * event type without updating one of these lists (or without the new type
 * ending up correctly `extractor-required`) fails that test.
 *
 * @module @deepseek-ai/dsh-session-attachment-index/policy
 */

/**
 * Session event types whose model-visible content carriers this package
 * scans directly: direct `content`, a wrapped `message.content`, every
 * `inserted[].content` message, and a completed `assistant/chunk` block —
 * the same carriers the durable log always projects to model-visible
 * history, regardless of which domain produced the event.
 */
export const BUILT_IN_CARRIER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent/inbox/spliced',
  'assistant/chunk',
  'assistant/message',
  'tool/result',
  'user/message',
])

/**
 * Session event types known today that never carry an attachment reference.
 * Closed by hand (not derived as "everything left over") so that adding a
 * new known type without deliberately classifying it here — or registering
 * an extractor for it — is caught by the freshness test instead of silently
 * authorizing nothing forever.
 *
 * TODO(attachment-index-buckets): membership here is unasserted. The freshness
 * test proves every known type appears in exactly one list, never that the
 * chosen list is right, so a type whose payload can structurally carry
 * `{ type: 'image', attachment }` may sit here and silently authorize nothing.
 * `tool/code-dispatch` is the live example: its `content` is the sub-call's
 * full model-facing outcome (`ContentBlock[]`), which the deleted upstream
 * shape-driven scan would have reached. No route produces such an event today
 * — code mode defers image-bearing content to `agent/inbox/spliced`, MCP error
 * results degrade images to text, and `post-execute` strips them — so the
 * consequence would be a broken image plus an omission from Session ZIP
 * export, with no test turning red.
 */
export const ATTACHMENT_FREE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent-preset/selected',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'command/done',
  'command/run',
  'compaction/end',
  'compaction/prune',
  'compaction/start',
  'compaction/summary',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'llm/retry',
  'llm/retry-started',
  'permission/preset',
  'plan/mode',
  'request/context',
  'request/header',
  'sandbox/mode',
  'schedule/change',
  'science/artifact-saved',
  'science/environment-bound',
  'science/kernel-state',
  'science/mode-bound',
  'science/outcome-published',
  'science/run-finished',
  'science/run-started',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'step/end',
  'step/start',
  'subagent/descriptor',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'tool/call',
  'tool/code-dispatch',
  'tool/code-dispatch-start',
  'turn/end',
  'turn/start',
  'web/deepseek-search-llm-request',
])

/**
 * Static classification for one event type, or `undefined` when the type is
 * neither built-in nor closed attachment-free — meaning it is either
 * extractor-required (a live registration decides) or entirely unrecognized
 * by this build.
 * @param eventType - a Session event's `type` field.
 * @returns the static policy bucket, or `undefined` for the dynamic case.
 */
export function staticAttachmentPolicy(eventType: string): 'built-in' | 'attachment-free' | undefined {
  if (BUILT_IN_CARRIER_EVENT_TYPES.has(eventType)) return 'built-in'
  if (ATTACHMENT_FREE_EVENT_TYPES.has(eventType)) return 'attachment-free'
  return undefined
}
