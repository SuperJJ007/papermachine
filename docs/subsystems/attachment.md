# Durable Attachments

English | [中文](attachment.zh.md)

The attachment seam separates binary image and text ownership from the session log. A producer gives validated encoded bytes to [`ctx.attachments`](#ctxattachments--attachmentstore-abstract-seam); the service publishes an immutable content-addressed reference only after the object is durable. Session events and model-visible `ImageBlock`s contain that reference and metadata, never a browser object URL, host temporary path, provider URL, or base64 payload.

Unsent browser drafts may stay in memory and native clients may stage them in operating-system temporary storage. Once the host accepts a user message, its images move below `<DSH_HOME>/attachments/v1` before the user event is appended. Structured model image output follows the same persist-before-event rule.

Source: [`packages/attachment/attachment/src/types.ts`](../../packages/attachment/attachment/src/types.ts)

## Identity and verified metadata

`AttachmentId` is a branded opaque string. The local backend currently emits `sha256:<digest>`, but consumers must neither parse that representation nor derive a filesystem path from it.

```ts type-equiv
/** Raster image formats accepted by the version-one attachment path. */
type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
```

```ts type-equiv
/** Durable, serializable metadata for one immutable image object. */
interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
}
```

```ts type-equiv
/** Deployment-resolved limits used by upload admission and request buffering. */
interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: readonly ImageMediaType[]
}
```

The reference records intrinsic dimensions and encoded length so clients can lay out history without decoding first, while every authoritative read still re-checks digest, media signature, dimensions, and metadata against the object.

## Commit and verified-read payloads

```ts type-equiv
/** Request to validate and durably commit one image. */
interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Stored image bytes returned after reference and digest verification. */
interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}
```

`saveImage()` validates bytes and atomically commits one object before returning its reference. `validateImage()` runs the same admission checks without persisting anything; batch callers validate every member through it before saving any member, so validation rejection leaves no partial objects behind. `readImage()` accepts a reference from an authorized session path and returns bytes only after integrity verification. The service is deliberately retention-neutral: resumed and forked sessions may share objects, so reference-aware garbage collection is deferred rather than tied to any one session's deletion.

## Text attachments

The text family mirrors the image family field-for-field but admits by byte cap and UTF-8 validity only. `TextMediaType` carries no byte-level signature the way a raster header does, so admission cannot detect or cross-check the declared media type against content — `saveText()`/`validateText()` trust the caller's declaration unverified. Storage is fully shared with the image path: content addressing never encodes media type in the path, so an image and a text file with identical bytes publish to the same object.

```ts type-equiv
/** Text formats accepted by the version-one text attachment path. */
type TextMediaType = 'text/csv' | 'application/json' | 'text/markdown' | 'text/plain'
```

```ts type-equiv
/** Durable, serializable metadata for one immutable UTF-8 text object. */
interface TextAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Caller-declared media type; text formats carry no self-describing byte signature, so admission trusts it unverified. */
  mediaType: TextMediaType
  /** Exact encoded UTF-8 byte length. */
  bytes: number
  /** Optional display name stripped of local path information. */
  name?: string
}
```

```ts type-equiv
/** Deployment-resolved limits used by text upload admission. */
interface TextAttachmentLimits {
  maxTextBytes: number
  mediaTypes: readonly TextMediaType[]
}
```

```ts type-equiv
/** Request to validate and durably commit one UTF-8 text file. */
interface SaveTextAttachment {
  data: Uint8Array
  /** Caller-declared media type; not verified against content (see {@link TextAttachmentRef.mediaType}). */
  mediaType: TextMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Stored text bytes returned after reference and digest verification. */
interface StoredTextAttachment {
  ref: TextAttachmentRef
  data: Uint8Array
}
```

There is no `saveTexts` batch entry point: no current caller uploads text files the way `saveImages` batches a chat message's images, so a Science capture caller saves each file through its own loop over single `saveText` calls. `TextAdmissionErrorCode` (`INVALID_TEXT`, `TEXT_TOO_LARGE`) marks caller-correctable text-input failures, parallel to `ImageAdmissionErrorCode`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxattachments--attachmentstore-abstract-seam"></a>

### `ctx.attachments` — `AttachmentStore` (abstract seam)

Immutable binary attachment service. Implementations validate bytes before publishing a reference.

```ts cordis-catalog
/**
 * Validate one image without persisting it.
 * Batch callers validate every member before saving any member.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns completion after the encoded raster has been fully decoded.
 */
abstract validateImage(input: SaveImageAttachment): Promise<void>

/**
 * Validate one text file without persisting it.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns completion after the encoded bytes have been proven non-empty, valid UTF-8, and within the byte cap.
 */
abstract validateText(input: SaveTextAttachment): Promise<void>

/**
 * Validate one ordered image batch before committing any member.
 * Validation failures start no writes; storage failures return no partial
 * references, although already published content-addressed objects may stay
 * unreachable until a future retention policy collects them.
 * @param inputs - encoded images in their owning message order.
 * @returns durable references in the exact input order.
 */
async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>

/**
 * Validate and durably commit one image before its owning session event is appended.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns a durable content-addressed reference.
 */
abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

/**
 * Validate and durably commit one text file before its owning session event is appended.
 * No batch entry point exists here: no current caller uploads text files the way
 * `saveImages` batches a chat message's images, so a Science capture caller
 * saves each file with its own loop over single `saveText` calls.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns a durable content-addressed reference.
 */
abstract saveText(input: SaveTextAttachment): Promise<TextAttachmentRef>

/**
 * Read one image and verify that bytes still match the recorded reference.
 * @param ref - durable reference from the session log.
 * @param signal - optional cancellation for backend read and verification work.
 * @returns the verified bytes and canonical reference.
 * @throws the signal reason when aborted, or a storage error when verification fails.
 */
abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

/**
 * Read one text file and verify that bytes still match the recorded reference.
 * @param ref - durable reference from the session log.
 * @param signal - optional cancellation for backend read and verification work.
 * @returns the verified bytes and canonical reference.
 * @throws the signal reason when aborted, or a storage error when verification fails.
 */
abstract readText(ref: TextAttachmentRef, signal?: AbortSignal): Promise<StoredTextAttachment>
```

Source: [`packages/attachment/attachment/src/index.ts:40`](../../packages/attachment/attachment/src/index.ts)
<!-- END GENERATED cordis-surface -->
