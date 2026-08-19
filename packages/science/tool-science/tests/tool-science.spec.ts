/**
 * Focused behavior tests for `@deepseek-ai/dsh-tool-science`: config
 * validation, registration/disposal, first-use binding, context rendering,
 * and the five tools — composed directly with `ctx.plugin(...)` (not
 * through the real agent loop; see `loader-composition.spec.ts` for the
 * required REAL-composition coverage).
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { TextMediaType } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import ScienceRuntime from '@deepseek-ai/dsh-science-runtime'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { replayScience, ScienceArtifactId, ScienceEnvironmentProfileId, ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactVersion, ScienceProjection } from '@deepseek-ai/dsh-science-session'
import * as ToolScience from '../src/index.ts'
import * as ToolScienceInvariant from '../src/invariant.ts'
import { resolveConfig } from '../src/config.ts'
import { isScienceSession, renderScienceProjection } from '../src/context.ts'
import { scienceArtifactPresentation } from '../src/presentation.ts'
import { formatOutcomeResult, isMessageFact } from '../src/publish-outcome.ts'
import type { ScienceOutcomeResultValue } from '../src/publish-outcome.ts'
import { artifactReceiptFromArtifact, formatArtifactReceipt } from '../src/annotate-artifact.ts'
import type { ScienceArtifactReceiptValue } from '../src/annotate-artifact.ts'
import { formatRunResult, requireScienceSession, runValueFromResult } from '../src/run.ts'
import { stateValueFromProjection } from '../src/state.ts'
import { DirectSandbox, FakeSubprocess, createFakePythonPrefix } from './harness.ts'

/** Minimal valid `ScienceProjection` fixture; callers override only what they test. */
function projectionFixture(overrides: Partial<ScienceProjection> = {}): ScienceProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'test-revision' },
    environment: null,
    runs: [],
    kernels: [],
    artifacts: [],
    outcome: null,
    metrics: {
      runCount: 0,
      successfulRunCount: 0,
      artifactCount: 0,
      artifactVersionCount: 0,
      kernelCount: 0,
      outcomeRevision: 0,
    },
    lastScienceEventSeq: 1,
    ...overrides,
  }
}

/** Minimal valid `ScienceArtifactVersion` fixture (image attachment); callers override only what they test. */
function artifactVersionFixture(overrides: Partial<ScienceArtifactVersion> = {}): ScienceArtifactVersion {
  return {
    artifactId: ScienceArtifactId('artifact-1'),
    logicalName: 'file',
    version: 1,
    title: 'file',
    origin: 'auto',
    attachment: { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: 10, width: 2, height: 2 },
    runId: ScienceRunId('run-1'),
    toolCallId: CallId('call-1'),
    requestHeaderSeq: 1,
    environmentRevision: 1,
    environmentFingerprint: 'a'.repeat(64),
    createdAt: 1000,
    ...overrides,
  }
}

const testSignal = new AbortController().signal

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

function fakeAgent(session: Session): Agent {
  return { session } as unknown as Agent
}

/** Append the durable request and named tool-call facts for one turn. */
function authorizeToolCall(
  session: Session, turn: number, name: string, id: string,
): ReturnType<typeof CallId> {
  session.append('step/start', { turn, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial',
  })
  const toolCallId = CallId(id)
  session.append('tool/call', { turn, step: 1, callId: toolCallId, name, arguments: '{}' })
  return toolCallId
}

/** The authorizing facts one durable run makes available to an artifact version it produces. */
interface RunProvenance {
  readonly runId: ReturnType<typeof ScienceRunId>
  readonly toolCallId: ReturnType<typeof CallId>
  readonly requestHeaderSeq: number
  readonly environmentRevision: number
  readonly environmentFingerprint: string
}

/**
 * Directly append one `origin: 'auto'` artifact version citing `run`'s own
 * authorizing facts — the durable shape `dsh-science-runtime`'s real capture
 * walk appends, for a file `FakeSubprocess` cannot itself write (it returns
 * fixed output, never a real process that writes to `SCIENCE_ARTIFACT_DIR`).
 * Persists a real attachment through the mounted `ctx.attachments` first, so
 * the seeded event references a real content-addressed ref exactly as
 * capture would.
 */
