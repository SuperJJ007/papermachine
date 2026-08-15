import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmError  } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function fail(message: string, code: string): () => never {
  return () => {
    throw new LlmError(message, code)
  }
}

describe('agent/request-error', () => {
  it('does not offer middleware failures to request recovery', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-narrow'), { provider: 'mock', model: 'mock' })
    let recoveries = 0
    ctx.on('agent/request', () => {
      throw new LlmError('middleware failed', 'MIDDLEWARE')
    })
    ctx.on('agent/request-error', async () => {
      recoveries += 1
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(recoveries).toBe(0)
    expect(adapter.requests).toHaveLength(0)
  })

  it('lets each failed request return a retry action before its turn closes', async () => {
    const adapter = new MockAdapter([
      fail('busy', 'RATE_LIMIT'),
      fail('unavailable', 'SERVICE_UNAVAILABLE'),
      textResponse('ok'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-retry'), { provider: 'mock', model: 'mock' })
    const seen: {
      turn: number
      step: number
      failure: LlmFailure
      retryPolicy: ResolvedRetryPolicy | undefined
    }[] = []
    const statuses: string[] = []
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent) statuses.push(status)
    })
    ctx.on('agent/request-error', async ({ agent: subject, turn, step, failure, retryPolicy }) => {
      expect(subject).toBe(agent)
      seen.push({ turn, step, failure, retryPolicy })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(seen.map(item => ({
      turn: item.turn,
      step: item.step,
      code: item.failure.code,
    }))).toEqual([
      {
        turn: 1,
        step: 1,
        code: 'RATE_LIMIT',
      },
      {
        turn: 1,
        step: 1,
        code: 'SERVICE_UNAVAILABLE',
      },
    ])
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(seen.map(item => item.retryPolicy)).toEqual([
      expect.objectContaining({ mode: 'normal' }),
      expect.objectContaining({ mode: 'normal' }),
    ])
    expect(statuses).toEqual(['running', 'idle'])
  })

  it('lets cancellation win over a retry action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-cancel'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.cancel({ kind: 'user' })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })
  })

  it('restores a compaction-replaced runtime context before a retried request', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-restore'), { provider: 'mock', model: 'mock' })

    ctx.on('agent/request-error', async ({ agent: subject }) => {
      const contextEvent = subject.session.events.find(event =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
      if (contextEvent?.type === 'user/message') {
        subject.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'compacted summary' }],
          source: { kind: 'plugin', plugin: 'test-compaction' },
        }), {
          surfaceOp: { op: 'replace', start: contextEvent.seq, end: contextEvent.seq },
          sourceEventSeqs: [contextEvent.seq],
        })
      }
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const runtimeContexts = agent.session.events.flatMap(event =>
      event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
        ? [event]
        : [])
    expect(runtimeContexts).toHaveLength(2)
    expect(runtimeContexts[1]?.data.content).toEqual([{
      type: 'text',
      text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nMode: read-only.',
    }])
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]?.messages.some(message =>
      message.source.kind === 'plugin'
      && message.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(true)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'request/header')).toHaveLength(1)
  })

  it('does not duplicate an unchanged runtime context across a retry', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-stable'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async () => ({ kind: 'retry' }))

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const runtimeContexts = agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(runtimeContexts).toHaveLength(1)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]?.messages.some(message =>
      message.source.kind === 'plugin'
      && message.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(true)
  })

  it('restores the cleared marker before a retry after compaction removes it', async () => {
    const adapter = new MockAdapter([textResponse('one'), fail('busy', 'RATE_LIMIT'), textResponse('two')])
    const ctx = await harness(adapter)
    const dispose = ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-clear-retry'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    dispose()

    let retried = false
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      if (!retried) {
        retried = true
        const cleared = subject.session.events.find(event =>
          event.type === 'user/message'
          && event.data.source.kind === 'plugin'
          && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
          && event.data.content.some(block => block.type === 'text' && block.text.startsWith('Current runtime context: none')))
        if (cleared?.type === 'user/message') {
          subject.session.append('user/message', createUserMessage({
            content: [{ type: 'text', text: 'compacted' }],
            source: { kind: 'plugin', plugin: 'test-compaction' },
          }), {
            surfaceOp: { op: 'replace', start: cleared.seq, end: cleared.seq },
            sourceEventSeqs: [cleared.seq],
          })
        }
      }
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const runtimeContexts = agent.session.events.flatMap(event =>
      event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
        ? [event]
        : [])
    // context (turn 1), cleared (turn 2 pre-step), restored-cleared (after retry).
    expect(runtimeContexts).toHaveLength(3)
    expect(runtimeContexts[2]?.data.content).toEqual([{
      type: 'text',
      text: 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.',
    }])
    expect(adapter.requests).toHaveLength(3)
  })

  it('does not restore runtime context after an unrelated replacement during a retry', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-unrelated'), { provider: 'mock', model: 'mock' })

    ctx.on('agent/request-error', async ({ agent: subject }) => {
      const userEvent = subject.session.events.find(event =>
        event.type === 'user/message' && event.data.source.kind === 'user')
      if (userEvent?.type === 'user/message') {
        subject.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'unrelated summary' }],
          source: { kind: 'plugin', plugin: 'test-compaction' },
        }), {
          surfaceOp: { op: 'replace', start: userEvent.seq, end: userEvent.seq },
          sourceEventSeqs: [userEvent.seq],
        })
      }
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const runtimeContexts = agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(runtimeContexts).toHaveLength(1)
    expect(adapter.requests).toHaveLength(2)
  })

  it('does not bypass an authoritative pre-step removal on the first attempt or retry', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-pre-step-removal'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      return decision.kind === 'reject' ? decision : {
        ...decision,
        messages: decision.messages.filter(message =>
          message.source.kind !== 'plugin'
          || message.source.plugin !== '@deepseek-ai/dsh-system-prompt'),
      }
    })
    ctx.on('agent/request-error', async () => ({ kind: 'retry' }))

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests.every(request => request.messages.every(message =>
      message.source.kind !== 'plugin'
      || message.source.plugin !== '@deepseek-ai/dsh-system-prompt'))).toBe(true)
    expect(agent.session.events.some(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(false)
  })

  it('restores the exact pre-step rewrite after retry recovery removes it', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-pre-step-rewrite'), { provider: 'mock', model: 'mock' })
    const rewrittenText = 'Authoritative rewritten runtime context.'
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      return decision.kind === 'reject' ? decision : {
        ...decision,
        messages: decision.messages.map(message =>
          message.source.kind === 'plugin'
          && message.source.plugin === '@deepseek-ai/dsh-system-prompt'
            ? { ...message, content: [{ type: 'text' as const, text: rewrittenText }] }
            : message),
      }
    })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      const contextEvent = subject.session.events.find(event =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
      if (contextEvent?.type === 'user/message') {
        subject.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'compacted summary' }],
          source: { kind: 'plugin', plugin: 'test-compaction' },
        }), {
          surfaceOp: { op: 'replace', start: contextEvent.seq, end: contextEvent.seq },
          sourceEventSeqs: [contextEvent.seq],
        })
      }
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const runtimeContexts = agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(runtimeContexts).toHaveLength(2)
    expect(runtimeContexts.every(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === rewrittenText))).toBe(true)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests.every(request => request.messages.some(message =>
      message.source.kind === 'plugin'
      && message.source.plugin === '@deepseek-ai/dsh-system-prompt'
      && message.content.some(block => block.type === 'text' && block.text === rewrittenText)))).toBe(true)
  })

  it('preserves the final owned context appended by the authoritative pre-step batch', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-pre-step-final-owned'), { provider: 'mock', model: 'mock' })
    const finalText = 'Final authoritative runtime context.'
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      return decision.kind === 'reject' ? decision : {
        ...decision,
        messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text: finalText }],
          source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
        })],
      }
    })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      const contextEvent = subject.session.events.findLast(event =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
      if (contextEvent?.type === 'user/message') {
        subject.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'compacted summary' }],
          source: { kind: 'plugin', plugin: 'test-compaction' },
        }), {
          surfaceOp: { op: 'replace', start: contextEvent.seq, end: contextEvent.seq },
          sourceEventSeqs: [contextEvent.seq],
        })
      }
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests.every(request => request.messages.some(message =>
      message.source.kind === 'plugin'
      && message.source.plugin === '@deepseek-ai/dsh-system-prompt'
      && message.content.some(block => block.type === 'text' && block.text === finalText)))).toBe(true)
    const runtimeContexts = agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(runtimeContexts).toHaveLength(3)
    const last = runtimeContexts.at(-1)
    expect(last?.type === 'user/message' && last.data.content.some(block =>
      block.type === 'text' && block.text === finalText)).toBe(true)
  })

  it('restores the exact first-request message after a same-text replacement with a new id', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-same-text-new-id'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      const contextEvent = subject.session.events.findLast(event =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
      if (contextEvent?.type === 'user/message') {
        subject.session.append('user/message', createUserMessage({
          content: contextEvent.data.content,
          source: contextEvent.data.source,
        }), {
          surfaceOp: { op: 'replace', start: contextEvent.seq, end: contextEvent.seq },
          sourceEventSeqs: [contextEvent.seq],
        })
      }
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const runtimeContexts = agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(runtimeContexts).toHaveLength(3)
    const ids = runtimeContexts.map(event => event.type === 'user/message' && event.data.id)
    expect(ids[1]).not.toBe(ids[0])
    expect(ids[2]).toBe(ids[0])
  })

  it('restores current context after pre-step pressure replacement and preserves it on retry', async () => {
    const adapter = new MockAdapter([textResponse('first'), fail('busy', 'RATE_LIMIT'), textResponse('second')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'policy', order: 0, text: 'Mode: read-only.' })
    const agent = ctx.agentLoop.create(SessionId('request-error-context-pre-step-surface-removal'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      const retained = subject.session.events.find(event =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
      if (retained?.type === 'user/message') {
        subject.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'pre-step replacement' }],
          source: { kind: 'plugin', plugin: 'pre-step-owner' },
        }), {
          surfaceOp: { op: 'replace', start: retained.seq, end: retained.seq },
          sourceEventSeqs: [retained.seq],
        })
      }
      return next()
    })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      const retained = subject.session.events.findLast(event =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
      if (retained?.type === 'user/message') {
        subject.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'request-error replacement' }],
          source: { kind: 'plugin', plugin: 'request-error-owner' },
        }), {
          surfaceOp: { op: 'replace', start: retained.seq, end: retained.seq },
          sourceEventSeqs: [retained.seq],
        })
      }
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(3)
    for (const request of adapter.requests.slice(1)) {
      expect(request.messages.some(message =>
        message.source.kind === 'plugin'
        && message.source.plugin === '@deepseek-ai/dsh-system-prompt'
        && message.content.some(block => block.type === 'text' && block.text.includes('Mode: read-only.')))).toBe(true)
    }
    const runtimeContexts = agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(runtimeContexts).toHaveLength(3)
    const restoredIds = runtimeContexts.map(event => event.type === 'user/message' && event.data.id)
    expect(restoredIds[1]).toBe(restoredIds[0])
    expect(restoredIds[2]).toBe(restoredIds[0])
  })

  it('does not retry when the recovery listener fails before returning its action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-recovery-failed'), {
      provider: 'mock',
      model: 'mock',
    })
    ctx.on('agent/request-error', async () => {
      throw new Error('recovery failed')
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error' } },
    })
  })
})
