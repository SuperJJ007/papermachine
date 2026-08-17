/**
 * The Science Details entry's own session-scoped attachment loader: resolves
 * through `ISessions.binding(id)?.session.readAttachment`, converts to a
 * `data:` URI with no persistent cache, and fails loud for an unknown
 * session binding or a Host-rejected read.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createScienceImageLoader } from '../src/client/science-attachment-loader.ts'

const SESSION = 'session-1' as SessionId

function attachment(over: Partial<ImageAttachmentRef> = {}): ImageAttachmentRef {
  return {
    attachmentId: 'sha256:abc' as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 4,
    width: 10,
    height: 10,
    ...over,
  }
}

function sessionsOf(readAttachment: unknown): ISessions {
  return {
    binding: (id: string) => id === SESSION ? { sessionId: SESSION, session: { readAttachment }, ctx: {} } : undefined,
  } as unknown as ISessions
}

describe('createScienceImageLoader', () => {
  it('resolves a data: URI from the session-authorized bytes', async () => {
    const data = Uint8Array.from([1, 2, 3, 4])
    const readAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { attachment: attachment({ mediaType: 'image/png' }), data },
    })
    const load = createScienceImageLoader(sessionsOf(readAttachment), SESSION)
    const url = await load(attachment())
    expect(url).toBe(`data:image/png;base64,${Buffer.from(data).toString('base64')}`)
    expect(readAttachment).toHaveBeenCalledWith('sha256:abc')
  })

  it('encodes bytes spanning multiple base64 chunks identically to a single-chunk encode', async () => {
    const data = new Uint8Array(0x8000 + 10).fill(7)
    const readAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { attachment: attachment(), data },
    })
    const load = createScienceImageLoader(sessionsOf(readAttachment), SESSION)
    const url = await load(attachment())
    expect(url).toBe(`data:image/png;base64,${Buffer.from(data).toString('base64')}`)
  })

  it('rejects when the session resolves no binding', async () => {
    const load = createScienceImageLoader(sessionsOf(vi.fn()), 'unknown-session' as SessionId)
    await expect(load(attachment())).rejects.toThrow(/resolved no binding/)
  })

  it('rejects when the Host declines the read', async () => {
    const readAttachment = vi.fn().mockResolvedValue({ ok: false, error: { code: 'not-found', message: 'gone' } })
    const load = createScienceImageLoader(sessionsOf(readAttachment), SESSION)
    await expect(load(attachment())).rejects.toThrow('not-found: gone')
  })
})
