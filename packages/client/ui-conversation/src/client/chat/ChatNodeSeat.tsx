import { memo, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import css from './ChatView.module.css'

const EMPTY_REASONING: readonly string[] = []

interface ChatNodeSeatProps extends Omit<ChatNodeOwnerProps, 'attachedReasoning'> {
  readonly nodeKey: string
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
  /**
   * This key's own attached reasoning texts (`reasoning-attach.ts`),
   * resolved by the caller — never the whole `reasoningByKey` lookup Map,
   * whose object identity changes on every unrelated flow edit (a new
   * streaming partial's synthetic key, another Node settling). Passing the
   * already-resolved slice keeps this value referentially stable across
   * renders that do not touch this key, preserving `memo`'s bail-out for a
   * sibling row untouched by the fold.
   */
  readonly attachedReasoning: readonly string[] | undefined
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt,
  renderMessageImages, fileMentions, openDetailsView, loadImage, useSession, renderSlot, t, attachedReasoning: attachedReasoningProp,
}: ChatNodeSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const routedNode = node as ChatNode | undefined
  const attachedReasoning = attachedReasoningProp ?? EMPTY_REASONING
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      renderMessageImages,
      fileMentions,
      openDetailsView,
      loadImage,
      attachedReasoning,
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt, renderMessageImages, fileMentions, openDetailsView,
    loadImage, attachedReasoning,
  ])
  if (routedNode === undefined || owner === null) return null
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
    >
      {/*
        A tool-call Node's own toolview (ui-tool's generic card, or a
        domain package's registered replacement) never imports Think
        presentation itself — cross-plugin value imports fail the client
        bundle purity gate. ChatNodeSeat renders the same Think disclosure
        AssistantMarkdown uses for a prose successor, as a leading sibling
        ahead of that Node's own card, so a run_python/run_r row or any
        other tool-call gets the fold with zero toolview-side changes.
      */}
      {routedNode.kind === 'tool-call' && attachedReasoning.length > 0 && (
        <ReasoningRow text={attachedReasoning.join('\n\n')} running={false} t={t} />
      )}
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
