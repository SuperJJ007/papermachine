/** Public pending-interaction data and response callbacks. */
import type { ClientResponse, MuxFrame, RpcReceipt, SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** Kind-keyed payload map: the requested frame's domain fields (envelope fields stripped). */
export interface PendingPayloads {
  approval: Omit<Extract<MuxFrame, { type: 'approval/requested' }>, 'type' | 'sessionId'>
  question: Omit<Extract<MuxFrame, { type: 'question/requested' }>, 'type' | 'sessionId'>
}

/** Pending-interaction discriminant (the keys of PendingPayloads). */
export type PendingKind = keyof PendingPayloads

/** Session-list summary of the user action currently blocking progress. */
export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** One answerable interaction; settlement is represented by pending-list membership. */
export interface PendingInteractionFace<K extends PendingKind> {
  readonly kind: K
  /** Opaque render identity, stable across baseline replay and usable as a React key. */
  readonly key: string
  readonly sessionId: SessionId
  /** Requested domain fields without the carrier envelope. */
  readonly payload: PendingPayloads[K]
  /**
   * Send a domain result through the response carrier; throws synchronously after settlement.
   * @param result - Domain-encoded result or error.
   * @returns Carrier receipt; rejects when delivery fails.
   */
  respond(result: ClientResponse['result']): Promise<RpcReceipt>
}
/** Kind-discriminated public interaction data and response callback. */
export type PendingInteraction = { [K in PendingKind]: PendingInteractionFace<K> }[PendingKind]
