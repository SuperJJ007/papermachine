import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TextAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import { readTextFile, saveTextFile, validateTextFile } from '../src/store.ts'

const LIMITS: TextAttachmentLimits = {
  maxTextBytes: 16,
  mediaTypes: ['text/csv', 'application/json', 'application/vnd.vega-lite+json', 'text/markdown', 'text/plain'],
}

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-attachment-text-'))
  roots.push(value)
  return join(value, 'attachments', 'v1')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

// Admission is a from-scratch suite, not a fork of the image tests: it
// checks only byte-cap and UTF-8 validity (no raster decode, no pixel cap,
// no declared-vs-content type check — see inspectTextMetadata's doc). The
// underlying content-addressed publish/read mechanics (durability, dedup,
// corruption, cancellation) are already exercised by store.spec.ts's image
// coverage of the shared publishObject/readObject helpers this file reuses.
describe('text attachment admission', () => {
  it('rejects an empty file', async () => {
    const storageRoot = await root()
    await expect(validateTextFile({ data: new Uint8Array(0), mediaType: 'text/plain' }, LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_TEXT' })
    await expect(saveTextFile(storageRoot, { data: new Uint8Array(0), mediaType: 'text/plain' }, LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_TEXT' })
  })

  it('rejects a file exceeding the configured byte limit', async () => {
    const storageRoot = await root()
    const oversized = new TextEncoder().encode('x'.repeat(LIMITS.maxTextBytes + 1))
    await expect(validateTextFile({ data: oversized, mediaType: 'text/plain' }, LIMITS))
      .rejects.toMatchObject({ code: 'TEXT_TOO_LARGE' })
    await expect(saveTextFile(storageRoot, { data: oversized, mediaType: 'text/plain' }, LIMITS))
      .rejects.toMatchObject({ code: 'TEXT_TOO_LARGE' })
  })

  it('admits a file at the exact byte-cap boundary', async () => {
    const storageRoot = await root()
    const exact = new TextEncoder().encode('x'.repeat(LIMITS.maxTextBytes))
    await expect(validateTextFile({ data: exact, mediaType: 'text/plain' }, LIMITS)).resolves.toBeUndefined()
    const ref = await saveTextFile(storageRoot, { data: exact, mediaType: 'text/plain' }, LIMITS)
    expect(ref.bytes).toBe(LIMITS.maxTextBytes)
  })

  it('rejects invalid UTF-8', async () => {
    const storageRoot = await root()
    // A lone continuation byte can never start a valid UTF-8 sequence.
    const invalid = Uint8Array.of(0xff, 0xfe, 0xfd)
    await expect(validateTextFile({ data: invalid, mediaType: 'text/plain' }, LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_TEXT' })
    await expect(saveTextFile(storageRoot, { data: invalid, mediaType: 'text/plain' }, LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_TEXT' })
  })

  it.each([
    ['text/csv', 'a,b,c\n1,2\n'],
    ['application/json', '{"a":1}'],
    ['application/vnd.vega-lite+json', '{"mark":"bar"}'],
    ['text/markdown', '# Title\nBody.\n'],
    ['text/plain', 'plain text'],
  ] as const)('admits valid %s content and reads it back', async (mediaType, content) => {
    const storageRoot = await root()
    const data = new TextEncoder().encode(content)
    await expect(validateTextFile({ data, mediaType }, LIMITS)).resolves.toBeUndefined()
    const ref = await saveTextFile(storageRoot, { data, mediaType, name: 'notes.txt' }, LIMITS)
    expect(ref).toEqual({
      attachmentId: `sha256:${createHash('sha256').update(data).digest('hex')}`,
      mediaType,
      bytes: data.byteLength,
      name: 'notes.txt',
    })
    await expect(readTextFile(storageRoot, ref)).resolves.toEqual({ ref, data })
  })

  it('trusts the caller-declared media type: admission never inspects content format', async () => {
    // Every accepted text media type means only "valid UTF-8 bytes" at the
    // admission layer — there is no byte-level signature distinguishing them
    // the way a raster header distinguishes PNG from JPEG, so a JSON-shaped
    // body admits under any declared type.
    const storageRoot = await root()
    const data = new TextEncoder().encode('{"not":"csv"}')
    const ref = await saveTextFile(storageRoot, { data, mediaType: 'text/csv' }, LIMITS)
    expect(ref.mediaType).toBe('text/csv')
  })

  it('fails closed when a stored text object is corrupted', async () => {
    const storageRoot = await root()
    const data = new TextEncoder().encode('original')
    const ref = await saveTextFile(storageRoot, { data, mediaType: 'text/plain' }, LIMITS)
    await expect(readTextFile(storageRoot, { ...ref, bytes: ref.bytes + 1 }))
      .rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('fails closed on a missing object or an invalid reference', async () => {
    const storageRoot = await root()
    const data = new TextEncoder().encode('gone')
    const sha256 = createHash('sha256').update(data).digest('hex')
    const missingRef = {
      attachmentId: `sha256:${sha256}` as never,
      mediaType: 'text/plain' as const,
      bytes: data.byteLength,
    }
    await expect(readTextFile(storageRoot, missingRef)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
    await expect(readTextFile(storageRoot, { ...missingRef, attachmentId: 'bad' as never }))
      .rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
  })
})
