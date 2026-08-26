/** Generic Tool grouping: adjacency folding, category classification, and title generation. */

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChatConversationViewNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  classifyToolCategory, groupAdjacentToolNodes, resolveGroupRoots, summarizeToolGroup,
} from '../src/client/chat/tool-group.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

function settled(callId: string, name: string, over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 3, time: 3_000, callId,
    call: { name, argsRaw: '{}' }, callTime: 2_000,
    content: [], isError: false, callView: null, resultView: null, subCalls: [], ...over,
  }
}

function running(callId: string, name: string): RunningToolCall {
  return { callId, name, argsRaw: '{}', turn: 1, step: 1, time: 2_000, callView: null, subCalls: [] }
}

describe('classifyToolCategory', () => {
  it.each<[string, string | undefined, ReturnType<typeof classifyToolCategory>]>([
    ['run_python', undefined, 'run'],
    ['run_r', undefined, 'run'],
    ['bash', undefined, 'run'],
    ['pwsh', 'terminal', 'run'],
    ['read', undefined, 'read'],
    ['glob', undefined, 'read'],
    ['grep', undefined, 'read'],
    ['grep', 'search', 'read'],
    ['custom_reader', 'read', 'read'],
    ['web_search', undefined, 'search'],
    ['web_fetch', undefined, 'search'],
    ['custom_web', 'web', 'search'],
    ['write', undefined, 'edit'],
    ['edit', undefined, 'edit'],
    ['custom_writer', 'diff', 'edit'],
    ['skill', undefined, 'skill'],
    ['todo_write', undefined, 'other'],
    ['ask_user_question', undefined, 'other'],
  ])('classifies %s (card %s) as %s', (name, card, expected) => {
    expect(classifyToolCategory(name, card)).toBe(expected)
  })
})

describe('groupAdjacentToolNodes', () => {
  const kindOf = (kinds: Record<string, string>) => (key: string): string | undefined => kinds[key]

  it('leaves a lone tool-call key ungrouped', () => {
    const entries = groupAdjacentToolNodes(['a'], kindOf({ a: 'tool-call' }))
    expect(entries).toEqual([{ kind: 'single', key: 'a' }])
  })

  it('folds two or more adjacent tool-call keys into one group', () => {
    const entries = groupAdjacentToolNodes(['a', 'b', 'c'], kindOf({ a: 'tool-call', b: 'tool-call', c: 'tool-call' }))
    expect(entries).toEqual([{ kind: 'group', groupKey: 'tool-group:a', keys: ['a', 'b', 'c'] }])
  })

  it('splits a tool-call run wherever assistant text (or any other kind) interrupts it', () => {
    const entries = groupAdjacentToolNodes(
      ['a', 'b', 'text', 'c', 'd'],
      kindOf({ a: 'tool-call', b: 'tool-call', text: 'assistant-step', c: 'tool-call', d: 'tool-call' }),
    )
    expect(entries).toEqual([
      { kind: 'group', groupKey: 'tool-group:a', keys: ['a', 'b'] },
      { kind: 'single', key: 'text' },
      { kind: 'group', groupKey: 'tool-group:c', keys: ['c', 'd'] },
    ])
  })

  it('keeps a single tool-call flanked by other kinds ungrouped on both sides', () => {
    const entries = groupAdjacentToolNodes(
      ['u', 'a', 'text'],
      kindOf({ u: 'user', a: 'tool-call', text: 'assistant-step' }),
    )
    expect(entries).toEqual([
      { kind: 'single', key: 'u' },
      { kind: 'single', key: 'a' },
      { kind: 'single', key: 'text' },
    ])
  })

  it('groups a trailing run at the end of the order with no closing boundary', () => {
    const entries = groupAdjacentToolNodes(['u', 'a', 'b'], kindOf({ u: 'user', a: 'tool-call', b: 'tool-call' }))
    expect(entries).toEqual([
      { kind: 'single', key: 'u' },
      { kind: 'group', groupKey: 'tool-group:a', keys: ['a', 'b'] },
    ])
  })

  it('returns no entries for an empty order', () => {
    expect(groupAdjacentToolNodes([], () => undefined)).toEqual([])
  })
})

describe('summarizeToolGroup', () => {
  it('names one category and its count for a uniform group', () => {
    const roots: ToolCallBlock[] = [settled('a', 'read'), settled('b', 'glob'), settled('c', 'grep')]
    const summary = summarizeToolGroup(roots, t)
    expect(summary).toEqual({ title: '读取了 3 个文件', steps: 3, failed: 0 })
  })

  it('joins mixed categories in a fixed display order, each with its own count', () => {
    const roots: ToolCallBlock[] = [
      settled('a', 'write'), settled('b', 'run_python'), settled('c', 'run_r'), settled('d', 'read'),
    ]
    const summary = summarizeToolGroup(roots, t)
    expect(summary.title).toBe('运行了 2 段代码，读取了 1 个文件，保存或编辑了 1 个文件')
  })

  it('counts only settled failures, from the structured result, never a running or successful call', () => {
    const roots: ToolCallBlock[] = [
      settled('a', 'bash', { isError: true }),
      settled('b', 'bash', { isError: false }),
      running('c', 'bash'),
    ]
    const summary = summarizeToolGroup(roots, t)
    expect(summary).toEqual({ title: '运行了 3 段代码', steps: 3, failed: 1 })
  })

  it('produces an empty title for an empty member list', () => {
    expect(summarizeToolGroup([], t)).toEqual({ title: '', steps: 0, failed: 0 })
  })

  it('buckets a windowless call head (no `call`) as "other" rather than throwing', () => {
    const summary = summarizeToolGroup([settled('a', 'bash', { call: null }), settled('b', 'bash')], t)
    expect(summary.title).toBe('运行了 1 段代码，执行了 1 项操作')
  })
})

describe('resolveGroupRoots', () => {
  function nodesFrom(entries: Record<string, ChatConversationViewNode | undefined>): ConversationSnapshot['chat']['nodes'] {
    return { get: (key: string) => entries[key], values: () => Object.values(entries).filter(v => v !== undefined) }
  }

  it('resolves each member\'s root Tool lifecycle in flow order', () => {
    const rootA = settled('a', 'bash')
    const rootB = settled('b', 'read')
    const nodes = nodesFrom({
      a: { key: 'a', kind: 'tool-call', id: 'a', target: 'chat', anchorSeq: 1, location: { kind: 'session' }, visibility: 'visible', data: { root: rootA } } as never,
      b: { key: 'b', kind: 'tool-call', id: 'b', target: 'chat', anchorSeq: 2, location: { kind: 'session' }, visibility: 'visible', data: { root: rootB } } as never,
    })
    expect(resolveGroupRoots(['a', 'b'], nodes)).toEqual([rootA, rootB])
  })

  it('drops a member key with no materialized Node, or one materialized as a different kind', () => {
    const rootA = settled('a', 'bash')
    const nodes = nodesFrom({
      a: { key: 'a', kind: 'tool-call', id: 'a', target: 'chat', anchorSeq: 1, location: { kind: 'session' }, visibility: 'visible', data: { root: rootA } } as never,
      other: { key: 'other', kind: 'user', id: 'other', target: 'chat', anchorSeq: 2, location: { kind: 'session' }, visibility: 'visible', data: {} } as never,
    })
    expect(resolveGroupRoots(['missing', 'other', 'a'], nodes)).toEqual([rootA])
  })
})
