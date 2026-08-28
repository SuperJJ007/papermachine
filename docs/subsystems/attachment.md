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
/** Durable, serializable reference to one immutable normalized image. */
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
  /**
   * Input dimensions after applying EXIF orientation and before normalization
   * scaling. Present only when normalization reduced the image.
   */
  originalDimensions?: {
    width: number
    height: number
  }
}
```

```ts type-equiv
/** Deployment-resolved limits used by upload admission and request buffering. */
interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}
```

The local backend admits at most 20 images and 200 MiB of encoded source data per message. One source may use up to 20 MiB, 64,000,000 pixels, and 8192 pixels on either side. These source limits precede the independent normalization stage, which limits the long edge to 2048 pixels and encoded data to 4 MiB by default.

The reference records intrinsic dimensions and encoded length so clients can lay out history without decoding first, while every authoritative read still re-checks digest, media signature, dimensions, and metadata against the object.

## Commit and verified-read payloads

```ts type-equiv
/** Base64-encoded image upload accompanying one wire request. */
interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Request to validate and durably commit one image. */
interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
  /**
   * Admission route for the submitted bytes. `'normalize'` (the default) runs
   * the store's normalization pipeline before persisting. `'verbatim'`
   * persists the submitted bytes exactly as given — full decode verification
   * and every source admission limit still apply, but no metadata stripping,
   * color conversion, re-encoding, or downscaling — for callers whose stored
   * bytes are evidence that must read back byte-identical. A verbatim
   * reference never carries `originalDimensions`, and the normalized-image
   * byte cap does not apply to it.
   */
  normalization?: 'normalize' | 'verbatim'
}
```

```ts type-equiv
/** Stored image bytes returned after reference and digest verification. */
interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}
```

```ts type-equiv
/** Deterministic request-image policy selected by one exact model route. */
interface ImageRequestPolicy {
  /** Maximum width multiplied by height after aspect-preserving projection. */
  maxPixels: number
  /** Encoded-byte cap before base64 expansion or Files API upload. */
  maxBytes: number
}
```

```ts type-equiv
/** Cached request version derived from one provider-independent normalized attachment. */
interface RequestImageAttachment {
  /** Cache and upload-index key over the attachment id, policy, and fixed encoder parameters. */
  variantId: ImageVariantId
  /** Durable normalized attachment from which this request version was derived. */
  attachment: ImageAttachmentRef
  /** Encoded request bytes. */
  data: Uint8Array
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  /** Provider-compatible sample depth proven after request encoding. */
  depth: 'uchar'
  /** Provider-compatible color space proven after request encoding. */
  space: 'srgb'
  /** Whether the encoded request version retains an alpha channel. */
  hasAlpha: boolean
}
```

`saveImage()` prepares and atomically commits a provider-independent normalized attachment before returning its `ImageAttachmentRef`. `saveImages()` prepares every validated attachment once before publishing the batch, so validation rejection leaves no partial objects and publication does not repeat decoding or quality selection. `admitEncodedImages()` is the wire entry for base64 uploads and delegates count, aggregate-byte, and ordered batch admission to `saveImages()`. `readImage()` verifies a normalized attachment from an authorized session path. `readImageRequest()` derives and caches one request version under an exact route pixel and byte budget; new entries are fully decoded before publication, while cache hits use a bounded metadata probe. Callers use `Promise.all` over the singular method when they need an ordered batch. The local implementation lazily encodes preferred candidates, singleflights equal request identities, lets each waiter cancel independently, stops shared work when no waiter remains, and bounds all transforms with its instance-level limiter, which defaults to two simultaneous transformations. The service is retention-neutral: resumed and forked sessions may share objects, so reference-aware garbage collection is deferred rather than tied to one session's deletion.

## Text attachments

The text family mirrors the image family field-for-field but admits by byte cap and UTF-8 validity only. `TextMediaType` carries no byte-level signature the way a raster header does, so admission cannot detect or cross-check the declared media type against content — `saveText()`/`validateText()` trust the caller's declaration unverified. Storage is fully shared with the image path: content addressing never encodes media type in the path, so an image and a text file with identical bytes publish to the same object.

```ts type-equiv
/** Text formats accepted by the version-one text attachment path. */
type TextMediaType =
  | 'text/csv'
  | 'application/json'
  | 'text/markdown'
  | 'text/plain'
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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Validate and durably commit one ordered image batch.
 * @param inputs - encoded images in owning-message order.
 * @returns durable normalized attachment references in the same order after every member succeeds.
 */
async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>

/**
 * Validate and durably commit one image before its owning session event is appended.
 * The returned reference describes the persisted normalized image. When
 * normalization reduces the raster, its `originalDimensions` records the
 * orientation-applied input dimensions.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns the durable content-addressed normalized image reference.
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
 * @returns the verified bytes and normalized attachment reference.
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

/**
 * Generate or read one deterministic model-request version from the stored normalized image.
 * @param ref - durable provider-independent normalized attachment reference.
 * @param policy - exact route pixel and encoded-byte budget.
 * @param signal - optional cancellation.
 * @returns request bytes and the cache/upload identity covering every transform input.
 */
readImageRequest( ref: ImageAttachmentRef, policy: ImageRequestPolicy, signal?: AbortSignal, ): Promise<RequestImageAttachment>
```

Source: [`packages/attachment/attachment/src/index.ts`](../../packages/attachment/attachment/src/index.ts)
<!-- END GENERATED cordis-surface -->
