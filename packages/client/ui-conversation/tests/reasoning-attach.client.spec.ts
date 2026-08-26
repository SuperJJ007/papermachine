/** Reasoning-attach: folding pure-reasoning `assistant-step` keys onto their successor. */

import { describe, expect, it } from 'vitest'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { attachReasoningNodes } from '../src/client/chat/reasoning-attach.ts'
import { groupAdjacentToolNodes, summarizeToolGroup } from '../src/client/chat/tool-group.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'

const t = makeTranslate(zh, commonZh)

function settledTool(callId: string, name: string, over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 3, time: 3_000, callId,
    call: { name, argsRaw: '{}' }, callTime: 2_000,
    content: [], isError: false, callView: null, resultView: null, subCalls: [], ...over,
  }
}

/** A fake `assistant-step` Node carrying only the block list a test cares about. */
function assistantStep(key: string, blocks: ChatNode<'assistant-step'>['data']['blocks']): ChatNode<'assistant-step'> {
  return {
    key, kind: 'assistant-step', id: key, target: 'chat', anchorSeq: 0,
    location: { kind: 'session' }, visibility: 'visible',
    data: { status: 'settled', turn: 1, step: 1, blocks, time: 0 },
  } as never
}

/** A fake Node of any other registered kind, for a successor/boundary test. */
function other(key: string, kind: string): ChatNode {
  return {
    key, kind, id: key, target: 'chat', anchorSeq: 0,
    location: { kind: 'session' }, visibility: 'visible', data: {},
  } as never
}

const think = (key: string, text: string) => assistantStep(key, [{ kind: 'reasoning', text }])
const prose = (key: string, text: string) => assistantStep(key, [{ kind: 'text', text }])
const proseAfterThink = (key: string, reasoningText: string, text: string) =>
  assistantStep(key, [{ kind: 'reasoning', text: reasoningText }, { kind: 'text', text }])
const tool = (key: string) => other(key, 'tool-call')
const user = (key: string) => other(key, 'user')

function nodesFrom(entries: Record<string, ChatNode | undefined>) {
  return (key: string): ChatNode | undefined => entries[key]
}

describe('attachReasoningNodes', () => {
  it('Think -> tool: folds a pure-reasoning step onto the following tool-call, out of the order', () => {
    const nodes = { think1: think('think1', '思考中'), tool1: tool('tool1') }
    const result = attachReasoningNodes(['think1', 'tool1'], nodesFrom(nodes))
    expect(result.order).toEqual(['tool1'])
    expect(result.reasoningByKey).toEqual(new Map([['tool1', ['思考中']]]))
  })

  it('Think -> 正文: folds onto a following assistant-step that itself carries visible prose', () => {
    const nodes = { think1: think('think1', '先想一下'), text1: prose('text1', '好的，答案是') }
    const result = attachReasoningNodes(['think1', 'text1'], nodesFrom(nodes))
    expect(result.order).toEqual(['text1'])
    expect(result.reasoningByKey).toEqual(new Map([['text1', ['先想一下']]]))
  })

  it('Think -> Think -> tool: concatenates two adjacent pure-reasoning steps onto the same successor, in order', () => {
    const nodes = { a: think('a', '第一段'), b: think('b', '第二段'), tool1: tool('tool1') }
    const result = attachReasoningNodes(['a', 'b', 'tool1'], nodesFrom(nodes))
    expect(result.order).toEqual(['tool1'])
    expect(result.reasoningByKey).toEqual(new Map([['tool1', ['第一段', '第二段']]]))
  })

  it('Think at the turn end: a pure-reasoning step with no successor stays a standalone row', () => {
    const nodes = { u: user('u'), think1: think('think1', '仍在流式') }
    const result = attachReasoningNodes(['u', 'think1'], nodesFrom(nodes))
    expect(result.order).toEqual(['u', 'think1'])
    expect(result.reasoningByKey.size).toBe(0)
  })

  it('a pure-reasoning step followed by a non-attachable kind (a new user message) stays standalone, before it', () => {
    const nodes = { think1: think('think1', '想完了但没有后续'), u: user('u') }
    const result = attachReasoningNodes(['think1', 'u'], nodesFrom(nodes))
    expect(result.order).toEqual(['think1', 'u'])
    expect(result.reasoningByKey.size).toBe(0)
  })

  it('an assistant-step that already mixes reasoning with its own prose is not pure-reasoning, so it is never folded away', () => {
    const nodes = { mixed: proseAfterThink('mixed', '内部思考', '这是正文'), tool1: tool('tool1') }
    const result = attachReasoningNodes(['mixed', 'tool1'], nodesFrom(nodes))
    expect(result.order).toEqual(['mixed', 'tool1'])
    expect(result.reasoningByKey.size).toBe(0)
  })

  it('a key absent from the store (not yet materialized) is treated as a boundary, never folded or attached onto', () => {
    const nodes = { think1: think('think1', '悬空') }
    const result = attachReasoningNodes(['think1', 'missing'], nodesFrom(nodes))
    expect(result.order).toEqual(['think1', 'missing'])
    expect(result.reasoningByKey.size).toBe(0)
  })

  it('an empty order returns an empty order and no attachments', () => {
    const result = attachReasoningNodes([], nodesFrom({}))
    expect(result.order).toEqual([])
    expect(result.reasoningByKey.size).toBe(0)
  })

  it('leaves an order with no reasoning at all completely unchanged', () => {
    const nodes = { a: tool('a'), b: tool('b'), u: user('u') }
    const result = attachReasoningNodes(['a', 'b', 'u'], nodesFrom(nodes))
    expect(result.order).toEqual(['a', 'b', 'u'])
    expect(result.reasoningByKey.size).toBe(0)
  })

  it('a whitespace-only text block beside real reasoning still counts as pure-reasoning — the blank block is not "other visible"', () => {
    const nodes = {
      think1: assistantStep('think1', [{ kind: 'reasoning', text: '真正在想' }, { kind: 'text', text: '   ' }]),
      tool1: tool('tool1'),
    }
    const result = attachReasoningNodes(['think1', 'tool1'], nodesFrom(nodes))
    expect(result.order).toEqual(['tool1'])
    expect(result.reasoningByKey).toEqual(new Map([['tool1', ['真正在想']]]))
  })

  it('an image block beside reasoning is always visible, so the step is never pure-reasoning', () => {
    const nodes = {
      mixed: assistantStep('mixed', [{ kind: 'reasoning', text: '想了想' }, { kind: 'image', attachment: {} as never }]),
      tool1: tool('tool1'),
    }
    const result = attachReasoningNodes(['mixed', 'tool1'], nodesFrom(nodes))
    expect(result.order).toEqual(['mixed', 'tool1'])
    expect(result.reasoningByKey.size).toBe(0)
  })
})