async function seedAutoArtifact(
  ctx: Context, session: Session, run: RunProvenance, logicalName: string,
  data: Uint8Array, mediaType: 'image/png' | TextMediaType,
): Promise<ScienceArtifactVersion> {
  const attachment = mediaType === 'image/png'
    ? await ctx.attachments.saveImage({ data, mediaType: 'image/png', name: logicalName })
    : await ctx.attachments.saveText({ data, mediaType, name: logicalName })
  const artifact: ScienceArtifactVersion = {
    artifactId: ScienceArtifactId(randomUUID()),
    logicalName,
    version: 1,
    title: logicalName,
    origin: 'auto',
    attachment,
    runId: run.runId,
    toolCallId: run.toolCallId,
    requestHeaderSeq: run.requestHeaderSeq,
    environmentRevision: run.environmentRevision,
    environmentFingerprint: run.environmentFingerprint,
    createdAt: Date.now(),
  }
  session.append('science/artifact-saved', { version: 1, artifact })
  return artifact
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
    await ctx.plugin(LocalAttachmentStore, { dshHome: join(root, 'dsh-home') })
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

/** Bind Science mode/environment on first use, then open turn 1's step/start and request/header. */
async function boundSession(ctx: Context, id: string): Promise<Session> {
  const session = scienceSession(ctx, id)
  await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
  return session
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
          packages: [{ name: 'base', version: '4.5.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
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

  it('resolves true for a session switched to `science` while blank, even though its frozen header still names the preset it was created with', async () => {
    // `resolveSessionPreset` (`@deepseek-ai/dsh-agent-presets`), not the
    // creation header alone: a blank session recomposed to `science` records
    // only an `agent-preset/selected` event, and every host reader — the
    // API gateway, transcript presenters, resume/adoption — already resolves
    // the same way for the same reason.
    const { ctx } = await setup()
    const session = ctx.sessions.create(SessionId('standard-then-switched-to-science'), { meta: { agentPreset: 'standard' } })
    expect(isScienceSession(session)).toBe(false)
    session.append('agent-preset/selected', { agentPreset: 'science' })
    expect(isScienceSession(session)).toBe(true)
    expect(requireScienceSession({ agent: fakeAgent(session) } as never)).toBe(session)
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

  /** Bare success terminal shared by the capture-receipt tests below. */
  function successTerminal(): Parameters<typeof runValueFromResult>[0]['terminal'] {
    return {
      runId: ScienceRunId('run-capture'),
      language: 'python',
      toolCallId: CallId('call-capture'),
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      startedAt: 1,
      codeSha256: 'a'.repeat(64),
      scratchKey: 'a'.repeat(64) as never,
      runDirectoryRef: 'runs/run-capture/',
      status: 'success',
      finishedAt: 2,
      exitCode: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    }
  }

  it('appends a plural captured-artifacts receipt mixing image and non-image entries, and both skip/truncation flags', () => {
    const image = artifactVersionFixture({
      logicalName: 'plot.png',
      version: 1,
      attachment: {
        attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`), mediaType: 'image/png', bytes: 500, width: 10, height: 20,
        name: 'plot.png',
      },
    })
    const csv = artifactVersionFixture({
      logicalName: 'summary.csv',
      version: 1,
      attachment: { attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`), mediaType: 'text/csv', bytes: 2048 },
    })
    const value = runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
      capture: { captured: [image, csv], skippedOversizedCount: 3, truncatedPerRun: true, truncatedPerSession: true, appendFailed: false },
    })
    expect(value.capturedArtifacts).toEqual([
      {
        artifactId: 'artifact-1', logicalName: 'plot.png', version: 1, mediaType: 'image/png', bytes: 500, width: 10, height: 20,
        title: 'file', attachmentId: `sha256:${'b'.repeat(64)}`, attachmentName: 'plot.png',
      },
      {
        artifactId: 'artifact-1', logicalName: 'summary.csv', version: 1, mediaType: 'text/csv', bytes: 2048,
        title: 'file', attachmentId: `sha256:${'c'.repeat(64)}`,
      },
    ])
    expect(value.captureSkippedOversizedCount).toBe(3)
    expect(value.captureTruncatedPerRun).toBe(true)
    expect(value.captureTruncatedPerSession).toBe(true)
    const text = formatRunResult(value)
    expect(text).toContain('Captured 2 artifacts: `plot.png` v1 (image/png, 10x20, 500 B), `summary.csv` v1 (text/csv, 2.0 KB).')
    expect(text).toContain('(3 eligible file(s) skipped: too large to capture)')
    expect(text).toContain('(more eligible files existed than this run\'s capture limit admits; the rest were not captured)')
    expect(text).toContain('(this session\'s artifact-capture limit was reached; further eligible files were not captured)')
  })

  it('appends a singular captured-artifact receipt in the megabyte band, omitting skip/truncation flags at zero/false', () => {
    const large = artifactVersionFixture({
      logicalName: 'dataset.json',
      version: 1,
      attachment: { attachmentId: AttachmentId(`sha256:${'d'.repeat(64)}`), mediaType: 'application/json', bytes: 3 * 1024 * 1024 },
    })
    const value = runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
      capture: { captured: [large], skippedOversizedCount: 0, truncatedPerRun: false, truncatedPerSession: false, appendFailed: false },
    })
    expect(value).not.toHaveProperty('captureSkippedOversizedCount')
    expect(value).not.toHaveProperty('captureTruncatedPerRun')
    expect(value).not.toHaveProperty('captureTruncatedPerSession')
    const text = formatRunResult(value)
    expect(text).toContain('Captured 1 artifact: `dataset.json` v1 (application/json, 3.0 MB).')
    expect(text).not.toContain('eligible file(s) skipped')
    expect(text).not.toContain('capture limit')
  })

  it('omits the captured-artifacts line entirely when capture ran but produced nothing', () => {
    const value = runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
      capture: { captured: [], skippedOversizedCount: 0, truncatedPerRun: false, truncatedPerSession: false, appendFailed: false },
    })
    expect(value.capturedArtifacts).toEqual([])
    const text = formatRunResult(value)
    expect(text).not.toContain('Captured')
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
      metrics: { runCount: 3, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, kernelCount: 0, outcomeRevision: 0 },
    }), limit)
    expect(value.runs.map(run => (run as { runId: string }).runId)).toEqual(expected)
    expect(value.history.runsOmitted).toBe(omitted)
  })

  it.each([
    { limit: 1, expected: ['artifact-3'], omitted: 2 },
    { limit: 2, expected: ['artifact-2', 'artifact-3'], omitted: 1 },
    { limit: 3, expected: ['artifact-1', 'artifact-2', 'artifact-3'], omitted: 0 },
  ])('caps recent artifact-version history at $limit and reports omissions', ({ limit, expected, omitted }) => {
    const artifacts = ['artifact-1', 'artifact-2', 'artifact-3'].map((artifactId, index) => ({
      artifactId,
      logicalName: artifactId,
      version: 1,
      title: artifactId,
      origin: 'model',
      attachment: { attachmentId: `attachment-${String(index + 1)}`, mediaType: 'image/png', bytes: 10, width: 2, height: 2 },
      runId: `run-${String(index + 1)}`,
      toolCallId: `call-${String(index + 1)}`,
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      createdAt: index + 1,
    })) as unknown as ScienceProjection['artifacts']
    const value = stateValueFromProjection(projectionFixture({
      artifacts,
      metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 3, artifactVersionCount: 3, kernelCount: 0, outcomeRevision: 0 },
    }), limit)
    expect(value.artifacts.map(artifact => (artifact as { artifactId: string }).artifactId)).toEqual(expected)
    expect(value.history.artifactVersionsOmitted).toBe(omitted)
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
          packages: [{ name: 'pip', version: '24.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
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
          packages: [{ name: 'base', version: '4.5.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
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
          packages: [{ name: 'pip', version: '24.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
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
      metrics: { runCount: 1, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, kernelCount: 0, outcomeRevision: 0 },
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
      metrics: { runCount: 2, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, kernelCount: 0, outcomeRevision: 0 },
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
    // FakeSubprocess writes no real artifact files, so capture ran and found
    // nothing: the presentation is null, not an empty-artifacts card.
    expect(result.meta).toBeNull()
  })

  it('presentationMeta projects every captured file (image and non-image) into one clickable-reference list', async () => {
    const { ctx } = await setup()
    const tool = ctx.tools.get('run_python')
    if (tool?.output.presentationMeta === undefined) throw new Error('unreachable: run_python always declares presentationMeta')
    const presentationMeta = (args: unknown, resultValue: JsonValue): JsonValue => tool.output.presentationMeta!(args, resultValue)
    const value = {
      status: 'success', runId: 'run-1', startedAt: 1, finishedAt: 2,
      stdout: { text: '', bytes: 0, truncated: false }, stderr: { text: '', bytes: 0, truncated: false },
      capturedArtifacts: [
        {
          artifactId: 'artifact-1', logicalName: 'plot.png', version: 1, mediaType: 'image/png', bytes: 500,
          width: 10, height: 20, title: 'plot.png', attachmentId: 'sha256:abc', attachmentName: 'plot.png',
        },
        {
          artifactId: 'artifact-2', logicalName: 'summary.csv', version: 1, mediaType: 'text/csv', bytes: 8,
          title: 'summary.csv', attachmentId: 'sha256:def',
        },
      ],
    } as never
    expect(presentationMeta({}, value)).toEqual({
      kind: 'science/artifact',
      version: 1,
      artifacts: [
        {
          artifactId: 'artifact-1', logicalName: 'plot.png', version: 1, title: 'plot.png',
          attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 500, width: 10, height: 20, name: 'plot.png' },
        },
        {
          artifactId: 'artifact-2', logicalName: 'summary.csv', version: 1, title: 'summary.csv',
          attachment: { attachmentId: 'sha256:def', mediaType: 'text/csv', bytes: 8 },
        },
      ],
    })
  })

  it('presentationMeta is null when capturedArtifacts is entirely absent (the non-quiescent settlement path)', async () => {
    const { ctx } = await setup()
    const tool = ctx.tools.get('run_python')
    if (tool?.output.presentationMeta === undefined) throw new Error('unreachable: run_python always declares presentationMeta')
    const presentationMeta = (args: unknown, resultValue: JsonValue): JsonValue => tool.output.presentationMeta!(args, resultValue)
    const value = {
      status: 'success', runId: 'run-1', startedAt: 1, finishedAt: 2,
      stdout: { text: '', bytes: 0, truncated: false }, stderr: { text: '', bytes: 0, truncated: false },
    } as never
    expect(presentationMeta({}, value)).toBeNull()
  })

  it('rejects a nested Code Mode sub-dispatch before Runtime lookup or side effects', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-run-nested')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('run-5'), name: 'run_python', arguments: { code: 'print(1)' },
      agent: fakeAgent(session), parent: Symbol('run_code') as ToolExecutionToken,
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('nested Code Mode sub-dispatch'))).toBe(true)
    // No side effect reached: no run was published and no scratch/Runtime work occurred.
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('rejects a nested run_r sub-dispatch the same way', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-run-r-nested')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('run-6'), name: 'run_r', arguments: { code: '1 + 1' },
      agent: fakeAgent(session), parent: Symbol('run_code') as ToolExecutionToken,
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('run_r cannot run'))).toBe(true)
  })
})

