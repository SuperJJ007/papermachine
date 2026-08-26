# @deepseek-ai/dsh-session-attachment-index

English | [中文](README.zh.md)

Generic Session attachment-reference registry. It owns `ctx.sessionAttachments`, the sole implementation that turns a durable Session event into the complete `ImageAttachmentRef`/`TextAttachmentRef` values it authorizes. A built-in scanner covers every event whose model-visible content carries an image reference today (direct content, a wrapped assistant message, every inserted message, and a completed `assistant/chunk` block); a domain package registers a typed extractor for one event type it owns instead, and that extractor may return either reference kind (or both). `dsh-host-apiproxy` consumes this registry exclusively for live attachment-read authorization and Session ZIP export media collection, so one accepted domain event authorizes both paths identically.

## Service: `SessionAttachmentIndex` (ctx key: `sessionAttachments`)

### Public API

- `ctx.sessionAttachments.register(eventType, extractor): () => void` Register one domain's extractor for an extractor-required event type (a known type this package does not itself classify `built-in` or `attachment-free`). Effect-owned: disposing the calling fiber removes the registration. Throws when `eventType` is already `built-in`/`attachment-free`, or when another live registration already owns the key.
- `ctx.sessionAttachments.extract(event): readonly (ImageAttachmentRef | TextAttachmentRef)[]` Every reference one durable event authorizes. Throws `SessionAttachmentIndexError` (`SESSION_ATTACHMENT_EXTRACTOR_MISSING`) for a known extractor-required type with no live registration.
- `ctx.sessionAttachments.findReferencedImage(events, attachmentId): ImageAttachmentRef | undefined` First image reference matching one opaque id across an ordered event sequence — the live single-reference authorization read. Filters out any text reference `extract()` returns for the same event stream.
- `ctx.sessionAttachments.findReferencedText(events, attachmentId): TextAttachmentRef | undefined` The text complement of `findReferencedImage`.
- `ctx.sessionAttachments.collectReferencedImages(events): ReadonlyMap<string, ImageAttachmentRef>` Every distinct image reference across an ordered event sequence, deduped by attachment id — the Session-export media-collection read.
- `ctx.sessionAttachments.collectReferencedTexts(events): ReadonlyMap<string, TextAttachmentRef>` The text complement of `collectReferencedImages`.

### Key Types

- `SessionAttachmentPolicy` — `'built-in' | 'attachment-free' | 'extractor-required'`, the three-way classification every known Session event type carries.
- `SessionAttachmentExtractorMap` — the merge-extensible type table a domain package augments (typically beside its own `SessionEventMap` merge) to widen `register()`'s typed key set.
- `SessionAttachmentIndexError` — typed rejection carrying the stable `SESSION_ATTACHMENT_EXTRACTOR_MISSING` code.

## Contract

- **Exhaustive, closed policy.** `./policy.ts` classifies every currently known Session event type as `built-in` or `attachment-free` in two closed lists; any known type in neither list is `extractor-required`. A test in this package's own suite compares the two lists against `@deepseek-ai/dsh-session`'s generated `KNOWN_SESSION_EVENT_TYPES`: adding a known event type without updating a list (or accounting for it as newly extractor-required) fails that test. This package needs no dependency on a domain package to carry the classification — event type strings are already public through the repo-wide generated type set.
- **Fail loud, never a false empty result.** A known extractor-required type with no live registration raises `SESSION_ATTACHMENT_EXTRACTOR_MISSING` rather than silently authorizing nothing; an unrecognized type reaches this registry only when the persistence read path already admitted it as `ignorable`, and such a type authorizes nothing. A registered extractor that rejects malformed data (its own strict domain decoder) propagates that failure rather than degrading to an empty result.
- **Complete references only, never a bare id.** A registered extractor validates its event's own durable fields and returns whole `ImageAttachmentRef`/`TextAttachmentRef` values. A reference is authorized only by appearing in one classified/registered carrier of the exact session's own log — arbitrary JSON (tool arguments, another session's events, an attachment-free or unknown-ignorable event) authorizes nothing. The built-in carrier scanner (`extractBuiltInAttachments`) stays image-only: today's model-visible content blocks have no text-attachment carrier kind, so only a registered domain extractor can return a `TextAttachmentRef`.
- **One security-sensitive registration per key.** Unlike a read-side projection registry, two live registrations for the same event type are always rejected rather than ref-counted: this decision authorizes byte access, and ambiguous ownership of it is a correctness concern, not a UI inconsistency.
- **Not a second attachment store.** `ctx.attachments` remains the only byte owner and integrity verifier; this registry answers only which complete references one Session log durably names.

## Role

This package owns the generic registry role of the attachment-authorization seam: a domain host plugin contributes a typed extractor for its own extractor-required event type, and `dsh-host-apiproxy` consumes the registry for both the live attachment RPC and Session ZIP export. Neither side knows the other. No production domain registers an extractor today — Science's `science/artifact-saved` is `attachment-free`, since the project artifact store (`dsh-science-artifact-store`), not this registry, owns Science artifact bytes.

## Model Experience

None, as this package computes no prompt, tool schema, or model-facing content; it only classifies durable events already logged elsewhere.

#### KV Cache effect

None; it never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The exhaustiveness test, not a build-time generator, enforces freshness.** Unlike the JSDoc-tag-driven generators this repository uses for some merge-extensible vocabularies, the two policy lists here are a single hand-maintained table verified by a unit test against the generated known-type set; a future domain package that needs its own extractor-required event type edits nothing in this package beyond calling `register()`.
- **Session export's "no partial ZIP" guarantee is per-artifact, not whole-archive.** A missing-extractor failure that surfaces while scanning the first artifact's content happens before any archive bytes are enqueued; a failure surfacing on a later subagent descendant still errors the in-progress stream rather than completing it, matching `dsh-host-apiproxy`'s existing fail-loud behavior for other mid-stream read failures.
