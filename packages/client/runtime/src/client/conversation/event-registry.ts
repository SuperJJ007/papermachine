import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationNodeDefinition, ConversationUserInput } from '../contract/conversation.ts'
import { ConversationDefinitionRegistry } from './definition-registry.ts'

/** Runtime registry of independently owned Conversation business Definitions. */
export class ConversationEventRegistry extends ConversationDefinitionRegistry<ConversationNodeDefinition> {
  private fallback: ConversationNodeDefinition | undefined
  private readonly userInputs = new Map<string, (message: SessionEvent<'user/message'>['data']) => ConversationUserInput>()

  /** @param ctx - owning Client Runtime context. */
  constructor(ctx: Context) {
    super(ctx, 'conversationEvents')
  }

  /**
   * Identify a producer's user-authored messages without changing the durable source or model text.
   * @param kind - unique source kind owned by the producer; `user` is reserved.
   * @param project - pure projection of the user's text and references.
   * @returns idempotent disposer; registration and disposal rebuild loaded conversations.
   */
  registerUserInput(kind: string, project: (message: SessionEvent<'user/message'>['data']) => ConversationUserInput): () => void {
    if (kind === 'user' || this.userInputs.has(kind)) throw new Error(`user input source "${kind}" is already registered`)
    const dispose = this.ctx.effect(() => {
      this.userInputs.set(kind, project)
      this.refresh()
      return () => {
        this.userInputs.delete(kind)
        this.refresh()
      }
    }, `conversationEvents.registerUserInput(${JSON.stringify(kind)})`)
    return () => { void dispose() }
  }

  /**
   * Resolve user-authored input; unregistered producer sources remain context.
   * @param message - authoritative logged input.
   * @returns user presentation, or undefined for injected context.
   */
  userInput(message: SessionEvent<'user/message'>['data']): ConversationUserInput | undefined {
    return message.source.kind === 'user' ? { content: message.content } : this.userInputs.get(message.source.kind)?.(message)
  }

  /**
   * Register a uniquely named business Definition for the caller's lifetime.
   * @param definition - Definition contribution.
   * @returns idempotent disposer.
   */
  register(definition: ConversationNodeDefinition): () => void {
    assertDefinitionTarget(definition)
    return this.registerDefinition(
      definition.kind,
      definition,
      `conversation Definition "${definition.kind}" is already registered`,
      `conversationEvents.register(${JSON.stringify(definition.kind)})`,
    )
  }

  /**
   * Register the sole fallback used only when no ordinary Definition matches.
   * @param definition - fallback Definition.
   * @returns idempotent disposer.
   */
  registerFallback(definition: ConversationNodeDefinition): () => void {
    assertDefinitionTarget(definition)
    const target = definition.target
    if (target === undefined) throw new Error('conversation fallback Definition must declare a target')
    if (this.fallback !== undefined) throw new Error('conversation fallback Definition is already registered')
    const owner = this.ctx
    const dispose = owner.effect(() => {
      this.fallback = definition
      this.refresh()
      return () => {
        if (this.fallback !== definition) return
        this.fallback = undefined
        this.refresh()
      }
    }, `conversationEvents.registerFallback(${JSON.stringify(definition.kind)})`)
    return () => { void dispose() }
  }

  /**
   * Return the current unmatched-event fallback.
   * @returns installed fallback, when present.
   */
  fallbackEntry(): ConversationNodeDefinition | undefined {
    return this.fallback
  }
}

function assertDefinitionTarget(definition: ConversationNodeDefinition): void {
  if ((definition.target === undefined) !== (definition.buildViewNode === undefined)) {
    throw new Error(
      `conversation Definition "${definition.kind}" must declare target and buildViewNode together`,
    )
  }
}
