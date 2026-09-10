---
description: "Find complete image and file references authorized by a session log."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-attachment-index

English | [中文](README.zh.md)

## Summary

Find complete image and file references authorized by a session log. Domain packages can register extractors for their own durable event types. Byte storage and HTTP authorization remain with the consuming services.

## Table of Contents

- [Package responsibilities](#package-section-0)
- [Service: `SessionAttachmentIndex` (ctx key: `sessionAttachments`)](#package-section-1)
- [Contract](#package-section-2)
- [Role](#package-section-3)
- [Runtime assertions](#package-section-4)
- [Model Experience](#package-section-5)
- [Known Limitations and Deferred Work](#package-section-6)
- [Dev Note](#dev-note)

<a id="package-section-0"></a>
## Package responsibilities

Generic Session attachment-reference registry. It owns `ctx.sessionAttachments`, the sole implementation that turns a durable Session event into the complete `ImageAttachmentRef`/`FileAttachmentRef` values it authorizes. A built-in scanner covers each built-in event carrier of image or file content (direct content, a wrapped message, inserted messages, and completed blocks in an `assistant/attempt` stream); a domain package registers a typed extractor for one event type it owns instead, and that extractor may return either reference kind (or both).

<a id="package-section-1"></a>
## Service: `SessionAttachmentIndex` (ctx key: `sessionAttachments`)

### Public API

- `ctx.sessionAttachments.register(eventType, extractor): () => void` Register one domain's extractor for an extractor-required event type (a known type this package does not itself classify `built-in` or `attachment-free`). Effect-owned: disposing the calling fiber removes the registration. Throws when `eventType` is already `built-in`/`attachment-free`, or when another live registration already owns the key.
- `ctx.sessionAttachments.extract(event): readonly (ImageAttachmentRef | FileAttachmentRef)[]` Every reference one durable event authorizes. Throws `SessionAttachmentIndexError` (`SESSION_ATTACHMENT_EXTRACTOR_MISSING`) for a known extractor-required type with no live registration.
- `ctx.sessionAttachments.findReferencedImage(events, attachmentId): ImageAttachmentRef | undefined` First image reference matching one opaque id across an ordered event sequence — the live single-reference authorization read. Filters out any file reference `extract()` returns for the same event stream.
- `ctx.sessionAttachments.findReferencedFile(events, attachmentId): FileAttachmentRef | undefined` The file complement of `findReferencedImage`.
- `ctx.sessionAttachments.collectReferencedImages(events): ReadonlyMap<string, ImageAttachmentRef>` Every distinct image reference across an ordered event sequence, deduped by attachment id — the Session-export media-collection read.
- `ctx.sessionAttachments.collectReferencedFiles(events): ReadonlyMap<string, FileAttachmentRef>` The file complement of `collectReferencedImages`.

### Key Types

- `SessionAttachmentPolicy` — `'built-in' | 'attachment-free' | 'extractor-required'`, the three-way classification every known Session event type carries.
- `SessionAttachmentExtractorMap` — the merge-extensible type table a domain package augments (typically beside its own `SessionEventMap` merge) to widen `register()`'s typed key set.
- `SessionAttachmentIndexError` — typed rejection carrying the stable `SESSION_ATTACHMENT_EXTRACTOR_MISSING` code.

<a id="package-section-2"></a>
## Contract

- **Exhaustive, closed policy.** `./policy.ts` classifies every currently known Session event type as `built-in` or `attachment-free` in two closed lists; any known type in neither list is `extractor-required`. A test in this package's own suite compares the two lists against `@deepseek-ai/dsh-session`'s generated `KNOWN_SESSION_EVENT_TYPES`: adding a known event type without updating a list (or accounting for it as newly extractor-required) fails that test. This package needs no dependency on a domain package to carry the classification — event type strings are already public through the repo-wide generated type set.
- **Fail loud, never a false empty result.** A known extractor-required type with no live registration raises `SESSION_ATTACHMENT_EXTRACTOR_MISSING` rather than silently authorizing nothing; an unrecognized type reaches this registry only when the persistence read path already admitted it as `ignorable`, and such a type authorizes nothing. A registered extractor that rejects malformed data (its own strict domain decoder) propagates that failure rather than degrading to an empty result.
- **Complete references only, never a bare id.** A registered extractor validates its event's own durable fields and returns whole `ImageAttachmentRef`/`FileAttachmentRef` values. A reference is authorized only by appearing in one classified/registered carrier of the exact session's own log — arbitrary JSON (tool arguments, another session's events, an attachment-free or unknown-ignorable event) authorizes nothing. The built-in scanner (`extractBuiltInAttachments`) collects image and file references, including nested tool-result content. A file reference does not imply that its bytes are text; consumers must validate the media type and encoding before decoding.
- **One security-sensitive registration per key.** Unlike a read-side projection registry, two live registrations for the same event type are always rejected rather than ref-counted: this decision authorizes byte access, and ambiguous ownership of it is a correctness concern, not a UI inconsistency.
- **Not a second attachment store.** `ctx.attachments` remains the only byte owner and integrity verifier; this registry answers only which complete references one Session log durably names.

<a id="package-section-3"></a>
## Role

This package owns the generic registry role of the attachment-authorization seam: a domain host plugin contributes a typed extractor for its own extractor-required event type, and `dsh-tool-science` consumes the registry to authorize session file references. Neither side knows the other. No production domain registers an extractor today — Science's `science/artifact-saved` is `attachment-free`, since the project artifact store (`dsh-science-artifact-store`), not this registry, owns Science artifact bytes.

<a id="package-section-4"></a>
## Runtime assertions

No runtime invariant companion is published: Extraction reads admitted events without retaining a second event history; registration rejects duplicate ownership directly. The registry has no independent durable projection to compare.

<a id="package-section-5"></a>
## Model Experience

None, as this package computes no prompt, tool schema, or model-facing content; it only classifies durable events already logged elsewhere.

#### KV Cache effect

None; it never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="package-section-6"></a>

- **The exhaustiveness test, not a build-time generator, enforces freshness.** Unlike the JSDoc-tag-driven generators this repository uses for some merge-extensible vocabularies, the two policy lists here are a single hand-maintained table verified by a unit test against the generated known-type set; a future domain package that needs its own extractor-required event type edits nothing in this package beyond calling `register()`.
- This registry alone does not authorize an HTTP endpoint; each consumer must validate the request and enforce byte access.

The built-in scanner includes image and file references from V3 completed assistant attempts and message carriers. `decodeReferencedText` admits CSV, JSON, Markdown, and plain-text filenames and rejects malformed UTF-8; a generic file reference alone does not imply text content.

<a id="dev-note"></a>
### Dev Note

None.
