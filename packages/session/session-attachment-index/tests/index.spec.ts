/**
 * SessionAttachmentIndex service: registration effect discipline (duplicate
 * rejection, policy-conflict rejection, disposal), extract() dispatch across
 * every policy bucket, and the two convenience reads consumed by
 * dsh-host-apiproxy (live authorization and Session export media
 * collection).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionAttachmentIndex, { SessionAttachmentIndexError } from '../src/index.ts'

// The extractor-required paths fire only for a KNOWN event type outside the
// static policy lists. No production domain registers an extractor today, so
// the test key joins the known set for this suite's lifetime.
beforeAll(() => { (KNOWN_SESSION_EVENT_TYPES as Set<string>).add('test/media-saved') })
afterAll(() => { (KNOWN_SESSION_EVENT_TYPES as Set<string>).delete('test/media-saved') })

// Test-owned extractor-required event type: no production domain registers an
// attachment extractor any more, so the registration surface is exercised
// against a locally merged event type instead of a real domain's.
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Test-only media event carrying one optional attachment reference. */
    'test/media-saved': { readonly media?: { readonly attachment?: ImageAttachmentRef } }
  }
}

declare module '@deepseek-ai/dsh-session-attachment-index/types' {
  interface SessionAttachmentExtractorMap {
    'test/media-saved': true
  }
}

function ref(id: string): ImageAttachmentRef {
  return { attachmentId: AttachmentId(id), mediaType: 'image/png', bytes: 10, width: 1, height: 1 }
}

function textRef(id: string): TextAttachmentRef {
  return { attachmentId: AttachmentId(id), mediaType: 'text/plain', bytes: 10 }
}

function image(id: string): { type: 'image'; attachment: ImageAttachmentRef } {
  return { type: 'image', attachment: ref(id) }
}

function userMessageEvent(id: string): SessionEvent {
  return {
    type: 'user/message',
    seq: 1,
    time: 0,
    data: { content: [image(id)], source: { kind: 'human' } },
  } as unknown as SessionEvent
}

function mediaSavedEvent(id: string | undefined): SessionEvent {
  return {
    type: 'test/media-saved',
    seq: 2,
    time: 1,
    data: id === undefined ? {} : { media: { attachment: ref(id) } },
  } as unknown as SessionEvent
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionAttachmentIndex)
  return ctx
}

