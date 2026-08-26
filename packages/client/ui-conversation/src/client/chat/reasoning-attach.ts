/**
 * Reasoning-attach: an `assistant-step` Chat Node whose only visible content
 * is reasoning (no text, image, or other block — a `tool-call` placeholder
 * block does not count as visible) never renders as its own flow row. Its
 * reasoning text folds onto the immediately following flow key instead: a
 * Tool-call successor absorbs it as a leading Think disclosure rendered by
 * `ChatNodeSeat` before that step's own card; an `assistant-step` successor
 * carrying real prose absorbs it as synthesized leading `reasoning` blocks,
 * rendered through `AssistantMarkdown`'s existing Think summary row — no
 * third Think presentation. Several adjacent pure-reasoning keys fold onto
 * the same successor, concatenated in flow order. A pure-reasoning key with
 * no attachable successor yet — streaming, the turn ended before one
 * arrived, or the next key is a kind this module does not fold onto (a new
 * user message, a completion summary, …) — keeps today's standalone Think
 * row: it stays in the rewritten order unchanged, so no reasoning text is
 * ever silently dropped. Purely a Chat-node-kind view transform: no session
 * event, no model-visible change; the fold recomputes from `order` and the
 * Chat Node store on every relevant Session update.
 */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeKind } from '../contract/chat-nodes.ts'
import type { AssistantChatData } from '../contract/chat-nodes.ts'

/**
 * Node kinds an attached reasoning fold renders onto. `nodeOf` resolves the
 * generic Chat Node store, whose declared value type is the merge-extensible
 * `ChatConversationViewNode` (not the registered-kind union `ChatNode`) —
 * every registered kind narrows through it structurally instead.
 */
const ATTACHABLE_SUCCESSOR_KINDS: ReadonlySet<string> = new Set<ChatNodeKind>(['tool-call', 'assistant-step'])

/** True when a Node kind this module folds a pure-reasoning predecessor onto. */
function isAttachableSuccessor(node: ChatConversationViewNode | undefined): boolean {
  return node !== undefined && ATTACHABLE_SUCCESSOR_KINDS.has(node.kind)
}

/**
 * True when an `assistant-step` Node's only visible content is reasoning
 * text — no non-empty `text`/`image`/`other` block. A `tool-call`
 * placeholder block never counts as visible either way, matching
 * `hasVisibleContent` in `conversation-nodes/assistant.ts`.
 * @param node - the candidate Chat Node.
 * @returns whether this Node is a pure-reasoning step.
 */
function isPureReasoningNode(node: ChatConversationViewNode | undefined): node is ChatConversationViewNode & { data: AssistantChatData } {
  if (node === undefined || node.kind !== 'assistant-step') return false
  const blocks = (node.data as AssistantChatData).blocks
  const hasReasoning = blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')
  const hasOtherVisible = blocks.some((block) => {
    if (block.kind === 'reasoning' || block.kind === 'tool-call') return false
    if (block.kind === 'text') return block.text.trim() !== ''
    return true
  })
  return hasReasoning && !hasOtherVisible
}

/** Concatenated reasoning text off a pure-reasoning Node's blocks, in block order. */
function reasoningText(node: ChatConversationViewNode & { data: AssistantChatData }): string {
  return node.data.blocks
    .filter((block): block is Extract<(typeof node.data.blocks)[number], { kind: 'reasoning' }> => block.kind === 'reasoning')
    .map(block => block.text)
    .join('\n\n')
}

/** Return value of {@link attachReasoningNodes}: the rewritten flow order plus each successor's attached reasoning. */
export interface ReasoningAttachResult {
  /** Flow order with folded pure-reasoning keys removed; unfoldable ones stay in place. */
  readonly order: readonly string[]
  /** Successor key -> its attached reasoning texts, oldest first. */
  readonly reasoningByKey: ReadonlyMap<string, readonly string[]>
}

/**
 * Fold each pure-reasoning `assistant-step` key into its immediately
 * following attachable flow key.
 * @param order - the Session's current rendered Node key order.
 * @param nodeOf - resolve one key's current Chat Node (absent for a key not
 *   yet materialized).
 * @returns the rewritten order and the per-successor attached reasoning texts.
 */
export function attachReasoningNodes(
  order: readonly string[],
  nodeOf: (key: string) => ChatConversationViewNode | undefined,
): ReasoningAttachResult {
  const rewritten: string[] = []
  const reasoningByKey = new Map<string, readonly string[]>()
  let pending: { key: string; node: ChatConversationViewNode & { data: AssistantChatData } }[] = []
  for (const key of order) {
    const node = nodeOf(key)
    if (isPureReasoningNode(node)) {
      pending.push({ key, node })
      continue
    }
    if (pending.length > 0 && isAttachableSuccessor(node)) {
      reasoningByKey.set(key, pending.map(entry => reasoningText(entry.node)))
    } else {
      // No pending reasoning, or the next key does not accept an attached
      // fold: any buffered keys stay in the flow as their own standalone rows.
      rewritten.push(...pending.map(entry => entry.key))
    }
    pending = []
    rewritten.push(key)
  }
  // Trailing pure-reasoning keys with no successor yet (streaming, or the
  // turn ended before one arrived): keep them as standalone rows.
  rewritten.push(...pending.map(entry => entry.key))
  return { order: rewritten, reasoningByKey }
}