describe('attachReasoningNodes composed with groupAdjacentToolNodes', () => {
  it('Think rows no longer split what would otherwise be one adjacent tool-call run', () => {
    // Read, Think, Glob, get_science_state: without folding, the middle Think
    // row would break this into two singleton tool-call rows and one 'single'
    // assistant-step entry — exactly the flat, ungrouped, un-titled state the
    // brief calls out.
    const nodes = {
      read: tool('read'), think1: think('think1', '看看有没有别的文件'), glob: tool('glob'), state: tool('state'),
    }
    const { order, reasoningByKey } = attachReasoningNodes(['read', 'think1', 'glob', 'state'], nodesFrom(nodes))
    const entries = groupAdjacentToolNodes(order, key => nodes[key as keyof typeof nodes]?.kind)
    expect(entries).toEqual([{ kind: 'group', groupKey: 'tool-group:read', keys: ['read', 'glob', 'state'] }])
    expect(reasoningByKey).toEqual(new Map([['glob', ['看看有没有别的文件']]]))
  })

  it('still splits on a boundary kind the fold could not attach onto (assistant prose)', () => {
    const nodes = { a: tool('a'), b: tool('b'), text: prose('text', '中间说了一句'), c: tool('c'), d: tool('d') }
    const { order } = attachReasoningNodes(['a', 'b', 'text', 'c', 'd'], nodesFrom(nodes))
    const entries = groupAdjacentToolNodes(order, key => nodes[key as keyof typeof nodes]?.kind)
    expect(entries).toEqual([
      { kind: 'group', groupKey: 'tool-group:a', keys: ['a', 'b'] },
      { kind: 'single', key: 'text' },
      { kind: 'group', groupKey: 'tool-group:c', keys: ['c', 'd'] },
    ])
  })

  it('a single tool call preceded by an attached Think still renders ungrouped — folding never manufactures a group', () => {
    const nodes = { think1: think('think1', '就查一下'), solo: tool('solo') }
    const { order } = attachReasoningNodes(['think1', 'solo'], nodesFrom(nodes))
    const entries = groupAdjacentToolNodes(order, key => nodes[key as keyof typeof nodes]?.kind)
    expect(entries).toEqual([{ kind: 'single', key: 'solo' }])
  })

  it('failures inside a Think-preceded group are still counted from the structured result, unaffected by folding', () => {
    const nodes = { think1: think('think1', '这次应该会失败'), a: tool('a'), b: tool('b') }
    const { order } = attachReasoningNodes(['think1', 'a', 'b'], nodesFrom(nodes))
    const entries = groupAdjacentToolNodes(order, key => nodes[key as keyof typeof nodes]?.kind)
    expect(entries).toEqual([{ kind: 'group', groupKey: 'tool-group:a', keys: ['a', 'b'] }])
    const roots: ToolCallBlock[] = [settledTool('a', 'bash', { isError: true }), settledTool('b', 'bash')]
    expect(summarizeToolGroup(roots, t)).toEqual({ title: '运行了 2 段代码', steps: 2, failed: 1 })
  })
})
