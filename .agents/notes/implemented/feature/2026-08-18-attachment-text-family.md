# Agent Note: A parallel Text attachment family beside the image family

Status: implemented

English | [中文](2026-08-18-attachment-text-family.zh.md)

## Problem

`@deepseek-ai/dsh-attachment` and its local backend were image-only at every layer: `ImageMediaType` was the only durable media-type union, `AttachmentStore`'s every method was named `*Image*`, and admission (`attachment-local/src/store.ts`) fully raster-decoded every candidate through `sharp` before publishing a reference. File-centric Science artifact capture needs `.csv`, `.json`, `.md`, and `.txt` files to reach the same content-addressed, durably-referenced storage a saved chart already uses — but those formats have no raster header to decode, no intrinsic width/height, and no byte-level signature distinguishing one text format from another the way PNG headers differ from JPEG headers.

## Decision

A new parallel Text family mirrors the Image family field-for-field, rather than widening `ImageAttachmentRef` into a generic discriminated union:

```ts
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'

type TextMediaType = 'text/csv' | 'application/json' | 'text/markdown' | 'text/plain'
interface TextAttachmentRef { attachmentId: AttachmentId; mediaType: TextMediaType; bytes: number; name?: string }
interface TextAttachmentLimits { maxTextBytes: number; mediaTypes: readonly TextMediaType[] }
interface SaveTextAttachment { data: Uint8Array; mediaType: TextMediaType; name?: string }
interface StoredTextAttachment { ref: TextAttachmentRef; data: Uint8Array }
```

`AttachmentStore` gains `abstract readonly textLimits`, `validateText`, `saveText`, `readText` alongside the Image methods. There is no `saveTexts` batch entry point: no current caller uploads text files the way `saveImages` batches a chat message's images, so a Science capture caller saves each file through its own loop over single `saveText` calls — an unbatched pair beside a batched pair is explained asymmetry, not a missed extraction.