describe('artifactReceiptFromArtifact / formatArtifactReceipt', () => {
  it('omits caption and the attachment name when both are absent from the durable artifact', () => {
    const value = artifactReceiptFromArtifact({
      artifactId: ScienceArtifactId('artifact-1'),
      logicalName: 'main.png',
      version: 1,
      title: 'Main plot',
      origin: 'model',
      attachment: { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: 10, width: 2, height: 2 },
      runId: ScienceRunId('run-1'),
      toolCallId: CallId('call-1'),
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      createdAt: 1000,
    })
    expect(value).not.toHaveProperty('caption')
    expect(value).not.toHaveProperty('attachmentName')
    expect(formatArtifactReceipt(value)).not.toContain('caption:')
  })

  it('curates a non-image artifact without width/height', () => {
    const value = artifactReceiptFromArtifact({
      artifactId: ScienceArtifactId('artifact-1'),
      logicalName: 'summary.csv',
      version: 1,
      title: 'Summary',
      origin: 'model',
      attachment: { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'text/csv', bytes: 10 },
      runId: ScienceRunId('run-1'),
      toolCallId: CallId('call-1'),
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      createdAt: 1000,
    })
    expect(value).not.toHaveProperty('width')
    expect(value).not.toHaveProperty('height')
    expect(formatArtifactReceipt(value)).toBe('artifact "summary.csv" v1 (artifact-1) curated from run run-1\ntitle: Summary\ntext/csv, 10 bytes')
  })
})