describe('SessionAttachmentIndex', () => {
  it('extracts a built-in carrier directly, without any registration', async () => {
    const ctx = await harness()
    expect(ctx.sessionAttachments.extract(userMessageEvent('sha256:a')).map(r => String(r.attachmentId)))
      .toEqual(['sha256:a'])
  })

  it('returns nothing for an attachment-free type', async () => {
    const ctx = await harness()
    const event = { type: 'tool/call', seq: 1, time: 0, data: { content: [image('sha256:z')] } } as unknown as SessionEvent
    expect(ctx.sessionAttachments.extract(event)).toEqual([])
  })

  it('returns nothing for an unrecognized ignorable type', async () => {
    const ctx = await harness()
    const event = { type: 'future/unknown', seq: 1, time: 0, data: {}, ignorable: true } as unknown as SessionEvent
    expect(ctx.sessionAttachments.extract(event)).toEqual([])
  })

  it('fails loud for a known extractor-required type with no live registration', async () => {
    const ctx = await harness()
    expect(() => ctx.sessionAttachments.extract(mediaSavedEvent('sha256:a'))).toThrow(SessionAttachmentIndexError)
    try {
      ctx.sessionAttachments.extract(mediaSavedEvent('sha256:a'))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SessionAttachmentIndexError)
      expect((error as SessionAttachmentIndexError).code).toBe('SESSION_ATTACHMENT_EXTRACTOR_MISSING')
    }
  })

  it('delegates to a live registered extractor for its exact event type', async () => {
    const ctx = await harness()
    ctx.sessionAttachments.register('test/media-saved', (event) => {
      const media = (event.data as { media?: { attachment?: ImageAttachmentRef } }).media
      if (media?.attachment === undefined) throw new Error('malformed media-saved event')
      return [media.attachment]
    })
    expect(ctx.sessionAttachments.extract(mediaSavedEvent('sha256:b')).map(r => String(r.attachmentId)))
      .toEqual(['sha256:b'])
  })

  it('propagates a registered extractor throwing on malformed data rather than degrading to empty', async () => {
    const ctx = await harness()
    ctx.sessionAttachments.register('test/media-saved', (event) => {
      const media = (event.data as { media?: { attachment?: ImageAttachmentRef } }).media
      if (media?.attachment === undefined) throw new Error('malformed media-saved event')
      return [media.attachment]
    })
    expect(() => ctx.sessionAttachments.extract(mediaSavedEvent(undefined))).toThrow('malformed media-saved event')
  })

  it('removes a registration through its own returned disposer', async () => {
    const ctx = await harness()
    const unregister = ctx.sessionAttachments.register('test/media-saved', event =>
      [(event.data as { media: { attachment: ImageAttachmentRef } }).media.attachment])
    expect(ctx.sessionAttachments.extract(mediaSavedEvent('sha256:c')).length).toBe(1)
    unregister()
    expect(() => ctx.sessionAttachments.extract(mediaSavedEvent('sha256:c'))).toThrow(SessionAttachmentIndexError)
  })

  it('removes a registration when its owning fiber is disposed (HMR safety)', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.sessionAttachments.register('test/media-saved', event =>
        [(event.data as { media: { attachment: ImageAttachmentRef } }).media.attachment])
    }, { inject: ['sessionAttachments'] }))
    expect(ctx.sessionAttachments.extract(mediaSavedEvent('sha256:c')).length).toBe(1)
    await fiber.dispose()
    expect(() => ctx.sessionAttachments.extract(mediaSavedEvent('sha256:c'))).toThrow(SessionAttachmentIndexError)
  })

  it('rejects a second live registration for the same key', async () => {
    const ctx = await harness()
    ctx.sessionAttachments.register('test/media-saved', () => [])
    expect(() => ctx.sessionAttachments.register('test/media-saved', () => []))
      .toThrow(/already registered/)
  })

  it('rejects registering an extractor for a type already classified built-in or attachment-free', async () => {
    const ctx = await harness()
    expect(() => ctx.sessionAttachments.register(
      // @ts-expect-error -- deliberately outside the merge-extensible key set for this negative test.
      'user/message',
      () => [],
    )).toThrow(/already classified/)
    expect(() => ctx.sessionAttachments.register(
      // @ts-expect-error -- deliberately outside the merge-extensible key set for this negative test.
      'tool/call',
      () => [],
    )).toThrow(/already classified/)
  })

  it('finds the first matching reference across an ordered event sequence', async () => {
    const ctx = await harness()
    const events = [userMessageEvent('sha256:a'), userMessageEvent('sha256:b')]
    expect(ctx.sessionAttachments.findReferencedImage(events, 'sha256:b')?.mediaType).toBe('image/png')
    expect(ctx.sessionAttachments.findReferencedImage(events, 'sha256:missing')).toBeUndefined()
  })

  it('collects every distinct reference across an ordered event sequence', async () => {
    const ctx = await harness()
    const events = [userMessageEvent('sha256:a'), userMessageEvent('sha256:b'), userMessageEvent('sha256:a')]
    const collected = ctx.sessionAttachments.collectReferencedImages(events)
    expect([...collected.keys()].sort()).toEqual(['sha256:a', 'sha256:b'])
  })

  it('finds and collects text references, filtering out image references extracted from the same event stream', async () => {
    const ctx = await harness()
    ctx.sessionAttachments.register('test/media-saved', (event) => {
      const id = (event.data as { id?: string }).id
      if (id === undefined) throw new Error('malformed mixed-media event')
      return [ref(`sha256:image-${id}`), textRef(`sha256:text-${id}`)]
    })
    const mixedEvent = (id: string): SessionEvent =>
      ({ type: 'test/media-saved', seq: 2, time: 1, data: { id } } as unknown as SessionEvent)
    const events = [mixedEvent('a'), mixedEvent('b'), mixedEvent('a')]

    expect(ctx.sessionAttachments.findReferencedText(events, 'sha256:text-b')?.mediaType).toBe('text/plain')
    expect(ctx.sessionAttachments.findReferencedText(events, 'sha256:image-a')).toBeUndefined()
    expect(ctx.sessionAttachments.findReferencedImage(events, 'sha256:text-a')).toBeUndefined()

    const collectedTexts = ctx.sessionAttachments.collectReferencedTexts(events)
    expect([...collectedTexts.keys()].sort()).toEqual(['sha256:text-a', 'sha256:text-b'])
    const collectedImages = ctx.sessionAttachments.collectReferencedImages(events)
    expect([...collectedImages.keys()].sort()).toEqual(['sha256:image-a', 'sha256:image-b'])
  })

  it('removes a text-returning registration when its owning fiber is disposed (HMR safety)', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.sessionAttachments.register('test/media-saved', () => [textRef('sha256:d')])
    }, { inject: ['sessionAttachments'] }))
    expect(ctx.sessionAttachments.findReferencedText(
      [{ type: 'test/media-saved', seq: 2, time: 1, data: {} } as unknown as SessionEvent],
      'sha256:d',
    )?.mediaType).toBe('text/plain')
    await fiber.dispose()
    expect(() => ctx.sessionAttachments.extract(mediaSavedEvent('sha256:c'))).toThrow(SessionAttachmentIndexError)
  })
})
