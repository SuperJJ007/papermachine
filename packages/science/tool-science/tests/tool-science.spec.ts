/**
 * Focused behavior tests for `@deepseek-ai/dsh-tool-science`: config
 * validation, registration/disposal, first-use binding, context rendering,
 * and the three tools — composed directly with `ctx.plugin(...)` (not
 * through the real agent loop; see `loader-composition.spec.ts` for the
 * required REAL-composition coverage).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import ScienceRuntime from '@deepseek-ai/dsh-science-runtime'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ScienceEnvironmentProfileId, ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceProjection } from '@deepseek-ai/dsh-science-session'
import * as ToolScience from '../src/index.ts'
import * as ToolScienceInvariant from '../src/invariant.ts'
import { resolveConfig } from '../src/config.ts'
import { isScienceSession, renderScienceProjection } from '../src/context.ts'
import { formatRunResult, requireScienceSession, runValueFromResult } from '../src/run.ts'
import { stateValueFromProjection } from '../src/state.ts'
import { DirectSandbox, FakeSubprocess, createFakePythonPrefix } from './harness.ts'

/** Minimal valid `ScienceProjection` fixture; callers override only what they test. */
function projectionFixture(overrides: Partial<ScienceProjection> = {}): ScienceProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'test-revision' },
    environment: null,
    runs: [],
    charts: [],
    outcome: null,
    metrics: { runCount: 0, successfulRunCount: 0, chartCount: 0, chartVersionCount: 0, outcomeRevision: 0 },
    lastScienceEventSeq: 1,
    ...overrides,
  }
}

const testSignal = new AbortController().signal

function fakeAgent(session: Session): Agent {
  return { session } as unknown as Agent
}

let root: string

beforeEach(async () => {
  // Science Runtime scratch roots must not overlap a generic sandbox temp
  // grant (os.tmpdir()/`/tmp`), so this uses a repo-relative hidden dir —
  // the same convention science-runtime's own tests use.
  root = await mkdtemp(join(process.cwd(), '.tool-science-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

interface SetupOptions {
  readonly withRuntime?: boolean
  readonly profileId?: string
  readonly modeRevision?: string
  readonly stateHistoryLimit?: number
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ScienceSessionInvariant)
  if (options.withRuntime !== false) {
    await ctx.plugin(FakeSubprocess)
    await ctx.plugin(DirectSandbox)
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { fake: { pythonPrefix: createFakePythonPrefix(root) } },
    })
  }
  const fiber = await ctx.plugin(ToolScience, {
    profileId: options.profileId ?? 'fake',
    modeRevision: options.modeRevision ?? 'test-revision',
    stateHistoryLimit: options.stateHistoryLimit ?? 2,
  })
  return { ctx, fiber }
}

function scienceSession(ctx: Context, id: string): Session {
  return ctx.sessions.create(SessionId(id), { meta: { agentPreset: 'science' } })
}

describe('config', () => {
  it('accepts a valid profileId, modeRevision, and stateHistoryLimit', () => {
    expect(resolveConfig({ profileId: 'fake-1', modeRevision: 'rev.1', stateHistoryLimit: 2 })).toEqual({
      profileId: 'fake-1',
      modeRevision: 'rev.1',
      stateHistoryLimit: 2,
    })
  })

  it.each([
    ['', 'fake-1'],
    ['has space', 'fake-1'],
    ['-leading-dash', 'fake-1'],
    ['a'.repeat(129), 'fake-1'],
  ])('rejects invalid profileId %s', (profileId) => {
    expect(() => resolveConfig({ profileId, modeRevision: 'rev', stateHistoryLimit: 2 })).toThrow(/profileId/)
  })

  it.each([
    [''],
    [' padded '],
    ['a'.repeat(129)],
  ])('rejects invalid modeRevision %s', (modeRevision) => {
    expect(() => resolveConfig({ profileId: 'fake', modeRevision, stateHistoryLimit: 2 })).toThrow(/modeRevision/)
  })

  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid stateHistoryLimit %s', (stateHistoryLimit) => {
    expect(() => resolveConfig({ profileId: 'fake', modeRevision: 'rev', stateHistoryLimit }))
      .toThrow(/stateHistoryLimit/)
  })
})