describe('scienceArtifactPresentation', () => {
  it('returns null for an empty artifact list', () => {
    expect(scienceArtifactPresentation([])).toBeNull()
  })

  it('tags a single-item list as version 1', () => {
    const presentation = scienceArtifactPresentation([{
      artifactId: 'artifact-1', logicalName: 'plot.png', version: 2, title: 'Main plot',
      attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 10, width: 2, height: 2 },
    }])
    expect(presentation).toEqual({
      kind: 'science/artifact',
      version: 1,
      artifacts: [{
        artifactId: 'artifact-1', logicalName: 'plot.png', version: 2, title: 'Main plot',
        attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 10, width: 2, height: 2 },
      }],
    })
  })

  it('carries every entry in a multi-artifact list, in the given order', () => {
    const presentation = scienceArtifactPresentation([
      {
        artifactId: 'artifact-1', logicalName: 'summary.csv', version: 1, title: 'summary.csv',
        attachment: { attachmentId: 'sha256:a', mediaType: 'text/csv', bytes: 4 },
      },
      {
        artifactId: 'artifact-2', logicalName: 'plot.png', version: 1, title: 'plot.png',
        attachment: { attachmentId: 'sha256:b', mediaType: 'image/png', bytes: 8, width: 4, height: 4 },
      },
    ]) as { artifacts: { logicalName: string }[] }
    expect(presentation.artifacts.map(item => item.logicalName)).toEqual(['summary.csv', 'plot.png'])
  })
})