`attachment-local` admission (`validateTextFile`/`saveTextFile`) checks only the byte cap and UTF-8 validity (`node:buffer`'s `isUtf8`) — no raster decode, no pixel cap, and critically no content-format check: `TextMediaType` is caller-declared and trusted unverified against content, because CSV/JSON/Markdown/plain-text bytes carry no distinguishing signature the way a PNG or JPEG header does. This is a deliberate simplification from the image path's `IMAGE_TYPE_MISMATCH` check, not an oversight.

Storage is fully shared with the image path: content addressing never encoded media type in the path, so `objectPath`/`root` apply unchanged, and the low-level content-addressed publish/read mechanics (`publishObject`/`readObject`, extracted from what was previously `saveImageFile`/`readImageFile`'s inline bodies) are now shared private helpers in `attachment-local/src/store.ts`. Extracting them was in scope for this change, not incidental refactoring: writing a second independent copy of the durability-sensitive publish dance (staging file, sync, atomic hard-link, EEXIST dedup fallback, directory syncs, cleanup-on-failure) would have doubled the surface the per-file 100% coverage gate requires edge-case tests for, for code that is byte-identical regardless of what media type owns the bytes. The extraction changed no image-facing behavior; `attachment-local/tests/store.spec.ts`'s complete existing image suite (including the exact-order directory-sync assertion) passes unchanged against the refactored implementation.

`LocalAttachmentStore.Config` gains a validated `maxTextBytes` field (default `DEFAULT_MAX_TEXT_BYTES`, 5 MiB, matching `DEFAULT_MAX_IMAGE_BYTES`) with the same `.step(1).min(1)` validation shape the image byte fields already use — this package has no precedent for explicit `MAX_*` upper bounds on any admission field, image or text, so none is added here either. The accepted `TextMediaType` set is a fixed constant (`TEXT_MEDIA_TYPES`), not a Loader-exposed knob, mirroring the existing precedent that `ImageAttachmentLimits.mediaTypes` is not configurable either.

`AttachmentErrorCode` gains a `TextAdmissionErrorCode` subset (`INVALID_TEXT`, `TEXT_TOO_LARGE`), parallel to `ImageAdmissionErrorCode`. No `isTextAdmissionError` predicate is added: `isImageAdmissionError` exists because two real upload-path consumers (`packages/mcp/mcp-client/src/tools.ts`, `packages/acp/acp/src/content.ts`) need to distinguish caller-correctable admission failures from storage faults for user-submitted images; no current or near-term consumer needs that distinction for text (Science capture, the only near-term text writer, does not route through either of those upload paths).

## Alternatives considered

**Widen `AttachmentStore`/`ImageAttachmentRef` into one generic discriminated union over media family.** Rejected: a full rewrite of `saveImage`/`readImage`/`imageLimits` would touch every image-upload consumer unrelated to Science, with no second-family evidence yet (this is the first non-image family) to justify the bigger abstraction. The parallel-family shape keeps the blast radius scoped to additive members.

**Duplicate the content-addressed publish/read logic instead of extracting shared helpers.** Rejected: `saveImageFile`'s publish dance (durable-boundary proof, staging, atomic hard-link, EEXIST dedup, directory syncs, failure cleanup) is intricate and already carries dedicated tests for ordering and crash-safety; a second independent copy for text would need its own equivalent tests to reach the 100%-per-file coverage bar for code that does not actually differ by media type.

**Verify `TextMediaType` against content, mirroring `IMAGE_TYPE_MISMATCH`.** Rejected: there is no byte-level signature distinguishing `text/csv` from `text/markdown` from `text/plain` the way a raster header distinguishes PNG from JPEG — any check would require parsing (a CSV-shaped heuristic, a JSON parse attempt), which is exactly the "no raster decode" simplification this design deliberately avoids. The caller's declaration is trusted, matching the design's explicit "byte cap + UTF-8 validity only" scope.

**Add a `saveTexts` batch method for symmetry with `saveImages`.** Rejected: no current caller batches text uploads the way a chat message batches several images; adding one speculatively would be unowned surface with no current consumer.

## Consequences

Every existing `AttachmentStore` subclass across the repo needed `textLimits`/`validateText`/`saveText`/`readText` stub members added to keep implementing the now-wider abstract contract: the package-local test files (`packages/llm/llm-pi-ai`'s two test files, `packages/host/apiproxy`, `packages/mcp/mcp-client`, `packages/fs/tool-fs` (two subclasses), `packages/acp/acp`'s shared harness — none part of the gated `pnpm run typecheck` aggregate, verified instead by running each affected suite) and two root-level `scripts/*.ts` fixtures (`gen-tool-catalog.ts`'s `CatalogAttachmentStore`, `test-invariants.ts`'s `TestAttachmentStore`) that `tsconfig.host.json` includes directly and `pnpm run typecheck` does gate.

`docs/subsystems/attachment.md` (renamed from "Durable Image Attachments" to "Durable Attachments") gained five new `ts type-equiv` blocks and a "Text attachments" section, registered in `scripts/type-equiv.manifest.json`; the generated `## Cordis API` region needed `scripts/gen-cordis-catalog.ts`'s `linkedTypePages` map extended with `TextAttachmentRef`/`SaveTextAttachment`/`StoredTextAttachment` before the generator's type-link coverage check would pass. Both `packages/attachment/attachment` and `packages/attachment/attachment-local` READMEs (English and Chinese) document the new seam and its Known Limitations addition (declared media type is never content-verified).

This change does not wire the wider `ImageAttachmentRef | TextAttachmentRef` union into `dsh-science-session`'s `ScienceArtifactVersion.attachment`; it only makes `TextAttachmentRef` exist and be storable/readable through `ctx.attachments`. [Science Runtime auto-capture of run-written files](2026-08-19-science-auto-capture.md) is the first caller to produce a text-attached artifact version, once that union lands.