describe('registration and disposal', () => {
  it('registers the science:environment context and all three tools', async () => {
    const { ctx } = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('get_science_state')
    expect(names).toContain('run_python')
    expect(names).toContain('run_r')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.contexts.some(entry => entry.name === 'science:environment')).toBe(true)
    expect(assembly.sections.some(section => section.name === 'tool:science')).toBe(true)
  })

  it('HMR-safety: disposing the plugin fiber removes every registration', async () => {
    const { ctx, fiber } = await setup()
    await fiber.dispose()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('get_science_state')
    expect(names).not.toContain('run_python')
    expect(names).not.toContain('run_r')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.contexts.some(entry => entry.name === 'science:environment')).toBe(false)
  })
})

describe('invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(ToolScienceInvariant)
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-tool-science', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
  })
})

describe('diagnostic and non-science assembly', () => {
  it('performs no Host I/O and delegates unchanged without an Agent', async () => {
    const { ctx } = await setup()
    const assembly = await ctx.systemPrompt.assemble()
    const context = assembly.contexts.find(entry => entry.name === 'science:environment')
    expect(context?.text).toBe('')
  })

  it('renders nothing for a Standard (non-science-preset) session', async () => {
    const { ctx } = await setup()
    const session = ctx.sessions.create(SessionId('standard-session'))
    const assembly = await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    const context = assembly.contexts.find(entry => entry.name === 'science:environment')
    expect(context?.text).toBe('')
    expect(session.events.some(event => event.type === 'science/mode-bound')).toBe(false)
  })
})

describe('first-use binding', () => {
  it('binds mode then environment before step/start, and renders the post-bind context', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-first-use')

    const assembly = await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })

    const modeBound = session.events.find(event => event.type === 'science/mode-bound')
    const environmentBound = session.events.find(event => event.type === 'science/environment-bound')
    expect(modeBound).toBeDefined()
    expect(environmentBound).toBeDefined()
    expect(modeBound && environmentBound && modeBound.seq < environmentBound.seq).toBe(true)

    const context = assembly.contexts.find(entry => entry.name === 'science:environment')
    expect(context?.text).toContain('Science mode: revision test-revision.')
    expect(context?.text).toContain('status applied')
    expect(context?.text).toContain('SCIENCE_STATE_DIR')
  })

  it('leaves an unrelated context entry untouched', async () => {
    const { ctx } = await setup()
    ctx.systemPrompt.context({ name: 'unrelated', order: 50, text: 'unrelated text' })
    const session = scienceSession(ctx, 'science-unrelated-context')

    const assembly = await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })

    expect(assembly.contexts.find(entry => entry.name === 'unrelated')?.text).toBe('unrelated text')
  })

  it('does not rebind a matching resumed session', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-resumed')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    const boundOnce = session.events.filter(event => event.type === 'science/mode-bound').length
    const environmentOnce = session.events.filter(event => event.type === 'science/environment-bound').length

    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })

    expect(session.events.filter(event => event.type === 'science/mode-bound')).toHaveLength(boundOnce)
    expect(session.events.filter(event => event.type === 'science/environment-bound')).toHaveLength(environmentOnce)
  })

  it('rejects assembly on a configured mode-revision mismatch', async () => {
    const { ctx: firstCtx } = await setup({ modeRevision: 'rev-a' })
    const session = scienceSession(firstCtx, 'science-mismatch')
    await firstCtx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })

    const { ctx: secondCtx } = await setup({ modeRevision: 'rev-b' })
    const otherSession = secondCtx.sessions.create(SessionId('science-mismatch-2'), { meta: { agentPreset: 'science' }, seed: [...session.events] })
    await expect(secondCtx.systemPrompt.assemble({ agent: fakeAgent(otherSession), signal: testSignal }))
      .rejects.toThrow(/bound to Science mode revision "rev-a"/)
  })

  it('rejects assembly when no Science Runtime is mounted', async () => {
    const { ctx } = await setup({ withRuntime: false })
    const session = scienceSession(ctx, 'science-no-runtime')
    await expect(ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal }))
      .rejects.toThrow(/no Science Runtime is mounted/)
    expect(session.events.some(event => event.type === 'science/mode-bound')).toBe(true)
    expect(session.events.some(event => event.type === 'science/environment-bound')).toBe(false)
  })
})