describe('isMessageFact', () => {
  function withEvents(events: readonly { seq: number; type: string }[]): Session {
    return { events } as unknown as Session
  }

  it('recognizes every message-bearing carrier the durable fold tracks', () => {
    expect(isMessageFact(withEvents([{ seq: 1, type: 'user/message' }]), 1)).toBe(true)
    expect(isMessageFact(withEvents([{ seq: 1, type: 'assistant/message' }]), 1)).toBe(true)
    expect(isMessageFact(withEvents([{ seq: 1, type: 'tool/result' }]), 1)).toBe(true)
  })

  it('rejects a seq naming a non-message event or no event at all', () => {
    expect(isMessageFact(withEvents([{ seq: 1, type: 'tool/call' }]), 1)).toBe(false)
    expect(isMessageFact(withEvents([]), 1)).toBe(false)
  })
})

describe('annotate_artifact', () => {
  /** Bind, then run_python to a durable success, through the real tool registry. */
  async function runSuccessfully(ctx: Context, session: Session, id: string): Promise<RunProvenance> {
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    const toolCallId = authorizeToolCall(session, 1, 'run_python', id)
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'run_python', arguments: { code: 'print(1)' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    const started = session.events.find(event => event.type === 'science/run-started')
    if (started?.type !== 'science/run-started') throw new Error('tool-science test: missing science/run-started')
    return started.data.run
  }

  it('curates an already-captured artifact and returns a text receipt without file bytes or the internal attachment id', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-success')
    const run = await runSuccessfully(ctx, session, 'science-annotate-run')
    await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'Main plot', caption: 'A caption' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    // Curating the capture retitles it: the reader gets one titled result,
    // not a titled copy standing beside the untitled original.
    expect(text).toContain('artifact "plot.png" v1')
    expect(text).toContain('title: Main plot')
    expect(text).toContain('caption: A caption')
    expect(text).not.toMatch(/sha256:/)
    // Two durable saves (the capture and its curation), one version.
    expect(session.events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(2)
    expect(replayScience(session.events)?.artifacts.map(a => a.version)).toEqual([1])
    if (result.isError) throw new Error('unreachable')
    const value = result.value as unknown as ScienceArtifactReceiptValue
    expect(value.artifactId).toBeTypeOf('string')
    expect(value).toMatchObject({ version: 1, origin: 'model', mediaType: 'image/png', caption: 'A caption' })
    expect(result.meta).toMatchObject({
      kind: 'science/artifact', version: 1,
      artifacts: [{ version: 1, title: 'Main plot', attachment: { mediaType: 'image/png' } }],
    })
  })

  it('curates a captured non-image artifact into a clickable reference too, now that the presentation generalizes past image-only', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-text-success')
    const run = await runSuccessfully(ctx, session, 'science-annotate-text-run')
    await seedAutoArtifact(ctx, session, run, 'summary.csv', Buffer.from('a,b\n1,2\n'), 'text/csv')
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-text-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'summary.csv', title: 'Result summary' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    const value = result.value as unknown as ScienceArtifactReceiptValue
    expect(value).not.toHaveProperty('width')
    expect(value).not.toHaveProperty('height')
    expect(result.meta).toMatchObject({
      kind: 'science/artifact', version: 1,
      artifacts: [{ logicalName: 'summary.csv', title: 'Result summary', attachment: { mediaType: 'text/csv' } }],
    })
  })

  it('omits the presentation attachment name when the durable attachment carries none', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-no-name')
    const run = await runSuccessfully(ctx, session, 'science-annotate-no-name-run')
    const attachment = await ctx.attachments.saveImage({ data: PNG, mediaType: 'image/png' })
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: ScienceArtifactId(randomUUID()),
        logicalName: 'plot.png',
        version: 1,
        title: 'plot.png',
        origin: 'auto',
        attachment,
        runId: run.runId,
        toolCallId: run.toolCallId,
        requestHeaderSeq: run.requestHeaderSeq,
        environmentRevision: run.environmentRevision,
        environmentFingerprint: run.environmentFingerprint,
        createdAt: Date.now(),
      },
    })
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-no-name-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'Main plot' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    expect(result.meta).toMatchObject({ artifacts: [{ attachment: { mediaType: 'image/png' } }] })
    const meta = result.meta as { artifacts: { attachment: Record<string, unknown> }[] }
    expect(meta.artifacts[0]?.attachment).not.toHaveProperty('name')
  })

  it('rejects an empty title before it reaches the Runtime', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-annotate-empty-title')
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-empty-title-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: '   ' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('title must be a non-empty string'))).toBe(true)
  })

  it('rejects when no request/header is recorded', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-no-header')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('science-annotate-no-header-call'), name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'main' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('no request/header is recorded'))).toBe(true)
  })

  it('retitles one version for a repeat logical_name, retaining the artifactId', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-versions')
    const run = await runSuccessfully(ctx, session, 'science-annotate-versions-run')
    await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const firstCall = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-versions-1')
    const first = await ctx.tools.execute({
      signal: testSignal, callId: firstCall, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'v2' },
      agent: fakeAgent(session),
    })
    const secondCall = authorizeToolCall(session, 3, 'annotate_artifact', 'science-annotate-versions-2')
    const second = await ctx.tools.execute({
      signal: testSignal, callId: secondCall, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'v3' },
      agent: fakeAgent(session),
    })
    if (first.isError || second.isError) throw new Error('unreachable')
    const firstValue = first.value as unknown as ScienceArtifactReceiptValue
    const secondValue = second.value as unknown as ScienceArtifactReceiptValue
    // Two curation calls over one captured result retitle it twice; neither
    // is a new result, so the reader keeps seeing one version.
    expect(firstValue.version).toBe(1)
    expect(secondValue.artifactId).toBe(firstValue.artifactId)
    expect(secondValue.version).toBe(1)
    const artifacts = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'plot.png')
    expect(artifacts?.map(a => a.version)).toEqual([1])
    expect(artifacts?.at(0)?.title).toBe('v3')
  })

  it('curates an exact named version rather than defaulting to latest', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-explicit-version')
    const run = await runSuccessfully(ctx, session, 'science-annotate-explicit-version-run')
    await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-explicit-version-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', version: 1, title: 'Named version' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    const value = result.value as unknown as ScienceArtifactReceiptValue
    expect(value.version).toBe(1)
    expect(value.title).toBe('Named version')
  })

  it('rejects a nested Code Mode sub-dispatch before Runtime lookup or side effects', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-annotate-nested')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('science-annotate-nested-call'), name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'main' },
      agent: fakeAgent(session), parent: Symbol('run_code') as ToolExecutionToken,
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('annotate_artifact cannot run'))).toBe(true)
  })

  it('rejects when no Science Runtime is mounted', async () => {
    const { ctx } = await setup({ withRuntime: false })
    const session = scienceSession(ctx, 'science-annotate-no-runtime')
    session.append('science/mode-bound', { version: 1, mode: { modeId: 'science', presetId: 'science', modeRevision: 'test-revision' } })
    const toolCallId = authorizeToolCall(session, 1, 'annotate_artifact', 'science-annotate-no-runtime-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'main' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('no Science Runtime is mounted'))).toBe(true)
  })

  it('surfaces the Runtime rejection for an unknown logical_name', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-annotate-unknown-name')
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-unknown-name-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'does-not-exist.csv', title: 'main' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('no artifact named'))).toBe(true)
  })
})

