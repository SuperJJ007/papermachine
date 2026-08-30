import type { Context } from '@deepseek-ai/cordis'
import type {
  ContextMessageNode, ConversationNodeDefinition, ConversationUserInput, SteeringMessageNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  contextForm, contextProvenance, isAppendSurfaceEvent, isReplacementSurfaceEvent,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { InboxState } from './inbox.ts'
import { chatNode } from './common.ts'

interface ReferencedUserMessageNode extends UserMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
}

interface ReferencedSteeringMessageNode extends SteeringMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
}

type MessageNode = ReferencedUserMessageNode | ReferencedSteeringMessageNode | ContextMessageNode

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Ordinary turn-opening user message. */
    user: ReferencedUserMessageNode
    /** User message admitted into an active turn. */
    steering: ReferencedSteeringMessageNode
    /** Non-user context injected into model history. */
    context: ContextMessageNode
  }
}

function isCompactionCheckpoint(event: Parameters<ConversationNodeDefinition['match']>[0]): boolean {
  if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)) return false
  const source = event.data.source
  return source.kind === 'plugin' && source.plugin === 'compact'
}

/**
 * Classify inputs through their producer without coupling generic chat to source kinds.
 * @param userInput - Producer-owned user display projection.
 * @returns Chat message Definition for this registry.
 */
export function createMessageDefinition(
  userInput: (message: Extract<Parameters<ConversationNodeDefinition['match']>[0], { type: 'user/message' }>['data']) => ConversationUserInput | undefined,
): ConversationNodeDefinition<MessageNode> {
  return {
    kind: 'input-message',
    target: 'chat',
    match: event => event.type === 'user/message'
      && isAppendSurfaceEvent(event)
      && !isCompactionCheckpoint(event)
      ? { id: String(event.data.id), role: 'start' }
      : null,
    start: (_context, match, reader) => {
      if (match.event.type !== 'user/message') throw new Error('input-message start requires user/message')
      const event = match.event
      const input = userInput(event.data)
      if (input === undefined) {
        return {
          kind: 'context',
          seq: event.seq,
          time: event.time,
          content: event.data.content,
          source: event.data.source,
          provenance: contextProvenance(event.data.source),
          form: contextForm(event.data.source),
        }
      }
      const turn = match.location.kind === 'turn' || match.location.kind === 'step' ? match.location.turn.turn : undefined
      const claimed = reader.previous<InboxState>('inbox-next-step')?.state.claimed.has(String(event.data.id)) === true
      return claimed
        ? {
          kind: 'steering',
          ...turn === undefined ? {} : { turn },
          ...input.references === undefined ? {} : { references: input.references },
          messageId: event.data.id,
          seq: event.seq,
          time: event.time,
          content: input.content,
          source: event.data.source,
        }
        : {
          kind: 'user',
          ...turn === undefined ? {} : { turn },
          ...input.references === undefined ? {} : { references: input.references },
          seq: event.seq,
          time: event.time,
          content: input.content,
          source: event.data.source,
        }
    },
    update: context => context.state,
    buildViewNode: (context) => {
      if (context.state === undefined) return null
      return chatNode(context, context.state.kind, context.state.seq, context.state)
    },
  }
}

/** Ordinary user classification for isolated Definition consumers. */
export const messageDefinition = createMessageDefinition(message => message.source.kind === 'user' ? { content: message.content } : undefined)

/**
 * Register the user, steering, and injected-context message contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerMessageConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(createMessageDefinition(message => ctx.conversationEvents.userInput(message)))
}
