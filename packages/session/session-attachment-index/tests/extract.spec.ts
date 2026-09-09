/** Built-in carrier scanner: every content shape it descends into, and what it ignores. */

import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { extractBuiltInAttachments } from '../src/extract.ts'

function ref(id: string): ImageAttachmentRef {
  return { attachmentId: AttachmentId(id), mediaType: 'image/png', bytes: 10, width: 1, height: 1 }
}

function image(id: string): { type: 'image'; attachment: ImageAttachmentRef } {
  return { type: 'image', attachment: ref(id) }
}

describe('extractBuiltInAttachments', () => {
  it('scans direct content', () => {
    const refs = extractBuiltInAttachments({ type: 'user/message', data: { content: [image('sha256:a')] } })
    expect(refs.map(r => String(r.attachmentId))).toEqual(['sha256:a'])
  })

  it('scans wrapped message content', () => {
    const refs = extractBuiltInAttachments({
      type: 'assistant/message',
      data: { message: { content: [image('sha256:b')] } },
    })
    expect(refs.map(r => String(r.attachmentId))).toEqual(['sha256:b'])
  })

  it('scans every inserted message', () => {
    const refs = extractBuiltInAttachments({
      type: 'agent/inbox/spliced',
      data: { inserted: [{ content: [image('sha256:c')] }, { content: [image('sha256:d')] }] },
    })
    expect(refs.map(r => String(r.attachmentId))).toEqual(['sha256:c', 'sha256:d'])
  })

  it('descends into nested tool-result content', () => {
    const refs = extractBuiltInAttachments({
      type: 'user/message',
      data: { content: [{ type: 'tool-result', content: [image('sha256:e')] }] },
    })
    expect(refs.map(r => String(r.attachmentId))).toEqual(['sha256:e'])
  })

  it('scans a completed assistant/chunk block-end image block', () => {
    const refs = extractBuiltInAttachments({
      type: 'assistant/chunk',
      data: { chunk: { type: 'block-end', block: image('sha256:f') } },
    })
    expect(refs.map(r => String(r.attachmentId))).toEqual(['sha256:f'])
  })

  it('ignores a non-block-end assistant/chunk', () => {
    const refs = extractBuiltInAttachments({
      type: 'assistant/chunk',
      data: { chunk: { type: 'block-start', block: image('sha256:g') } },
    })
    expect(refs).toEqual([])
  })

  it('is purely content-shape-driven and does not itself gate on event.type', () => {
    // The scanner has no policy opinion — `SessionAttachmentIndex.extract()`
    // (tested separately) never calls it for `tool/call`, whose real
    // arguments are an opaque JSON string with no `content` field, because
    // that type is statically classified attachment-free.
    const refs = extractBuiltInAttachments({
      type: 'tool/call',
      data: { content: [image('sha256:h')] },
    })
    expect(refs.map(r => String(r.attachmentId))).toEqual(['sha256:h'])
  })

  it('ignores non-object and non-array content entries', () => {
    expect(extractBuiltInAttachments({ type: 'user/message', data: { content: 'not-an-array' } })).toEqual([])
    expect(extractBuiltInAttachments({
      type: 'user/message',
      data: { content: [null, 'text', 42, ['nested-array']] },
    })).toEqual([])
  })

  it('ignores an image block with a non-object attachment', () => {
    const refs = extractBuiltInAttachments({
      type: 'user/message',
      data: { content: [{ type: 'image', attachment: 'not-an-object' }] },
    })
    expect(refs).toEqual([])
  })

  it('returns nothing for an event with no recognized carrier field', () => {
    expect(extractBuiltInAttachments({ type: 'turn/start', data: { turn: 1 } })).toEqual([])
  })
})
