// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ConversationEventRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { registerMessageConversationNode } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/message.ts'
import { scienceEditMessageDefinition } from '../src/client/science-edit-message.ts'
import { en } from '../src/client/locales.ts'

const definition = scienceEditMessageDefinition(makeTranslate(en))
const event = {
  type: 'user/message', seq: 5, time: 123, surfaceOp: 'append',
  data: { id: 'edit-1', role: 'user', content: [{ type: 'text', text: 'Private model execution context' },
    { type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1 } }],
  source: { kind: 'science-edit', instruction: 'Shorten the title', targets: [{
    artifactId: 'chart-1', logicalName: 'trend', version: 2, comment: 'Shorter',
    target: { kind: 'element', elementId: 'axes[0].title', elementKind: 'title', axes: 0, label: null, current: 'Before' },
  }, { artifactId: 'chart-1', logicalName: 'trend', version: 2,
    target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }] } },
} as const

describe('recorded Science edit messages', () => {
  it('shows only the instruction, images and exact version references while retaining durable source', () => {
    const state = definition.start({} as never, { event } as never, { previous: () => undefined })
    expect(state.content).toEqual([{ type: 'text', text: 'Shorten the title' }, event.data.content[1]])
    expect(state.source).toBe(event.data.source)
    expect(state.referenceLabels).toHaveLength(2)
    expect(state.referenceLabels?.[0]).toContain('trend v2')
    expect(state.referenceLabels?.[0]).toContain('Shorter')
    expect(state.referenceLabels?.[1]).toContain('trend v2')
    expect(definition.match(event as never)).toEqual({ id: 'edit-1', role: 'start' })
    expect(definition.match({ ...event, data: { ...event.data, source: { kind: 'user' } } } as never)).toBeNull()
    expect(definition.match({ ...event, surfaceOp: { op: 'replace', start: 1, end: 1 } } as never)).toBeNull()
  })

  it('transfers Chat ownership on registration and restores the ordinary context row on disposal', () => {
    const ctx = new Context()
    const events = new ConversationEventRegistry(ctx)
    ctx.provide('uiConversation', { events } as never)
    registerMessageConversationNode(ctx)
    const ordinary = events.entries()[0]
    expect(ordinary?.match(event as never)).not.toBeNull()
    const dispose = events.register(definition)
    expect(ordinary?.match(event as never)).toBeNull()
    expect(ordinary?.match({ ...event, data: { ...event.data, source: { kind: 'user' } } } as never)).not.toBeNull()
    expect(() => events.register({ ...definition, kind: 'duplicate-edit' })).toThrow('already owned')
    dispose()
    expect(ordinary?.match(event as never)).not.toBeNull()
  })
})

it('retains a recorded edit through updates and anchors its chat row when history is available', () => {
  const state = definition.start({} as never, { event } as never, { previous: () => undefined })
  const context = { key: 'science-edit-message:edit-1', id: 'edit-1', state }
  expect(definition.update(context as never, { event } as never)).toBe(state)
  expect(definition.buildViewNode?.({ ...context, state: undefined } as never)).toBeNull()
  expect(definition.buildViewNode?.(context as never)).toMatchObject({
    key: context.key, id: 'edit-1', kind: 'user', target: 'chat', anchorSeq: 5,
    location: { kind: 'unresolved' }, data: { content: [{ type: 'text', text: 'Shorten the title' }, event.data.content[1]] },
  })
  const location = { kind: 'step', turn: 2, step: 3 }
  expect(definition.buildViewNode?.({ ...context, start: { event, location } } as never)).toMatchObject({ location })
})

it('rejects an unrelated event routed into the Science edit start', () => {
  expect(() => definition.start({} as never, { event: { type: 'turn/start', data: { turn: 1 } } } as never, { previous: () => undefined }))
    .toThrow('Science input requires a science-edit source')
  expect(() => definition.start({} as never, { event: { ...event, data: { ...event.data, source: { kind: 'user' } } } } as never, { previous: () => undefined }))
    .toThrow('Science input requires a science-edit source')
})