describe('publish_outcome', () => {
  it('publishes revision 1 citing a successful run, then revision 2 citing a message', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-outcome-success')
    const runCall = authorizeToolCall(session, 2, 'run_python', 'science-outcome-run')
    const runResult = await ctx.tools.execute({
      signal: testSignal, callId: runCall, name: 'run_python', arguments: { code: 'print(1)' },
      agent: fakeAgent(session),
    })
    expect(runResult.isError).toBe(false)
    const started = session.events.find(event => event.type === 'science/run-started')
    if (started?.type !== 'science/run-started') throw new Error('tool-science test: missing science/run-started')
    const runId = String(started.data.run.runId)
    const run = started.data.run
    // Auto-capture always runs immediately after its own source run's
    // terminal fact commits, so the durable event it appends carries that
    // run's own (necessarily latest-at-the-time) requestHeaderSeq; seeding it
    // here, before any later turn's request/header exists, matches that.
    const captured = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const messageSeq = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'note' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    const publishCall = authorizeToolCall(session, 3, 'publish_outcome', 'science-outcome-publish-1')
    const first = await ctx.tools.execute({
      signal: testSignal, callId: publishCall, name: 'publish_outcome',
      arguments: {
        title: 'First result', summary_markdown: 'It worked.',
        evidence: [{ kind: 'run', run_id: runId }],
      },
      agent: fakeAgent(session),
    })
    expect(first.isError).toBe(false)
    if (first.isError) throw new Error('unreachable')
    expect(first.value).toMatchObject({ revision: 1, title: 'First result' })
    expect(session.events.some(event => event.type === 'science/outcome-published')).toBe(true)
    const secondCall = authorizeToolCall(session, 4, 'publish_outcome', 'science-outcome-publish-2')
    const second = await ctx.tools.execute({
      signal: testSignal, callId: secondCall, name: 'publish_outcome',
      arguments: {
        title: 'Updated result', summary_markdown: 'Still true, see the note.',
        evidence: [{ kind: 'message', seq: messageSeq }],
      },
      agent: fakeAgent(session),
    })
    if (second.isError) throw new Error('unreachable')
    const secondValue = second.value as unknown as ScienceOutcomeResultValue
    expect(secondValue.revision).toBe(2)
    expect(second.meta).toMatchObject({ kind: 'science/outcome', version: 1, revision: 2 })

    const thirdCall = authorizeToolCall(session, 6, 'publish_outcome', 'science-outcome-publish-3')
    const third = await ctx.tools.execute({
      signal: testSignal, callId: thirdCall, name: 'publish_outcome',
      arguments: {
        title: 'With a chart', summary_markdown: 'See the chart.',
        evidence: [{ kind: 'chart', chart_id: String(captured.artifactId), version: 1 }],
      },
      agent: fakeAgent(session),
    })
    if (third.isError) throw new Error('unreachable')
    const thirdValue = third.value as unknown as ScienceOutcomeResultValue
    expect(third.value).toMatchObject({
      revision: 3, evidence: [{ kind: 'chart', chart_id: String(captured.artifactId), version: 1 }],
    })
    expect(formatOutcomeResult(thirdValue)).toContain(`- chart ${String(captured.artifactId)}@1`)
  })

  it('rejects an empty title before it reaches the durable codec', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-outcome-empty-title')
    const messageSeq = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'note' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    const toolCallId = authorizeToolCall(session, 2, 'publish_outcome', 'science-outcome-empty-title-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'publish_outcome',
      arguments: { title: '   ', summary_markdown: 's', evidence: [{ kind: 'message', seq: messageSeq }] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('title must be a non-empty string'))).toBe(true)
  })

  it('rejects when Science mode is not yet bound', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-outcome-not-bound')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('science-outcome-not-bound-call'), name: 'publish_outcome',
      arguments: { title: 't', summary_markdown: 's', evidence: [{ kind: 'message', seq: 0 }] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('Science mode is not bound'))).toBe(true)
  })

  it('rejects when no request/header is recorded', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-outcome-no-header')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('science-outcome-no-header-call'), name: 'publish_outcome',
      arguments: { title: 't', summary_markdown: 's', evidence: [{ kind: 'message', seq: 0 }] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('no request/header is recorded'))).toBe(true)
  })

  it('rejects a nested Code Mode sub-dispatch before validation or append', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-outcome-nested')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('science-outcome-nested-call'), name: 'publish_outcome',
      arguments: { title: 't', summary_markdown: 's', evidence: [{ kind: 'message', seq: 0 }] },
      agent: fakeAgent(session), parent: Symbol('run_code') as ToolExecutionToken,
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('publish_outcome cannot run'))).toBe(true)
    expect(session.events.some(event => event.type === 'science/outcome-published')).toBe(false)
  })

  it('rejects empty evidence', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-outcome-empty-evidence')
    const toolCallId = authorizeToolCall(session, 2, 'publish_outcome', 'science-outcome-empty-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'publish_outcome',
      arguments: { title: 't', summary_markdown: 's', evidence: [] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('evidence must be non-empty'))).toBe(true)
  })

  it('rejects duplicate evidence references', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-outcome-dup-evidence')
    const messageSeq = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'note' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    const toolCallId = authorizeToolCall(session, 2, 'publish_outcome', 'science-outcome-dup-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'publish_outcome',
      arguments: {
        title: 't', summary_markdown: 's',
        evidence: [{ kind: 'message', seq: messageSeq }, { kind: 'message', seq: messageSeq }],
      },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('duplicate evidence reference'))).toBe(true)
  })

  it('rejects evidence citing a run, chart, or message that does not exist', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-outcome-missing-evidence')
    const runCall = authorizeToolCall(session, 2, 'publish_outcome', 'science-outcome-missing-run')
    const runRejection = await ctx.tools.execute({
      signal: testSignal, callId: runCall, name: 'publish_outcome',
      arguments: { title: 't', summary_markdown: 's', evidence: [{ kind: 'run', run_id: 'nope' }] },
      agent: fakeAgent(session),
    })
    expect(runRejection.isError).toBe(true)
    expect(runRejection.content.some(block => block.type === 'text' && block.text.includes('is not a successful prior run'))).toBe(true)

    const chartCall = authorizeToolCall(session, 3, 'publish_outcome', 'science-outcome-missing-chart')
    const chartRejection = await ctx.tools.execute({
      signal: testSignal, callId: chartCall, name: 'publish_outcome',
      arguments: { title: 't', summary_markdown: 's', evidence: [{ kind: 'chart', chart_id: 'nope', version: 1 }] },
      agent: fakeAgent(session),
    })
    expect(chartRejection.isError).toBe(true)
    expect(chartRejection.content.some(block => block.type === 'text' && block.text.includes('does not exist'))).toBe(true)

    const messageCall = authorizeToolCall(session, 4, 'publish_outcome', 'science-outcome-missing-message')
    const messageRejection = await ctx.tools.execute({
      signal: testSignal, callId: messageCall, name: 'publish_outcome',
      arguments: { title: 't', summary_markdown: 's', evidence: [{ kind: 'message', seq: 999_999 }] },
      agent: fakeAgent(session),
    })
    expect(messageRejection.isError).toBe(true)
    expect(messageRejection.content.some(block => block.type === 'text' && block.text.includes('does not name a prior message'))).toBe(true)
  })
})

