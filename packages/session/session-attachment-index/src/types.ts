/**
 * Client-safe types for the Session attachment-reference registry.
 * @module @deepseek-ai/dsh-session-attachment-index/types
 */

import type { SessionEventType } from '@deepseek-ai/dsh-session'

/**
 * Classification every known Session event type carries in the registry's
 * exhaustive policy table (see `./policy.ts`). `built-in` types are scanned
 * directly by this package's own carrier scanner; `attachment-free` types
 * never reference an attachment; `extractor-required` types need a live
 * `ctx.sessionAttachments.register()` call from their owning domain package
 * before any of their events can authorize bytes.
 */
export type SessionAttachmentPolicy = 'built-in' | 'attachment-free' | 'extractor-required'

/**
 * Merge-extensible declaration of event types eligible for
 * `ctx.sessionAttachments.register()`. A domain package that owns an
 * extractor-required known event type augments this interface — typically
 * beside its own `SessionEventMap` merge — to widen the registration's typed
 * key set: `interface SessionAttachmentExtractorMap { 'domain/event-name': true }`.
 * The literal value carries no information; only the key matters. A type
 * this package already classifies `built-in` or `attachment-free` in its own
 * static policy table cannot also appear here — `register()` rejects that at
 * the registration effect. No production domain registers an extractor
 * today: Science's own `science/artifact-saved` is `attachment-free` (the
 * project artifact store owns its bytes, outside this registry entirely).
 */
export interface SessionAttachmentExtractorMap {}

/** Restrict merge-extensible extractor keys to known durable Session event types. */
export type SessionAttachmentExtractorEventType = keyof SessionAttachmentExtractorMap extends infer EventType
  ? EventType extends SessionEventType ? EventType : never
  : never

/** Stable rejection codes for the Session attachment-reference registry. */
export type SessionAttachmentIndexErrorCode = 'SESSION_ATTACHMENT_EXTRACTOR_MISSING'
