/**
 * `ctx.sessionAttachments`: the effect-owned, sole implementation for
 * extracting trusted attachment references from Session events. Built-in
 * carriers (direct content, wrapped message, inserted messages, and a
 * completed `assistant/chunk` block) are scanned without a domain
 * dependency; a domain package registers a typed extractor for one
 * extractor-required known event type and owns validating that event's own
 * durable fields before returning complete {@link ImageAttachmentRef}
 * values — never a bare id. `dsh-host-apiproxy` consumes this registry
 * exclusively for both live attachment-read authorization and Session ZIP
 * export media collection; see `./policy.ts` for the exhaustive
 * classification every known event type carries.
 *
 * This is not a second attachment store, projection, or garbage collector:
 * `ctx.attachments` remains the only byte owner and integrity verifier, and
 * `ctx.sessionAttachments` answers only which complete references one
 * Session log durably names.
 *
 * @module @deepseek-ai/dsh-session-attachment-index
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionAttachmentIndexError } from './errors.ts'
import { extractBuiltInAttachments } from './extract.ts'
import { staticAttachmentPolicy } from './policy.ts'
import type { SessionAttachmentExtractorEventType } from './types.ts'

export { SessionAttachmentIndexError } from './errors.ts'
export { ATTACHMENT_FREE_EVENT_TYPES, BUILT_IN_CARRIER_EVENT_TYPES, staticAttachmentPolicy } from './policy.ts'
export type {
  SessionAttachmentExtractorEventType,
  SessionAttachmentExtractorMap,
  SessionAttachmentIndexErrorCode,
  SessionAttachmentPolicy,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionAttachments: SessionAttachmentIndex
  }
}

/**
 * One durable event, loose enough to accept a live `SessionEvent` or a raw
 * value parsed from a stored JSONL row of the same shape (Session export's
 * cold read never validates a parsed row against `SessionEvent`'s exact
 * type union before scanning it, matching this registry's own tolerance).
 */
export type ExtractableEvent = Pick<SessionEvent, 'type' | 'data'> & { readonly ignorable?: true }

/** A live registrant's typed extractor, erased to the runtime call shape. */
type ErasedExtractor = (event: ExtractableEvent) => readonly ImageAttachmentRef[]

/**
 * Generic Session attachment-reference registry. Subscribes to no event bus
 * itself — every method is a pure, synchronous read over event values the
 * caller already holds (live `Session.events`, or rows parsed from a stored
 * artifact).
 */
export class SessionAttachmentIndex extends Service {
  private readonly extractors = new Map<string, ErasedExtractor>()

  /**
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionAttachments')
  }

  /**
   * Register one domain's extractor for an extractor-required known event
   * type. Effect-owned: disposing the calling fiber (or calling the returned
   * disposer) removes the registration, and a subsequent read of that event
   * type fails loud with {@link SessionAttachmentIndexError} instead of
   * silently authorizing nothing.
   * @param eventType - a known event type this package does not itself
   *   classify `built-in` or `attachment-free`; typed against the
   *   merge-extensible {@link SessionAttachmentExtractorMap}.
   * @param extractor - validates the event's own durable fields and returns
   *   every complete reference it authorizes (never a bare id).
   * @returns the exact disposer that unregisters this extractor.
   */
  register<K extends SessionAttachmentExtractorEventType>(
    eventType: K,
    extractor: (event: SessionEvent<K>) => readonly ImageAttachmentRef[],
  ): () => void {
    const staticPolicy = staticAttachmentPolicy(eventType)
    if (staticPolicy !== undefined) {
      throw new Error(
        `session-attachment-index: ${JSON.stringify(eventType)} is already classified ${JSON.stringify(staticPolicy)} and cannot register an extractor`,
      )
    }
    const dispose = this.ctx.effect(() => {
      if (this.extractors.has(eventType)) {
        throw new Error(`session-attachment-index: an extractor is already registered for ${JSON.stringify(eventType)}`)
      }
      // Ambiguous ownership of a byte-authorization decision is a security
      // concern, not a UI inconsistency: unlike `sessionProjections.register`,
      // two live registrants for the same key are always rejected rather
      // than ref-counted, even if a future caller believes them identical.
      this.extractors.set(eventType, extractor as ErasedExtractor)
      return () => { this.extractors.delete(eventType) }
    }, `sessionAttachments.register(${String(eventType)})`)
    return () => void dispose()
  }

  /**
   * Extract every complete attachment reference one durable event
   * authorizes. A `built-in` type is scanned directly; an `attachment-free`
   * type (or an unrecognized type, which persistence admits only when
   * `ignorable` is set) authorizes nothing; a known type outside both closed
   * lists requires a live registration and fails loud when one is absent.
   * @param event - one durable Session event (live or a parsed durable row).
   * @returns every reference the event durably names, in encounter order.
   * @throws {@link SessionAttachmentIndexError} when a known extractor-required
   *   type has no live registration.
   */
  extract(event: ExtractableEvent): readonly ImageAttachmentRef[] {
    const policy = staticAttachmentPolicy(event.type)
    if (policy === 'built-in') return extractBuiltInAttachments(event)
    if (policy === 'attachment-free') return []
    const registered = this.extractors.get(event.type)
    if (registered !== undefined) return registered(event)
    if (KNOWN_SESSION_EVENT_TYPES.has(event.type)) {
      throw new SessionAttachmentIndexError(
        'SESSION_ATTACHMENT_EXTRACTOR_MISSING',
        `session-attachment-index: known event type ${JSON.stringify(event.type)} is extractor-required but no extractor is registered`,
      )
    }
    // Persistence refuses a non-ignorable unrecognized type before this
    // point (see KNOWN_SESSION_EVENT_TYPES), so an unrecognized arrival here
    // is ignorable by construction and authorizes nothing.
    return []
  }

  /**
   * Resolve the first reference matching one opaque attachment id across an
   * ordered event sequence — the live single-reference authorization read.
   * @param events - the exact Session's events (or a prefix/suffix of them).
   * @param attachmentId - the opaque id a client requested.
   * @returns the matching reference, or `undefined` when no event names it.
   */
  findReferencedImage(events: Iterable<ExtractableEvent>, attachmentId: string): ImageAttachmentRef | undefined {
    for (const event of events) {
      const found = this.extract(event).find(ref => String(ref.attachmentId) === attachmentId)
      if (found !== undefined) return found
    }
    return undefined
  }

  /**
   * Collect every distinct reference across an ordered event sequence,
   * deduped by attachment id (last write wins for a repeated id) — the
   * Session-export media-collection read.
   * @param events - one artifact's parsed durable rows, in log order.
   * @returns every distinct reference, keyed by its string attachment id.
   */
  collectReferencedImages(events: Iterable<ExtractableEvent>): ReadonlyMap<string, ImageAttachmentRef> {
    const refs = new Map<string, ImageAttachmentRef>()
    for (const event of events) {
      for (const ref of this.extract(event)) refs.set(String(ref.attachmentId), ref)
    }
    return refs
  }
}

export default SessionAttachmentIndex