describe('renderScienceProjection', () => {
  it('returns "" for a null projection', () => {
    expect(renderScienceProjection(null)).toBe('')
  })

  it('renders "not yet bound" before an environment exists', () => {
    const text = renderScienceProjection(projectionFixture())
    expect(text).toContain('Environment: not yet bound.')
  })

  it('renders an invalid environment reason and an unavailable interpreter', () => {
    const text = renderScienceProjection(projectionFixture({
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('fake'),
        configuredAt: 1,
        validatedAt: 1,
        status: 'invalid',
        python: { language: 'python', configuredPrefix: '/prefix', capability: 'unavailable', reason: 'missing interpreter' },
        failureReason: 'python is unavailable',
      },
    }))
    expect(text).toContain('status invalid')
    expect(text).toContain('Python: unavailable.')
    expect(text).not.toContain('python is unavailable')
    expect(text).not.toContain('missing interpreter')
  })

  it('renders an available R interpreter with a truncated fingerprint', () => {
    const text = renderScienceProjection(projectionFixture({
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('fake'),
        configuredAt: 1,
        validatedAt: 1,
        status: 'applied',
        r: {
          language: 'r',
          configuredPrefix: '/prefix',
          capability: 'available',
          canonicalPrefix: '/prefix',
          executable: '/prefix/bin/Rscript',
          executableIdentity: 'id',
          languageVersion: '4.5.0',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: 'b'.repeat(64),
        },
      },
    }))
    expect(text).toContain('R: available, version 4.5.0, fingerprint bbbbbbbbbbbb.')
  })

  it('renders the latest run summary', () => {
    const text = renderScienceProjection(projectionFixture({
      runs: [{
        runId: ScienceRunId('run-1'),
        language: 'python',
        toolCallId: CallId('call-1'),
        requestHeaderSeq: 1,
        environmentRevision: 1,
        environmentFingerprint: 'a'.repeat(64),
        startedAt: 1,
        codeSha256: 'a'.repeat(64),
        scratchKey: 'a'.repeat(64) as never,
        runDirectoryRef: 'runs/run-1/',
        status: 'running',
      }],
    }))
    expect(text).toContain('Latest run run-1 (python): running.')
  })
})

describe('isScienceSession / requireScienceSession', () => {
  it('rejects a run tool called from a non-science-preset session', async () => {
    const { ctx } = await setup()
    const session = ctx.sessions.create(SessionId('standard-for-run'))
    expect(isScienceSession(session)).toBe(false)
    expect(() => requireScienceSession({ agent: fakeAgent(session) } as never)).toThrow(/science preset/)
  })
})

