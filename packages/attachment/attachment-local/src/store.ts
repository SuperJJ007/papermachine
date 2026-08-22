/** Content-addressed, owner-private local attachment storage. */

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { isUtf8 } from 'node:buffer'
import { dirname, join, parse, resolve } from 'node:path'
import {
  AttachmentError,
  AttachmentId,
} from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  SaveTextAttachment,
  StoredImageAttachment,
  StoredTextAttachment,
  TextAttachmentLimits,
  TextAttachmentRef,
} from '@deepseek-ai/dsh-attachment'
import { normalizeImage } from './normalization.ts'
import type { NormalizationPolicy } from './normalization.ts'
import { detectImage, probeImage } from './image.ts'
import type { DetectedImage } from './image.ts'

const ID_PATTERN = /^sha256:([a-f0-9]{64})$/
const durableHomes = new Set<string>()

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function displayName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  // Strip both separator styles by hand: a POSIX host treats `\` as an
  // ordinary character, so path.basename would keep a Windows client's full
  // local path and leak it into the reference and the session log.
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  return clean === '' ? undefined : clean
}

function objectPath(root: string, sha256: string): string {
  return join(root, 'objects', sha256.slice(0, 2), sha256)
}

function ensureReference(ref: ImageAttachmentRef | TextAttachmentRef): string {
  const match = ID_PATTERN.exec(String(ref.attachmentId))
  if (match?.[1] === undefined) throw new AttachmentError('Attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
  return match[1]
}

async function inspectMetadata(
  data: Uint8Array,
  declaredMediaType: ImageAttachmentRef['mediaType'],
  limits: ImageAttachmentLimits,
): Promise<DetectedImage> {
  if (data.byteLength === 0) throw new AttachmentError('Image is empty.', 'INVALID_IMAGE')
  const detected = await detectImage(data, { maxPixels: limits.maxImagePixels, maxDimension: limits.maxImageDimension })
  if (detected.mediaType !== declaredMediaType) throw new AttachmentError('Declared image type does not match its bytes.', 'IMAGE_TYPE_MISMATCH')
  return detected
}

/**
 * Run the full admission policy for one image without touching storage,
 * including normalization: a batch whose members all validate cannot later
 * be refused by the normalized image byte cap during publication.
 * @param input - encoded bytes and declared metadata.
 * @param limits - resolved source admission policy.
 * @param policy - resolved normalization policy.
 * @returns completion after the raster has been decoded and its normalized version proven to fit.
 */
export async function validateImageFile(
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<void> {
  await prepareImageFile(input, limits, policy)
}

/** Fully prepared normalized object, verified before any batch member is persisted. */
export interface PreparedImageFile {
  /** Deterministic normalized bytes whose digest is {@link ref.attachmentId}. */
  data: Uint8Array
  /** Durable reference describing {@link data}. */
  ref: ImageAttachmentRef
}

/**
 * Decode, normalize, and verify one submitted image without touching storage.
 * A `'verbatim'` submission skips normalization entirely after the same
 * decode verification and source admission limits: the returned bytes are the
 * submitted bytes, digested as-is, and the reference carries the detected
 * dimensions with no `originalDimensions`.
 * @param input - submitted encoded bytes, declared media type, and admission route.
 * @param limits - source admission policy.
 * @param policy - independent normalization policy; unused for a verbatim submission.
 * @returns immutable reference facts beside bytes ready for atomic publication.
 */
export async function prepareImageFile(
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<PreparedImageFile> {
  if (input.data.byteLength > limits.maxImageBytes) {
    throw new AttachmentError('Image exceeds the configured byte limit.', 'IMAGE_TOO_LARGE')
  }
  const detected = await inspectMetadata(input.data, input.mediaType, limits)
  if (input.normalization === 'verbatim') {
    const sha256 = digest(input.data)
    const name = displayName(input.name)
    return {
      data: input.data,
      ref: {
        attachmentId: AttachmentId(`sha256:${sha256}`),
        mediaType: detected.mediaType,
        width: detected.width,
        height: detected.height,
        bytes: input.data.byteLength,
        ...(name !== undefined ? { name } : {}),
      },
    }
  }
  const normalized = await normalizeImage(input.data, detected, policy)
  const sha256 = digest(normalized.data)
  const name = displayName(input.name)
  const downscaled = detected.width !== normalized.width || detected.height !== normalized.height
  return {
    data: normalized.data,
    ref: {
      attachmentId: AttachmentId(`sha256:${sha256}`),
      mediaType: normalized.mediaType,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.data.byteLength,
      ...(name !== undefined ? { name } : {}),
      ...downscaled ? { originalDimensions: { width: detected.width, height: detected.height } } : {},
    },
  }
}

/**
 * Make a directory's entries durable (fsync on a read-only directory handle).
 * A synced file alone does not survive a crash when its directory entry never
 * reached storage, so the publication directory is synced before a durable
 * reference is reported.
 */
async function syncDirectory(path: string): Promise<void> {
  /* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  /* v8 ignore stop */
}

/**
 * Create one private directory tree and persist every ancestor entry up to a
 * caller-vouched durable boundary. The walk deliberately ignores what mkdir
 * reports as newly created: a concurrent first save can create a level this
 * process then merely observes, so "already existed" is not "already durable"
 * — the entry may still be unsynced in the creator, and a crash would drop a
 * directory the session checkpoint already references. Re-syncing a durable
 * entry is harmless; skipping an unsynced one is not.
 * @param path - absolute directory to create.
 * @param boundary - absolute ancestor the caller vouches is already durable.
 */
async function ensureDurableDirectory(path: string, boundary: string): Promise<void> {
  const target = resolve(path)
  const stop = resolve(boundary)
  await mkdir(target, { recursive: true, mode: 0o700 })
  await chmod(target, 0o700)
  let level = target
  while (level !== stop) {
    const parent = dirname(level)
    await syncDirectory(parent)
    /* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */
    if (parent === level) return
    level = parent
  }
}

/**
 * Establish this process's proof that one DSH_HOME entry and every ancestor
 * below the filesystem root are durable. Mere existence is insufficient: a
 * concurrent process may have created the directory but not synced its parent.
 */
async function ensureDurableHome(path: string): Promise<string> {
  const home = resolve(path)
  if (!durableHomes.has(home)) {
    await ensureDurableDirectory(home, parse(home).root)
    durableHomes.add(home)
  }
  return home
}

/**
 * Publish immutable bytes to content-addressed storage below a versioned
 * attachment root, deduplicating by digest. Shared by every media family:
 * content addressing never encodes media type in the path, so an image and
 * a text file with identical bytes publish to the same object.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param data - encoded bytes already admitted by the caller.
 * @returns the SHA-256 digest identifying the published object.
 */
async function publishObject(root: string, data: Uint8Array): Promise<string> {
  const sha256 = digest(data)
  const bucket = join(root, 'objects', sha256.slice(0, 2))
  const staging = join(root, 'tmp')
  // Establish DSH_HOME itself against the filesystem root once per process.
  // Every process performs that proof independently, so observing a directory
  // another process created can never be mistaken for durable publication.
  const boundary = await ensureDurableHome(dirname(dirname(resolve(root))))
  await ensureDurableDirectory(bucket, boundary)
  await ensureDurableDirectory(staging, boundary)
  const temporary = join(staging, randomUUID())
  const target = objectPath(root, sha256)
  let handle
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = undefined
    try {
      await link(temporary, target)
    } catch (error) {
      /* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      const existing = new Uint8Array(await readFile(target))
      if (digest(existing) !== sha256) throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
    }
    // Persist the target entry and close a concurrent bucket-creation window
    // before the reference can reach a session checkpoint. The dedup path
    // repeats both syncs because it may observe another writer's link before
    // that writer reaches its own durability boundary.
    await syncDirectory(bucket)
    await syncDirectory(join(root, 'objects'))
    await unlink(temporary)
  } catch (error) {
    /* v8 ignore next -- A descriptor can remain open only when the underlying write/sync/close operation fails. */
    if (handle !== undefined) await handle.close().catch(
      /* v8 ignore next -- Close failure is superseded by the storage operation that entered cleanup. */
      () => {},
    )
    await unlink(temporary).catch(
      /* v8 ignore next -- The callback requires a second independent staging-unlink failure. */
      (cleanupError: unknown) => {
        /* v8 ignore next -- Cleanup is best-effort only for a staging file already removed by a failed operation. */
        if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) throw cleanupError
      },
    )
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unable to persist attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
  return sha256
}

/**
 * Read and digest-verify one content-addressed object's raw bytes. Shared by
 * every media family; format-specific re-derivation happens in the caller.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param sha256 - digest identifying the object, from an already-validated reference.
 * @param signal - optional cancellation for filesystem work.
 * @returns the verified bytes.
 * @throws the signal reason when aborted, or an AttachmentError when verification fails.
 */
async function readObject(root: string, sha256: string, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  let data: Uint8Array
  try {
    data = new Uint8Array(await readFile(objectPath(root, sha256), { signal }))
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    throw new AttachmentError('Unable to read attachment.', 'ATTACHMENT_READ_FAILED', { cause: error })
  }
  signal?.throwIfAborted()
  if (digest(data) !== sha256) throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
  return data
}

/**
 * Publish one already verified normalized image below a versioned attachment root.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param prepared - deterministic normalized bytes and reference.
 * @returns durable content-addressed normalized image reference.
 */
export async function commitPreparedImageFile(
  root: string,
  prepared: PreparedImageFile,
): Promise<ImageAttachmentRef> {
  const normalized = prepared.data
  const sha256 = ensureReference(prepared.ref)
  if (digest(normalized) !== sha256 || normalized.byteLength !== prepared.ref.bytes) {
    throw new AttachmentError('Prepared attachment bytes do not match their reference.', 'ATTACHMENT_CORRUPT')
  }
  await publishObject(root, normalized)
  return prepared.ref
}

/**
 * Decode and normalize one image once, then publish the prepared object.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - submitted encoded bytes and declared media type.
 * @param limits - resolved source admission policy.
 * @param policy - resolved normalization policy.
 * @returns durable content-addressed normalized image reference.
 */
export async function saveImageFile(
  root: string,
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<ImageAttachmentRef> {
  return commitPreparedImageFile(root, await prepareImageFile(input, limits, policy))
}

/**
 * Read and verify one content-addressed image.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - reference recorded in the session log.
 * @param signal - optional cancellation for filesystem and verification work.
 * @returns verified bytes and reference.
 * @throws the signal reason when aborted, or an AttachmentError when verification fails.
 */
export async function readImageFile(
  root: string,
  ref: ImageAttachmentRef,
  signal?: AbortSignal,
): Promise<StoredImageAttachment> {
  const sha256 = ensureReference(ref)
  const data = await readObject(root, sha256, signal)
  // The digest proves these are the exact bytes admission fully decoded, so
  // the read path only re-derives the header fields (no raster decode, no
  // per-request pixel amplification on history replay).
  const metadata = await probeImage(data)
  signal?.throwIfAborted()
  if (metadata.mediaType !== ref.mediaType || data.byteLength !== ref.bytes
    || metadata.width !== ref.width || metadata.height !== ref.height) {
    throw new AttachmentError('Stored attachment metadata does not match its reference.', 'ATTACHMENT_CORRUPT')
  }
  return { ref, data }
}

/**
 * Run the full admission policy for one text file without touching storage.
 * @param input - encoded bytes and declared metadata.
 * @param limits - resolved storage policy.
 * @returns completion after the encoded bytes have been proven non-empty and valid UTF-8.
 */
export function validateTextFile(input: SaveTextAttachment, limits: TextAttachmentLimits): Promise<void> {
  if (input.data.byteLength > limits.maxTextBytes) {
    return Promise.reject(new AttachmentError('Text exceeds the configured byte limit.', 'TEXT_TOO_LARGE'))
  }
  const invalid = checkTextValidity(input.data)
  return invalid === undefined ? Promise.resolve() : Promise.reject(invalid)
}

/**
 * Check for non-empty, valid UTF-8 bytes without throwing, so each caller
 * chooses its own error-signaling convention (synchronous throw inside an
 * `async` function vs. explicit `Promise.reject` outside one). Text formats
 * carry no self-describing byte signature the way a raster header does, so
 * admission cannot detect or cross-check the declared
 * {@link SaveTextAttachment.mediaType} against content — it validates only
 * the encoding, never the format.
 * @param data - encoded bytes already checked against the byte cap.
 * @returns the failure to report, or `undefined` when the bytes are admissible.
 */
function checkTextValidity(data: Uint8Array): AttachmentError | undefined {
  if (data.byteLength === 0) return new AttachmentError('Text is empty.', 'INVALID_TEXT')
  if (!isUtf8(data)) return new AttachmentError('Text is not valid UTF-8.', 'INVALID_TEXT')
  return undefined
}

/**
 * Save and verify immutable UTF-8 text bytes below a versioned attachment
 * root. Storage is fully shared with {@link saveImageFile}: content
 * addressing never encodes media type in the path.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - encoded bytes and declared metadata.
 * @param limits - resolved storage policy.
 * @returns durable content-addressed reference.
 */
export async function saveTextFile(root: string, input: SaveTextAttachment, limits: TextAttachmentLimits): Promise<TextAttachmentRef> {
  if (input.data.byteLength > limits.maxTextBytes) throw new AttachmentError('Text exceeds the configured byte limit.', 'TEXT_TOO_LARGE')
  const invalid = checkTextValidity(input.data)
  if (invalid !== undefined) throw invalid
  const sha256 = await publishObject(root, input.data)
  const name = displayName(input.name)
  return {
    attachmentId: AttachmentId(`sha256:${sha256}`),
    mediaType: input.mediaType,
    bytes: input.data.byteLength,
    ...(name !== undefined ? { name } : {}),
  }
}

/**
 * Read and verify one content-addressed text file.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - reference recorded in the session log.
 * @param signal - optional cancellation for filesystem and verification work.
 * @returns verified bytes and reference.
 * @throws the signal reason when aborted, or an AttachmentError when verification fails.
 */
export async function readTextFile(
  root: string,
  ref: TextAttachmentRef,
  signal?: AbortSignal,
): Promise<StoredTextAttachment> {
  const sha256 = ensureReference(ref)
  const data = await readObject(root, sha256, signal)
  // The digest proves these are the exact bytes admission already validated,
  // so the read path only re-checks the byte-length fact the reference
  // carries; UTF-8 validity is not re-derived, matching the image path's
  // decode-once-at-admission precedent.
  if (data.byteLength !== ref.bytes) {
    throw new AttachmentError('Stored attachment metadata does not match its reference.', 'ATTACHMENT_CORRUPT')
  }
  return { ref, data }
}