describe('get_science_state artifact sanitization', () => {
  it('omits the internal attachment id, full fingerprint, tool call, and request-header sequence for a curated artifact', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-state-artifact')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
    const runCallId = CallId('science-state-artifact-run')
    session.append('tool/call', { turn: 1, step: 1, callId: runCallId, name: 'run_python', arguments: '{"code":"print(1)"}' })
    const runResult = await ctx.tools.execute({
      signal: testSignal, callId: runCallId, name: 'run_python', arguments: { code: 'print(1)' }, agent: fakeAgent(session),
    })
    expect(runResult.isError).toBe(false)
    const started = session.events.find(event => event.type === 'science/run-started')
    if (started?.type !== 'science/run-started') throw new Error('tool-science test: missing science/run-started')
    await seedAutoArtifact(ctx, session, started.data.run, 'plot.png', PNG, 'image/png')
    session.append('step/start', { turn: 2, step: 1 })
    session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
    const annotateCallId = CallId('science-state-artifact-annotate')
    session.append('tool/call', { turn: 2, step: 1, callId: annotateCallId, name: 'annotate_artifact', arguments: '{}' })
    const annotateResult = await ctx.tools.execute({
      signal: testSignal, callId: annotateCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'Main plot', caption: 'A caption' },
      agent: fakeAgent(session),
    })
    expect(annotateResult.isError).toBe(false)
    const state = await ctx.tools.execute({
      signal: testSignal, callId: CallId('science-state-artifact-read'), name: 'get_science_state', arguments: {}, agent: fakeAgent(session),
    })
    expect(state.isError).toBe(false)
    if (state.isError) throw new Error('unreachable')
    const value = state.value as unknown as { artifacts: readonly Record<string, unknown>[] }
    // The curation retitled the captured version in place, so the model reads
    // one artifact carrying the curated metadata.
    expect(value.artifacts).toHaveLength(1)
    const artifact = value.artifacts[0]
    expect(artifact?.artifactId).toBeTypeOf('string')
    expect(artifact).toMatchObject({ logicalName: 'plot.png', version: 1, origin: 'model', mediaType: 'image/png', caption: 'A caption' })
    expect(artifact).not.toHaveProperty('attachmentId')
    expect(artifact).not.toHaveProperty('toolCallId')
    expect(artifact).not.toHaveProperty('requestHeaderSeq')
    expect(artifact).not.toHaveProperty('environmentFingerprint')
    expect(artifact?.environmentFingerprintPreview).toBeTypeOf('string')
  })

  it('includes an origin:auto artifact with no model title override, and its own bounded fields', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-state-artifact-auto')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
    const runCallId = CallId('science-state-artifact-auto-run')
    session.append('tool/call', { turn: 1, step: 1, callId: runCallId, name: 'run_python', arguments: '{"code":"print(1)"}' })
    const runResult = await ctx.tools.execute({
      signal: testSignal, callId: runCallId, name: 'run_python', arguments: { code: 'print(1)' }, agent: fakeAgent(session),
    })
    expect(runResult.isError).toBe(false)
    const started = session.events.find(event => event.type === 'science/run-started')
    if (started?.type !== 'science/run-started') throw new Error('tool-science test: missing science/run-started')
    await seedAutoArtifact(ctx, session, started.data.run, 'summary.csv', Buffer.from('a,b\n1,2\n'), 'text/csv')
    const state = await ctx.tools.execute({
      signal: testSignal, callId: CallId('science-state-artifact-auto-read'), name: 'get_science_state', arguments: {}, agent: fakeAgent(session),
    })
    expect(state.isError).toBe(false)
    if (state.isError) throw new Error('unreachable')
    const value = state.value as unknown as { artifacts: readonly Record<string, unknown>[] }
    expect(value.artifacts).toHaveLength(1)
    expect(value.artifacts[0]).toMatchObject({ logicalName: 'summary.csv', version: 1, origin: 'auto', title: 'summary.csv', mediaType: 'text/csv' })
    expect(value.artifacts[0]).not.toHaveProperty('width')
    expect(value.artifacts[0]).not.toHaveProperty('height')
  })
})