describe('runValueFromResult / formatRunResult', () => {
  it('carries exitCode, signal, failureCode, and failureMessage when present', () => {
    const value = runValueFromResult({
      terminal: {
        runId: ScienceRunId('run-2'),
        language: 'python',
        toolCallId: CallId('call-2'),
        requestHeaderSeq: 1,
        environmentRevision: 1,
        environmentFingerprint: 'a'.repeat(64),
        startedAt: 1,
        codeSha256: 'a'.repeat(64),
        scratchKey: 'a'.repeat(64) as never,
        runDirectoryRef: 'runs/run-2/',
        status: 'failed',
        finishedAt: 2,
        exitCode: 1,
        signal: 'SIGKILL',
        stdoutBytes: 0,
        stderrBytes: 5,
        stdoutTruncated: true,
        stderrTruncated: true,
        failureCode: 'NONZERO_EXIT',
        failureMessage: 'process exited 1',
      },
      stdout: { text: '', bytes: 0, truncated: true },
      stderr: { text: 'boom', bytes: 5, truncated: true },
    })
    expect(value).toMatchObject({
      status: 'failed', exitCode: 1, signal: 'SIGKILL', failureCode: 'NONZERO_EXIT', failureMessage: 'process exited 1',
    })
    const text = formatRunResult(value)
    expect(text).toContain('status: failed exit 1 signal SIGKILL')
    expect(text).toContain('failureCode: NONZERO_EXIT')
    expect(text).toContain('failureMessage: process exited 1')
    expect(text).toContain('(empty)')
    expect(text).toContain('(stdout truncated)')
    expect(text).toContain('(stderr truncated)')
  })

  it('omits exitCode, signal, failureCode, and failureMessage when absent', () => {
    const value = runValueFromResult({
      terminal: {
        runId: ScienceRunId('run-3'),
        language: 'python',
        toolCallId: CallId('call-3'),
        requestHeaderSeq: 1,
        environmentRevision: 1,
        environmentFingerprint: 'a'.repeat(64),
        startedAt: 1,
        codeSha256: 'a'.repeat(64),
        scratchKey: 'a'.repeat(64) as never,
        runDirectoryRef: 'runs/run-3/',
        status: 'cancelled',
        finishedAt: 2,
        stdoutBytes: 0,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
    })
    expect(value).not.toHaveProperty('exitCode')
    expect(value).not.toHaveProperty('signal')
    expect(value).not.toHaveProperty('failureCode')
    expect(value).not.toHaveProperty('failureMessage')
    const text = formatRunResult(value)
    expect(text).toBe('status: cancelled\n--- stdout ---\n(empty)\n--- stderr ---\n(empty)')
  })
})

describe('get_science_state', () => {
  it('is concurrency-safe (a pure read)', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('get_science_state')?.isConcurrencySafe?.({})).toBe(true)
  })

  it('rejects before mode is bound', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-state-unbound')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('state-1'), name: 'get_science_state', arguments: {},
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
  })

  it('returns a sanitized bounded projection after binding', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-state-bound')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('state-2'), name: 'get_science_state', arguments: {},
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('"status": "applied"')
    expect(text).toContain('"history"')
    expect(text).not.toContain(root)
    expect(text).not.toContain('configuredPrefix')
    expect(text).not.toContain('canonicalPrefix')
    expect(text).not.toContain('"executable"')
    expect(text).not.toContain('executableIdentity')
    expect(text).not.toContain('condaHistorySha256')
  })

  it.each([
    { limit: 1, expected: ['run-3'], omitted: 2 },
    { limit: 2, expected: ['run-2', 'run-3'], omitted: 1 },
    { limit: 3, expected: ['run-1', 'run-2', 'run-3'], omitted: 0 },
  ])('caps recent run history at $limit and reports omissions', ({ limit, expected, omitted }) => {
    const runs = ['run-1', 'run-2', 'run-3'].map((runId, index) => ({
      runId: ScienceRunId(runId),
      language: 'python' as const,
      toolCallId: CallId(`call-${String(index + 1)}`),
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      startedAt: index + 1,
      codeSha256: 'b'.repeat(64),
      scratchKey: 'c'.repeat(64) as never,
      runDirectoryRef: `runs/${runId}/`,
      status: 'running' as const,
    }))
    const value = stateValueFromProjection(projectionFixture({
      runs,
      metrics: { runCount: 3, successfulRunCount: 0, chartCount: 0, chartVersionCount: 0, outcomeRevision: 0 },
    }), limit)
    expect(value.runs.map(run => (run as { runId: string }).runId)).toEqual(expected)
    expect(value.history.runsOmitted).toBe(omitted)
  })

  it.each([
    { limit: 1, expected: ['chart-3'], omitted: 2 },
    { limit: 2, expected: ['chart-2', 'chart-3'], omitted: 1 },
    { limit: 3, expected: ['chart-1', 'chart-2', 'chart-3'], omitted: 0 },
  ])('caps recent chart-version history at $limit and reports omissions', ({ limit, expected, omitted }) => {
    const charts = ['chart-1', 'chart-2', 'chart-3'].map((chartId, index) => ({
      chartId,
      logicalName: chartId,
      version: 1,
      title: chartId,
      attachment: { attachmentId: `attachment-${String(index + 1)}`, mediaType: 'image/png' },
      runId: `run-${String(index + 1)}`,
      toolCallId: `call-${String(index + 1)}`,
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      createdAt: index + 1,
    })) as unknown as ScienceProjection['charts']
    const value = stateValueFromProjection(projectionFixture({
      charts,
      metrics: { runCount: 0, successfulRunCount: 0, chartCount: 3, chartVersionCount: 3, outcomeRevision: 0 },
    }), limit)
    expect(value.charts.map(chart => (chart as { chartId: string }).chartId)).toEqual(expected)
    expect(value.history.chartVersionsOmitted).toBe(omitted)
  })

  it('exposes only sanitized interpreter facts and a fingerprint preview', () => {
    const value = stateValueFromProjection(projectionFixture({
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('fake'),
        configuredAt: 1,
        validatedAt: 2,
        status: 'applied',
        python: {
          language: 'python',
          configuredPrefix: '/secret/prefix',
          capability: 'available',
          canonicalPrefix: '/secret/canonical',
          executable: '/secret/canonical/bin/python',
          executableIdentity: 'host-file-id',
          languageVersion: '3.13.5',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: 'b'.repeat(64),
        },
      },
    }), 1)
    expect(value.environment).toEqual({
      revision: 1,
      profileId: 'fake',
      validatedAt: 2,
      status: 'applied',
      python: {
        language: 'python', capability: 'available', languageVersion: '3.13.5', fingerprint: 'b'.repeat(12),
      },
    })
    expect(JSON.stringify(value)).not.toContain('/secret')
    expect(JSON.stringify(value)).not.toContain('host-file-id')
  })

  it('retains a sanitized R-only environment without adding a Python binding', () => {
    const value = stateValueFromProjection(projectionFixture({
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('fake'),
        configuredAt: 1,
        validatedAt: 2,
        status: 'applied',
        r: {
          language: 'r',
          configuredPrefix: '/secret/prefix',
          capability: 'available',
          canonicalPrefix: '/secret/canonical',
          executable: '/secret/canonical/bin/Rscript',
          executableIdentity: 'host-file-id',
          languageVersion: '4.5.0',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: 'b'.repeat(64),
        },
      },
    }), 1)
    expect(value.environment).toEqual({
      revision: 1,
      profileId: 'fake',
      validatedAt: 2,
      status: 'applied',
      r: {
        language: 'r', capability: 'available', languageVersion: '4.5.0', fingerprint: 'b'.repeat(12),
      },
    })
  })

  it.each(['Python at /secret/prefix', String.raw`Python at C:\secret\prefix`])(
    'omits a path-bearing interpreter version %s from context and state',
    (languageVersion) => {
      const environment = {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('fake'),
        configuredAt: 1,
        validatedAt: 2,
        status: 'applied' as const,
        python: {
          language: 'python' as const,
          configuredPrefix: '/secret/prefix',
          capability: 'available' as const,
          canonicalPrefix: '/secret/canonical',
          executable: '/secret/canonical/bin/python',
          executableIdentity: 'host-file-id',
          languageVersion,
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: 'b'.repeat(64),
        },
      }
      const projection = projectionFixture({ environment })
      const renderedContext = renderScienceProjection(projection)
      const state = stateValueFromProjection(projection, 1)
      expect(renderedContext).not.toContain(languageVersion)
      expect(JSON.stringify(state)).not.toContain(languageVersion)
      expect(renderedContext).toContain(`Python: available, fingerprint ${'b'.repeat(12)}.`)
      expect(state.environment).toMatchObject({ python: { capability: 'available', fingerprint: 'b'.repeat(12) } })
      expect((state.environment as { python?: { languageVersion?: string } }).python).not.toHaveProperty('languageVersion')
    },
  )

  it('omits Runtime-owned free text that could disclose Host paths', () => {
    const run = {
      runId: ScienceRunId('failed-run'),
      language: 'python',
      toolCallId: CallId('failed-call'),
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      startedAt: 1,
      codeSha256: 'b'.repeat(64),
      scratchKey: 'c'.repeat(64) as never,
      runDirectoryRef: 'runs/failed-run/',
      status: 'failed',
      finishedAt: 2,
      exitCode: 1,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      signal: '/secret/runtime/signal',
      failureCode: 'SPAWN_FAILED',
      failureMessage: 'failed at /secret/runtime/bin/python',
    } as const
    const value = stateValueFromProjection(projectionFixture({
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('fake'),
        configuredAt: 1,
        validatedAt: 2,
        status: 'invalid',
        python: {
          language: 'python',
          configuredPrefix: '/secret/prefix',
          capability: 'invalid',
          reason: 'missing /secret/prefix/bin/python',
        },
        failureReason: 'python failed under /secret/prefix',
      },
      runs: [run],
      metrics: { runCount: 1, successfulRunCount: 0, chartCount: 0, chartVersionCount: 0, outcomeRevision: 0 },
    }), 1)
    const rendered = JSON.stringify(value)
    expect(rendered).not.toContain('/secret')
    expect(rendered).not.toContain('failureMessage')
    expect(rendered).not.toContain('failureReason')
    expect(rendered).not.toContain('"reason"')
    expect(rendered).not.toContain('"signal"')
  })

  it('omits an absent signal and retains a path-free signal label', () => {
    const run = (runId: string, signal?: string) => ({
      runId: ScienceRunId(runId),
      language: 'python' as const,
      toolCallId: CallId(`call-${runId}`),
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      startedAt: 1,
      codeSha256: 'b'.repeat(64),
      scratchKey: 'c'.repeat(64) as never,
      runDirectoryRef: `runs/${runId}/`,
      status: 'failed' as const,
      finishedAt: 2,
      exitCode: 1,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      failureCode: 'NONZERO_EXIT',
      failureMessage: 'process failed',
      ...signal === undefined ? {} : { signal },
    })
    const value = stateValueFromProjection(projectionFixture({
      runs: [run('without-signal'), run('with-signal', 'SIGTERM')],
      metrics: { runCount: 2, successfulRunCount: 0, chartCount: 0, chartVersionCount: 0, outcomeRevision: 0 },
    }), 2)
    expect(value.runs[0]).not.toHaveProperty('signal')
    expect(value.runs[0]).not.toHaveProperty('failureMessage')
    expect(value.runs[1]).toMatchObject({ signal: 'SIGTERM' })
    expect(value.runs[1]).not.toHaveProperty('failureMessage')
  })

  it('rejects without an initiating Agent', async () => {
    const { ctx } = await setup()
    const result = await ctx.tools.execute({ signal: testSignal, callId: CallId('state-3'), name: 'get_science_state', arguments: {} })
    expect(result.isError).toBe(true)
  })
})

