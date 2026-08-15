/**
 * REQUIRED REAL-composition evidence for `@deepseek-ai/dsh-tool-science`
 * (see `packages/AGENTS.md` and the R3 Agent Note): a test-only `cordis.yml`
 * boots the Loader and a real application composition — session store,
 * invariants, Science Session (+invariant), Science Runtime (+invariant,
 * with deterministic fake subprocess/sandbox providers), system prompt,
 * tools, agent registry, agent loop, and this Consumer (+invariant) — then
 * drives it with a scripted deterministic model. It asserts the actual first
 * model request, durable event ordering, the logged environment context,
 * the exact three Science schemas, a run result through the real tool
 * pipeline, resume behavior through real session persistence, and absence
 * from a Standard (non-science) session in the same composition.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm'
import * as ScienceRuntime from '@deepseek-ai/dsh-science-runtime'
import * as ScienceRuntimeInvariant from '@deepseek-ai/dsh-science-runtime/invariant'
import * as ScienceSession from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolScience from '../src/index.ts'
import * as ToolScienceInvariant from '../src/invariant.ts'
import { DirectSandbox, FakeSubprocess, createFakePythonPrefix } from './harness.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

const MODULES = new Map<string, unknown>([
  ['@deepseek-ai/dsh-llm', LlmRuntime],
  ['@deepseek-ai/dsh-session', SessionStore],
  ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
  ['@deepseek-ai/dsh-invariants', InvariantRegistry],
  ['@deepseek-ai/dsh-science-session', ScienceSession],
  ['@deepseek-ai/dsh-science-session/invariant', ScienceSessionInvariant],
  ['@deepseek-ai/dsh-subprocess-local', FakeSubprocess],
  ['@deepseek-ai/dsh-sandbox-local', DirectSandbox],
  ['@deepseek-ai/dsh-science-runtime', ScienceRuntime],
  ['@deepseek-ai/dsh-science-runtime/invariant', ScienceRuntimeInvariant],
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-tools', ToolRuntime],
  ['@deepseek-ai/dsh-agent', AgentRegistry],
  ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  ['@deepseek-ai/dsh-tool-science', ToolScience],
  ['@deepseek-ai/dsh-tool-science/invariant', ToolScienceInvariant],
])

let configRoot: string | undefined
let scratchRoot: string | undefined
let context: Context | undefined

beforeEach(async () => {
  // Repo-relative (not os.tmpdir()) — Science Runtime scratch roots must not
  // overlap a generic sandbox temp grant.
  configRoot = await mkdtemp(join(process.cwd(), '.tool-science-loader-config-'))
  scratchRoot = await mkdtemp(join(process.cwd(), '.tool-science-loader-scratch-'))
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (configRoot !== undefined) await rm(configRoot, { recursive: true, force: true })
  if (scratchRoot !== undefined) await rm(scratchRoot, { recursive: true, force: true })
  configRoot = undefined
  scratchRoot = undefined
})

/** Boot the real application composition through a `cordis.yml` and the Loader. */
async function boot(): Promise<Context> {
  const root = configRoot!
  const scratch = scratchRoot!
  const pythonPrefix = createFakePythonPrefix(scratch)
  const persistenceRoot = join(scratch, 'persistence')
  const dshHome = join(scratch, 'dsh-home')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: ${JSON.stringify(persistenceRoot)}`,
    "- name: '@deepseek-ai/dsh-invariants'",
    '  config:',
    '    enabled: true',
    "- name: '@deepseek-ai/dsh-science-session'",
    "- name: '@deepseek-ai/dsh-science-session/invariant'",
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-sandbox-local'",
    "- name: '@deepseek-ai/dsh-science-runtime'",
    '  config:',
    `    dshHome: ${JSON.stringify(dshHome)}`,
    '    profiles:',
    '      fake:',
    `        pythonPrefix: ${JSON.stringify(pythonPrefix)}`,
    "- name: '@deepseek-ai/dsh-science-runtime/invariant'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    "- name: '@deepseek-ai/dsh-tool-science'",
    '  config:',
    '    profileId: fake',
    '    modeRevision: test-revision',
    "- name: '@deepseek-ai/dsh-tool-science/invariant'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!MODULES.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return MODULES.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function pluginContextTexts(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event =>
    event.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
      ? event.data.content.flatMap(block => (block.type === 'text' ? [block.text] : []))
      : [])
}

describe('tool-science real Loader + agent-loop composition through cordis.yml', () => {
  it('binds, contextualizes, and runs through the real tool pipeline; resumes; and stays absent from a Standard session', async () => {
    const ctx = await boot()
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'run_python', { code: 'print(1)' }),
      textResponse('done'),
      toolCallResponse('call-2', 'run_python', { code: 'print(2)' }),
      textResponse('done again'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)

    // Exactly three Science schemas — the whole composition's tool roster.
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['get_science_state', 'run_python', 'run_r'])

    const sessionId = SessionId('tool-science-real-session')
    const handle = await ctx.agents.create({
      sessionId,
      meta: { agentPreset: 'science' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const agent = handle.agent

    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run print(1)' }], source: { kind: 'user' } }))
    await idle

    // The actual first model request carries the logged environment context.
    expect(adapter.requests).toHaveLength(2)
    const firstRequestTexts = adapter.requests[0]!.messages
      .filter(message => message.source.kind === 'plugin' && message.source.plugin === '@deepseek-ai/dsh-system-prompt')
      .flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])))
    expect(firstRequestTexts.some(text => text.includes('Science mode: revision test-revision.'))).toBe(true)
    expect(firstRequestTexts.some(text => text.includes('status applied'))).toBe(true)

    // Durable event ordering.
    const log = agent.session.events
    const seqOf = (type: string): number | undefined => log.find(event => event.type === type)?.seq
    const modeBoundSeq = seqOf('science/mode-bound')
    const environmentBoundSeq = seqOf('science/environment-bound')
    const stepStartSeq = seqOf('step/start')
    const requestHeaderSeq = seqOf('request/header')
    const toolCallSeq = seqOf('tool/call')
    const runStartedSeq = seqOf('science/run-started')
    const toolResultSeq = seqOf('tool/result')
    const runFinishedSeq = seqOf('science/run-finished')
    expect(modeBoundSeq).toBeDefined()
    expect(environmentBoundSeq).toBeDefined()
    expect(stepStartSeq).toBeDefined()
    expect(requestHeaderSeq).toBeDefined()
    expect(toolCallSeq).toBeDefined()
    expect(runStartedSeq).toBeDefined()
    expect(toolResultSeq).toBeDefined()
    expect(runFinishedSeq).toBeDefined()
    expect(modeBoundSeq!).toBeLessThan(environmentBoundSeq!)
    expect(environmentBoundSeq!).toBeLessThan(stepStartSeq!)
    expect(stepStartSeq!).toBeLessThan(requestHeaderSeq!)
    expect(requestHeaderSeq!).toBeLessThan(toolCallSeq!)
    expect(toolCallSeq!).toBeLessThan(runStartedSeq!)
    expect(runStartedSeq!).toBeLessThan(runFinishedSeq!)
    expect(runFinishedSeq!).toBeLessThanOrEqual(toolResultSeq!)

    // A real run result through the tool pipeline.
    const result = log.find(event => event.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.content[0]?.isError).toBe(false)
    const finished = log.find(event => event.type === 'science/run-finished')
    expect(finished?.type === 'science/run-finished' && finished.data.run.status).toBe('success')

    // Resume: dispose the live agent, then resume the exact persisted session.
    await handle.dispose()
    const modeBoundBeforeResume = log.filter(event => event.type === 'science/mode-bound').length
    const environmentBoundBeforeResume = log.filter(event => event.type === 'science/environment-bound').length

    const resumed = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const resumedAgent = resumed.agent
    const resumedIdle = waitForIdle(ctx, resumedAgent)
    resumedAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'run it again' }], source: { kind: 'user' } }))
    await resumedIdle

    expect(adapter.requests).toHaveLength(4)
    const resumedLog = resumedAgent.session.events
    expect(resumedLog.filter(event => event.type === 'science/mode-bound')).toHaveLength(modeBoundBeforeResume)
    expect(resumedLog.filter(event => event.type === 'science/environment-bound')).toHaveLength(environmentBoundBeforeResume)
    expect(pluginContextTexts(resumedLog).some(text => text.includes('Science mode: revision test-revision.'))).toBe(true)
    expect(resumedLog.filter(event => event.type === 'science/run-started')).toHaveLength(2)
    expect(resumedLog.filter(event => event.type === 'science/run-finished')).toHaveLength(2)
    await resumed.dispose()

    // Absence from a Standard (non-science-preset) session in the same composition.
    const standardAdapter = new MockAdapter([textResponse('ok')])
    ctx.llm.registerAdapter(['standard-mock'], standardAdapter)
    const standardHandle = await ctx.agents.create({
      sessionId: SessionId('tool-science-standard-session'),
      agentOptions: { provider: 'standard-mock', model: 'mock' },
    })
    const standardAgent = standardHandle.agent
    const standardIdle = waitForIdle(ctx, standardAgent)
    standardAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await standardIdle

    expect(standardAgent.session.events.some(event => event.type.startsWith('science/'))).toBe(false)
    expect(pluginContextTexts(standardAgent.session.events).every(text => !text.includes('Science mode'))).toBe(true)
    await standardHandle.dispose()
  }, 30_000)
})
