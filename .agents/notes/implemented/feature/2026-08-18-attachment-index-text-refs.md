# Agent Note: `SessionAttachmentIndex` authorizes text references too

Status: implemented

English | [中文](2026-08-18-attachment-index-text-refs.zh.md)

## Problem

`SessionAttachmentIndex` is the sole registry that turns a durable Session event into the complete attachment references it authorizes, consumed by `dsh-host-apiproxy` for both live attachment-read authorization and Session ZIP export media collection. Its registration mechanism (`built-in`/`attachment-free`/`extractor-required` classification, one live registrant per event type, fail-loud on a missing registration) is already structurally generic — nothing about disposal, duplicate-registration rejection, or the exhaustive policy table is image-specific. Only the erased extractor's return type, `readonly ImageAttachmentRef[]`, pinned every domain extractor to image references, so a future domain extractor that wants to authorize a `TextAttachmentRef` (Science file capture, not built in this change) had no way to return one.

## Decision

`ErasedExtractor` widens to `readonly (ImageAttachmentRef | TextAttachmentRef)[]`, and `register()`'s typed extractor parameter and `extract()`'s return type widen the same way — one registered extractor may now authorize a mix of image and text references from a single event. `extractBuiltInAttachments` (the built-in scanner for message-content carriers) stays image-only: today's `ContentBlock` union has no text-attachment carrier kind, so only a registered domain extractor can ever return a `TextAttachmentRef`.

The two existing convenience reads (`findReferencedImage`, `collectReferencedImages`) keep their exact prior behavior — they now filter `extract()`'s widened result down to image references only, via a structural type guard (`isImageRef`, testing for `'width' in ref`; `ImageAttachmentRef` and `TextAttachmentRef` otherwise share `attachmentId`/`mediaType`/`bytes`/optional `name`, so presence of the pixel-dimension fields is the cheapest correct discriminant with no need to duplicate either media-type literal list). Two new mirror methods, `findReferencedText` and `collectReferencedTexts`, filter to text references via the complementary guard (`isTextRef`). `Array.prototype.find`'s type-predicate narrowing does not compose through an inline `&&` boolean expression, so both filters run as a `.filter(isImageRef)`/`.filter(isTextRef)` step before the id match, not as a combined boolean inside one predicate.

## Alternatives considered

**Keep `findReferencedImage`/`collectReferencedImages` returning the widened union and let callers narrow.** Rejected: every current caller (`dsh-host-apiproxy`'s live attachment RPC and ZIP export) wants exactly one reference kind per call site; pushing the narrowing into each caller would duplicate the same `isImageRef` check at every call site instead of once in the registry.

**A single generic `findReferenced<T>`/`collectReferenced<T>` pair instead of four named methods.** Rejected: the registry's public API is deliberately concrete per media kind (matching `AttachmentStore`'s own `saveImage`/`saveText` split, not a generic `save<T>`), and a generic pair would need a runtime discriminant parameter anyway to do the same filtering — the four-method shape reads as what it does at each call site without an extra type parameter.

## Consequences

`docs/subsystems/session.md`'s generated `## Cordis API` region (and its `.zh.md` pair, kept byte-identical by the generator) picked up the widened `register`/`extract` signatures and the two new methods automatically via `pnpm run gen-cordis-catalog`; no manual edit was needed since that region has no image-specific hand-authored prose outside the generated markers. `packages/session/session-attachment-index`'s bilingual READMEs document the widened `extract()` return type and the two new methods, and note that the built-in scanner remains image-only.

No consumer changed behavior: `dsh-host-apiproxy`'s `session-export.ts` and `api-proxy.ts` still call only the image-specific reads, which still return exactly what they returned before this change (`isImageRef`'s filter is a no-op against an all-image result set). `packages/science/science-session`'s own registered extractor (`science/artifact-saved`) still returns exactly one `ImageAttachmentRef` per artifact version: `ScienceArtifactVersion.attachment` is not yet the `ImageAttachmentRef | TextAttachmentRef` union file-centric artifact capture needs (see [`science/artifact-saved` replaces `science/chart-saved`](2026-08-18-science-artifact-saved-event.md)'s Consequences). That union, and the first real text-returning extractor, land together in [Science Runtime auto-capture of run-written files](2026-08-19-science-auto-capture.md).