describe('run_python', () => {
  async function boundSession(ctx: Context, id: string): Promise<Session> {
    const session = scienceSession(ctx, id)
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
    return session
  }

  it('rejects empty code before starting a run', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-run-empty')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('run-1'), name: 'run_python', arguments: { code: '   ' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('non-empty'))).toBe(true)
  })

  it('rejects when no request/header is recorded', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-run-no-header')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('run-2'), name: 'run_python', arguments: { code: 'print(1)' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('request/header'))).toBe(true)
  })

  it('rejects when no Science Runtime is mounted', async () => {
    const { ctx } = await setup({ withRuntime: false })
    const session = scienceSession(ctx, 'science-run-no-runtime')
    session.append('science/mode-bound', { version: 1, mode: { modeId: 'science', presetId: 'science', modeRevision: 'test-revision' } })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('run-3'), name: 'run_python', arguments: { code: 'print(1)' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('no Science Runtime is mounted'))).toBe(true)
  })

  it('runs source through ctx.scienceRuntime and returns the durable terminal result', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-run-success')
    const toolCallId = CallId('run-4')
    // The real agent loop logs `tool/call` before dispatching execution; this
    // direct-composition test supplies that same durable provenance fact.
    session.append('tool/call', { turn: 1, step: 1, callId: toolCallId, name: 'run_python', arguments: '{"code":"print(1)"}' })
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'run_python', arguments: { code: 'print(1)' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(true)
    const finished = session.events.find(event => event.type === 'science/run-finished')
    expect(finished?.type === 'science/run-finished' && finished.data.run.status).toBe('success')
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('status: success')
    expect(text).toContain('fake run output')
  })
})
