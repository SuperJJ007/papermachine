/**
 * Focused behavior tests for `@deepseek-ai/dsh-tool-science`: config
 * validation, registration/disposal, first-use binding, context rendering,
 * and the five tools — composed directly with `ctx.plugin(...)` (not
 * through the real agent loop; see `loader-composition.spec.ts` for the
 * required REAL-composition coverage).
 */

import { chmodSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import ScienceArtifactStore from '@deepseek-ai/dsh-science-artifact-store'
import type { VersionAnnotationRecord, VersionRecord } from '@deepseek-ai/dsh-science-artifact-store'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import ScienceRuntime from '@deepseek-ai/dsh-science-runtime'
import { ScienceRuntimeError } from '@deepseek-ai/dsh-science-runtime/types'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { replayScience, ScienceArtifactId, ScienceEnvironmentProfileId, ScienceProjectId, ScienceRunId, ScienceVersionId } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactMediaType, ScienceArtifactVersion, ScienceChartState, ScienceKernel, ScienceKernelEndReason, ScienceProjection, ScienceRunTerminal } from '@deepseek-ai/dsh-science-session'
import * as ToolScience from '../src/index.ts'
import * as ToolScienceInvariant from '../src/invariant.ts'
import { resolveConfig } from '../src/config.ts'
import { ScienceEditService } from '../src/edit-message.ts'
import { closedKernelFacts, isScienceSession, renderScienceProjection } from '../src/context.ts'
import { scienceArtifactPresentation } from '../src/presentation.ts'
import { artifactReceiptFromArtifact, formatArtifactReceipt } from '../src/annotate-artifact.ts'
import type { ScienceArtifactReceiptValue } from '../src/annotate-artifact.ts'
import { formatInstallResult, installValueFromResult } from '../src/install.ts'
import type { ScienceInstallValue } from '../src/install.ts'
import {
  formatRunResult,
  kernelRestartReason,
  latestRequestHeaderSeq,
  requireArtifactStore,
  requireScienceSession,
  resolveArtifactStoreFacts,
  resolveCapturedArtifactStoreFacts,
  runValueFromResult,
} from '../src/run.ts'
import { scienceArtifactEdits } from '../src/artifact-schema.ts'
import type { ResolveArtifactStoreFacts, ScienceArtifactStoreFacts } from '../src/artifact-schema.ts'
import { stateValueFromProjection } from '../src/state.ts'
import { createFakePythonPrefix, createFakeSandboxRunner, installTestKernelSet, kernelAction } from './harness.ts'

// `setup()` mounts a real LocalSubprocessRuntime/LocalSandboxProvider and the
// run_python/run_r/get_science_state cases spawn a real kernel subprocess
// through it; under full-suite concurrency, spawn and pipe I/O contend for
// the OS scheduler and the default 5s timeout is not enough.
vi.setConfig({ testTimeout: 30_000 })

/** Minimal valid `ScienceProjection` fixture; callers override only what they test. */
function projectionFixture(overrides: Partial<ScienceProjection> = {}): ScienceProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'test-revision' },
    environment: null,
    runs: [],
    kernels: [],
    artifacts: [],
    trace: { turns: [], calls: [], artifacts: [] },
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

/** Minimal valid `ScienceArtifactVersion` fixture (the session-level presentation snapshot); callers override only what they test. */
function artifactVersionFixture(overrides: Partial<ScienceArtifactVersion> = {}): ScienceArtifactVersion {
  return {
    artifactId: ScienceArtifactId('artifact-1'),
    logicalName: 'file',
    version: 1,
    title: 'file',
    projectId: ScienceProjectId('project-1'),
    versionId: ScienceVersionId('store-version-1'),
    sha256: 'a'.repeat(64),
    seenAt: 1000,
    ...overrides,
  }
}

/**
 * Minimal valid `VersionRecord` store-row fixture; callers override only
 * what they test. `contentOrigin`/`curated`/`mediaType`/`bytes` come from
 * this row, not from the session-level `ScienceArtifactVersion`, since the
 * T1/T2 artifact-authority migration.
 */
function versionRecordFixture(overrides: Partial<VersionRecord> = {}): VersionRecord {
  return {
    versionId: ScienceVersionId('store-version-1'),
    artifactId: ScienceArtifactId('artifact-1'),
    ordinal: 1,
    baseVersionId: undefined,
    baseExplicit: false,
    sha256: 'a'.repeat(64),
    mediaType: 'image/png',
    byteCount: 10,
    contentOrigin: 'run-auto',
    producerSessionId: SessionId('session-1'),
    producerRunId: 'run-1',
    producerToolCallId: 'call-1',
    producerRequestHeaderSeq: 1,
    producerTurn: 1,
    environmentRevision: 1,
    environmentFingerprint: 'a'.repeat(64),
    createdAt: 1000,
    latestAnnotation: undefined,
    title: undefined,
    caption: undefined,
    ...overrides,
  }
}

/** Minimal valid `VersionAnnotationRecord` fixture; callers override only what they test. */
function annotationFixture(overrides: Partial<VersionAnnotationRecord> = {}): VersionAnnotationRecord {
  return {
    annotationId: 'annotation-1' as never,
    versionId: ScienceVersionId('store-version-1'),
    title: 'Curated title',
    caption: null,
    actor: 'model',
    sessionId: undefined,
    toolCallId: undefined,
    requestHeaderSeq: undefined,
    derived: false,
    createdAt: 1000,
    ...overrides,
  }
}

/**
 * Build a {@link ResolveArtifactStoreFacts} resolver over fixed store rows,
 * keyed by `versionId` — the same key `runValueFromResult`/
 * `stateValueFromProjection` resolve each listed artifact by.
 */
function resolverFor(records: readonly VersionRecord[]): ResolveArtifactStoreFacts {
  const byVersionId = new Map(records.map(record => [String(record.versionId), record]))
  return async (artifact) => {
    const record = byVersionId.get(String(artifact.versionId))
    if (record === undefined) throw new Error(`test fixture: no VersionRecord for versionId ${String(artifact.versionId)}`)
    return { version: record, edits: [], editCount: 0 }
  }
}

/** Wrap one version row with model-safe store facts for pure receipt tests. */
function storeFacts(version: VersionRecord, overrides: Partial<ScienceArtifactStoreFacts> = {}): ScienceArtifactStoreFacts {
  return { version, edits: [], editCount: 0, ...overrides }
}

/** Resolver for a call site that names no captured/listed artifact and must never be invoked. */
const unusedResolver: ResolveArtifactStoreFacts = () => {
  throw new Error('test fixture: resolveStore should not be called')
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

/** Infer an `ArtifactKind`, matching the T1 v1→v2 migration's own three-case inference. */
function artifactKindFor(mediaType: ScienceArtifactMediaType): 'figure' | 'dataset' | 'document' {
  if (mediaType === 'image/png') return 'figure'
  if (mediaType === 'text/csv') return 'dataset'
  return 'document'
}

/**
 * Directly append one `content_origin: 'run-auto'` artifact version, citing
 * `run`'s authorizing facts when supplied. This is the durable write
 * `dsh-science-runtime`'s real capture walk performs for a file the fake kernel driver never writes
 * (it only replies over the kernel wire protocol's FIFO, never touching
 * `SCIENCE_ARTIFACT_DIR`). Persists the bytes through the mounted project
 * artifact store first (a `createArtifact` write plus a `capture`-actor
 * title annotation), then appends the slimmed session-level presentation
 * event exactly as capture would.
 */
async function seedAutoArtifact(
  ctx: Context, session: Session, run: RunProvenance | undefined, logicalName: string,
  data: Uint8Array, mediaType: ScienceArtifactMediaType, chart?: ScienceChartState,
): Promise<ScienceArtifactVersion> {
  const cwd = session.header.cwd
  if (cwd === undefined) throw new Error('tool-science test: science session fixture requires a cwd')
  const { projectId } = await ctx.scienceArtifactStore.openProject(cwd)
  const stored = await ctx.scienceArtifactStore.createArtifact(projectId, {
    logicalName,
    kind: artifactKindFor(mediaType),
    originSessionId: session.id,
    data,
    mediaType,
    contentOrigin: 'run-auto',
    ...run === undefined ? {} : {
      producerRunId: String(run.runId),
      producerToolCallId: String(run.toolCallId),
      producerRequestHeaderSeq: run.requestHeaderSeq,
      producerTurn: 1,
      environmentRevision: run.environmentRevision,
      environmentFingerprint: run.environmentFingerprint,
    },
    ...chart === undefined ? {} : {
      figureState: { figureKey: chart.figureKey, dpi: chart.png.dpi, stateJson: JSON.stringify(chart) },
    },
  })
  await ctx.scienceArtifactStore.annotateVersion(projectId, stored.version.versionId, { actor: 'capture', title: logicalName })
  const artifact: ScienceArtifactVersion = {
    artifactId: stored.artifact.artifactId,
    logicalName,
    version: 1,
    title: logicalName,
    projectId,
    versionId: stored.version.versionId,
    sha256: stored.version.sha256,
    seenAt: Date.now(),
  }
  session.append('science/artifact-saved', { version: 1, artifact })
  return artifact
}

/** Bind, then run_python to a durable success, through the real tool registry. */
async function runSuccessfully(ctx: Context, session: Session, id: string): Promise<RunProvenance> {
  await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
  const toolCallId = authorizeToolCall(session, 1, 'run_python', id)
  const result = await ctx.tools.execute({
    signal: testSignal, callId: toolCallId, name: 'run_python', arguments: { code: kernelAction({ status: 'ok' }) },
    agent: fakeAgent(session),
  })
  expect(result.isError).toBe(false)
  const started = session.events.find(event => event.type === 'science/run-started')
  if (started?.type !== 'science/run-started') throw new Error('tool-science test: missing science/run-started')
  return started.data.run
}

let root: string
/**
 * Every `Context` a test created through {@link setup}, disposed in
 * `afterEach` — required because `setup` mounts real `LocalSubprocessRuntime`/
 * `LocalSandboxProvider` providers, which hold live OS-level process-tree
 * state that must be torn down explicitly, mirroring
 * `science-runtime/tests/kernel-set.spec.ts`'s own `contexts`/`afterEach` pattern.
 */
const contexts: Context[] = []

beforeEach(async () => {
  // Science Runtime scratch roots must not overlap a generic sandbox temp
  // grant (os.tmpdir()/`/tmp`), so this uses a repo-relative hidden dir —
  // the same convention science-runtime's own tests use.
  root = await mkdtemp(join(process.cwd(), '.tool-science-test-'))
})
afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await rm(root, { recursive: true, force: true })
})

interface SetupOptions {
  readonly withRuntime?: boolean
  readonly profileId?: string
  readonly modeRevision?: string
  readonly stateHistoryLimit?: number
  /** When set, mounts the Science Runtime with a configured installer (see {@link makeMicromamba}). */
  readonly installer?: boolean
}

/** Write one always-succeeding executable standing in for micromamba; a real subprocess/sandbox spawns it. */
function makeMicromamba(root: string): string {
  const executable = join(root, 'fake-micromamba')
  writeFileSync(executable, '#!/bin/sh\nexit 0\n')
  chmodSync(executable, 0o755)
  return executable
}

const FAKE_INSTALL_CHANNELS = ['https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge', 'https://conda.anaconda.org/conda-forge']

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ScienceSessionInvariant)
  if (options.withRuntime !== false) {
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalSandboxProvider, {
      runnerCommand: [createFakeSandboxRunner(root)],
      runnerFailureSignatures: ['science-runtime fake runner failure'],
    })
    await ctx.plugin(LocalAttachmentStore, { dshHome: join(root, 'dsh-home') })
    await ctx.plugin(ScienceArtifactStore, { dshHome: join(root, 'dsh-home') })
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { fake: { pythonPrefix: createFakePythonPrefix(root) } },
      ...options.installer === true
        ? { micromambaPath: makeMicromamba(root), installChannels: FAKE_INSTALL_CHANNELS }
        : {},
    })
    // Real subprocess/sandbox providers can spawn a real persistent kernel;
    // redirect driver-asset resolution to the fake kernel-wire-protocol fixture so
    // `run_python`/`run_r` exercise the real kernel pipeline deterministically
    // (mirrors `science-runtime/tests/loader-composition.spec.ts`'s own technique).
    installTestKernelSet(ctx, ctx.scienceRuntime)
  }
  const fiber = await ctx.plugin(ToolScience, {
    profileId: options.profileId ?? 'fake',
    modeRevision: options.modeRevision ?? 'test-revision',
    stateHistoryLimit: options.stateHistoryLimit ?? 2,
  })
  return { ctx, fiber }
}

function scienceSession(ctx: Context, id: string): Session {
  return ctx.sessions.create(SessionId(id), { meta: { agentPreset: 'science', cwd: join(root, `workspace-${id}`) } })
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
  it('registers Science tools without outcome publication or guidance', async () => {
    const { ctx } = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('get_science_state')
    expect(names).toContain('run_python')
    expect(names).toContain('run_r')
    expect(names).toContain('annotate_artifact')
    expect(names).toContain('install_science_packages')
    expect(names).not.toContain('publish_outcome')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.contexts.some(entry => entry.name === 'science:environment')).toBe(true)
    expect(assembly.sections.some(section => section.name === 'tool:science')).toBe(true)
    expect(JSON.stringify(assembly)).not.toMatch(/publish_outcome|Outcome revision/)
    expect(assembly.sections.find(section => section.name === 'tool:science')?.text).toContain(
      'reference its exact version through edit_of for a direct edit or artifact_inputs for an input, and write the output to the same relative path',
    )
  })

  it('rejects direct calls to the removed publication tool without appending a publication', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-publication-unavailable')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('removed-publication'), name: 'publish_outcome',
      arguments: {}, agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(session.events.some(event => event.type === 'science/outcome-published')).toBe(false)
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

  it('omits run history so the context stays unchanged by run outcomes', () => {
    // Run outcomes already reach the model through each run tool's result,
    // and get_science_state returns run history on demand; re-rendering a
    // run summary here would change this always-resent context on every
    // run and re-emit the whole block under append-only history.
    const withoutRuns = renderScienceProjection(projectionFixture({ runs: [] }))
    const withRuns = renderScienceProjection(projectionFixture({
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
        kernelEpoch: 1,
        status: 'running',
      }],
    }))
    expect(withRuns).not.toContain('run-1')
    expect(withRuns).not.toContain('Latest run')
    expect(withRuns).toBe(withoutRuns)
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
  it('carries failureCode and failureMessage when present (a kernel run has no per-run exit code or signal)', async () => {
    const value = await runValueFromResult({
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
        kernelEpoch: 1,
        status: 'failed',
        finishedAt: 2,
        stdoutBytes: 0,
        stderrBytes: 5,
        stdoutTruncated: true,
        stderrTruncated: true,
        failureCode: 'EXECUTION_FAILED',
        failureMessage: 'ValueError',
      },
      stdout: { text: '', bytes: 0, truncated: true },
      stderr: { text: 'boom', bytes: 5, truncated: true },
    }, unusedResolver)
    expect(value).toMatchObject({
      status: 'failed', failureCode: 'EXECUTION_FAILED', failureMessage: 'ValueError',
    })
    expect(value).not.toHaveProperty('exitCode')
    expect(value).not.toHaveProperty('signal')
    const text = formatRunResult(value, 'python')
    expect(text).toContain('status: failed')
    expect(text).not.toContain('exit')
    expect(text).not.toContain('signal')
    expect(text).toContain('failureCode: EXECUTION_FAILED')
    expect(text).toContain('failureMessage: ValueError')
    expect(text).toContain('(empty)')
    expect(text).toContain('(stdout truncated)')
    expect(text).toContain('(stderr truncated)')
  })

  it('omits failureCode and failureMessage when absent', async () => {
    const value = await runValueFromResult({
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
        kernelEpoch: 1,
        status: 'cancelled',
        finishedAt: 2,
        stdoutBytes: 0,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
    }, unusedResolver)
    expect(value).not.toHaveProperty('failureCode')
    expect(value).not.toHaveProperty('failureMessage')
    const text = formatRunResult(value, 'python')
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
      kernelEpoch: 1,
      status: 'success',
      finishedAt: 2,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    }
  }

  it('appends a plural captured-artifacts receipt mixing image and non-image entries, and both skip/truncation flags', async () => {
    const image = artifactVersionFixture({
      logicalName: 'plot.png', version: 1, versionId: ScienceVersionId('store-version-plot'), sha256: 'b'.repeat(64),
    })
    const imageStore = versionRecordFixture({
      versionId: ScienceVersionId('store-version-plot'), sha256: 'b'.repeat(64), mediaType: 'image/png', byteCount: 500,
    })
    const csv = artifactVersionFixture({
      logicalName: 'summary.csv', version: 1, versionId: ScienceVersionId('store-version-csv'), sha256: 'c'.repeat(64),
    })
    const csvStore = versionRecordFixture({
      versionId: ScienceVersionId('store-version-csv'), sha256: 'c'.repeat(64), mediaType: 'text/csv', byteCount: 2048,
      contentOrigin: 'run-auto', baseVersionId: ScienceVersionId('store-version-source'), baseExplicit: true,
    })
    const value = await runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
      capture: {
        captured: [image, csv], skippedRasterPaths: ['debug/preview.png'],
        skippedOversizedCount: 3, truncatedPerRun: true, truncatedPerSession: true, appendFailed: false, chartUnavailablePaths: [],
      },
    }, resolverFor([imageStore, csvStore]))
    expect(value.capturedArtifacts).toEqual([
      {
        artifactId: 'artifact-1', logicalName: 'plot.png', version: 1, mediaType: 'image/png', bytes: 500,
        contentOrigin: 'run-auto', curated: false, title: 'file', versionId: 'store-version-plot', seenAt: 1000,
      },
      {
        artifactId: 'artifact-1', logicalName: 'summary.csv', version: 1, mediaType: 'text/csv', bytes: 2048,
        contentOrigin: 'run-auto', curated: false, title: 'file', versionId: 'store-version-csv', seenAt: 1000,
      },
    ])
    expect(value.skippedRaster).toEqual(['debug/preview.png'])
    expect(value.captureSkippedOversizedCount).toBe(3)
    expect(value.captureTruncatedPerRun).toBe(true)
    expect(value.captureTruncatedPerSession).toBe(true)
    const text = formatRunResult(value, 'python')
    expect(text).toContain('Captured 2 artifacts: `plot.png` v1 (artifact-1; image/png, 500 B), `summary.csv` v1 (artifact-1; text/csv, 2.0 KB).')
    expect(text).toContain('(1 PNG file not captured, not declared in raster_artifacts: debug/preview.png; to capture, call run_python again with raster_artifacts: ["debug/preview.png"] and code that writes it)')
    expect(text).toContain('(3 eligible file(s) skipped: too large to capture)')
    expect(text).toContain('(more eligible files existed than this run\'s capture limit admits; the rest were not captured)')
    expect(text).toContain('(this session\'s artifact-capture limit was reached; further eligible files were not captured)')
  })

  it('renders explicit edit ancestry, ordinary continuation, and bounded direct-edit history in model vocabulary', async () => {
    const edited = artifactVersionFixture({ logicalName: 'plot.png', version: 2 })
    const continued = artifactVersionFixture({ logicalName: 'plot.png', version: 3 })
    const base = versionRecordFixture({ ordinal: 2 })
    const edits = [
      { op: 'set_title' as const, target: 'title' },
      { op: 'toggle_grid' as const, target: 'axes[0].grid' },
    ]
    const values = await Promise.all([
      runValueFromResult({
        terminal: successTerminal(), stdout: { text: '', bytes: 0, truncated: false }, stderr: { text: '', bytes: 0, truncated: false },
        capture: {
          captured: [edited], skippedRasterPaths: [], skippedOversizedCount: 0,
          truncatedPerRun: false, truncatedPerSession: false, appendFailed: false, chartUnavailablePaths: [],
        },
      }, async () => storeFacts(base, { lineage: { kind: 'edited-from', logicalName: 'plot.png', version: 1 }, edits, editCount: 4 })),
      runValueFromResult({
        terminal: successTerminal(), stdout: { text: '', bytes: 0, truncated: false }, stderr: { text: '', bytes: 0, truncated: false },
        capture: {
          captured: [continued], skippedRasterPaths: [], skippedOversizedCount: 0,
          truncatedPerRun: false, truncatedPerSession: false, appendFailed: false, chartUnavailablePaths: [],
        },
      }, async () => storeFacts(versionRecordFixture({ ordinal: 3 }), { lineage: { kind: 'continues', version: 2 } })),
    ])
    expect(formatRunResult(values[0], 'python')).toContain('edited from plot.png v1')
    expect(formatRunResult(values[0], 'python')).toContain('4 direct edits: set_title (title), toggle_grid (axes[0].grid); latest 2 shown.')
    expect(formatRunResult(values[1], 'python')).toContain('continues v2')
  })

  it('appends a plural undeclared-raster receipt line, omitting it entirely when the list is empty', async () => {
    const csv = artifactVersionFixture({
      logicalName: 'summary.csv', version: 1, versionId: ScienceVersionId('store-version-csv-2'), sha256: 'e'.repeat(64),
    })
    const csvStore = versionRecordFixture({
      versionId: ScienceVersionId('store-version-csv-2'), sha256: 'e'.repeat(64), mediaType: 'text/csv', byteCount: 10,
    })
    const value = await runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
      capture: {
        captured: [csv], skippedRasterPaths: ['a.png', 'b.png'],
        skippedOversizedCount: 0, truncatedPerRun: false, truncatedPerSession: false, appendFailed: false, chartUnavailablePaths: [],
      },
    }, resolverFor([csvStore]))
    expect(value.skippedRaster).toEqual(['a.png', 'b.png'])
    expect(formatRunResult(value, 'r')).toContain('(2 PNG files not captured, not declared in raster_artifacts: a.png, b.png; to capture, call run_r again with raster_artifacts: ["a.png","b.png"] and code that writes them)')

    const withoutSkips = await runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
      capture: {
        captured: [csv], skippedRasterPaths: [],
        skippedOversizedCount: 0, truncatedPerRun: false, truncatedPerSession: false, appendFailed: false, chartUnavailablePaths: [],
      },
    }, resolverFor([csvStore]))
    expect(withoutSkips).not.toHaveProperty('skippedRaster')
    expect(formatRunResult(withoutSkips, 'python')).not.toContain('not captured')
  })

  it('appends a singular captured-artifact receipt in the megabyte band, omitting skip/truncation flags at zero/false', async () => {
    const large = artifactVersionFixture({
      logicalName: 'dataset.json', version: 1, versionId: ScienceVersionId('store-version-dataset'), sha256: 'd'.repeat(64),
    })
    const largeStore = versionRecordFixture({
      versionId: ScienceVersionId('store-version-dataset'), sha256: 'd'.repeat(64),
      mediaType: 'application/json', byteCount: 3 * 1024 * 1024,
    })
    const value = await runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
      capture: {
        captured: [large], skippedRasterPaths: [],
        skippedOversizedCount: 0, truncatedPerRun: false, truncatedPerSession: false, appendFailed: false, chartUnavailablePaths: [],
      },
    }, resolverFor([largeStore]))
    expect(value).not.toHaveProperty('captureSkippedOversizedCount')
    expect(value).not.toHaveProperty('captureTruncatedPerRun')
    expect(value).not.toHaveProperty('captureTruncatedPerSession')
    const text = formatRunResult(value, 'python')
    expect(text).toContain('Captured 1 artifact: `dataset.json` v1 (artifact-1; application/json, 3.0 MB).')
    expect(text).not.toContain('eligible file(s) skipped')
    expect(text).not.toContain('capture limit')
  })

  it('omits the captured-artifacts line entirely when capture ran but produced nothing', async () => {
    const value = await runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
      capture: {
        captured: [], skippedRasterPaths: [],
        skippedOversizedCount: 0, truncatedPerRun: false, truncatedPerSession: false, appendFailed: false, chartUnavailablePaths: [],
      },
    }, unusedResolver)
    expect(value.capturedArtifacts).toEqual([])
    const text = formatRunResult(value, 'python')
    expect(text).not.toContain('Captured')
  })

  it('prepends the kernel-restart line before status when the value carries a kernelRestartReason', async () => {
    const value = { ...await runValueFromResult({
      terminal: successTerminal(),
      stdout: { text: '', bytes: 0, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
    }, unusedResolver), kernelRestartReason: 'idle timeout' }
    const text = formatRunResult(value, 'python')
    expect(text).toBe(
      'kernel restarted (idle timeout): variables from earlier runs are gone\n'
      + 'status: success\n--- stdout ---\n(empty)\n--- stderr ---\n(empty)',
    )
  })
})

describe('requireArtifactStore / resolveArtifactStoreFacts', () => {
  it('fails loud when no Science Artifact Store is mounted', () => {
    const ctx = new Context()
    expect(() => requireArtifactStore(ctx)).toThrow(/no Science Artifact Store is mounted/)
  })

  it('resolves a captured artifact\'s current store version row, and rejects a versionId the store no longer holds', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-resolve-store-version')
    const run = await runSuccessfully(ctx, session, 'science-resolve-store-version-run')
    const seeded = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const store = await resolveArtifactStoreFacts(ctx, 4, seeded)
    expect(store.version.versionId).toBe(seeded.versionId)
    expect(store.version.mediaType).toBe('image/png')

    const dangling = artifactVersionFixture({ projectId: seeded.projectId, versionId: ScienceVersionId('never-committed') })
    await expect(resolveArtifactStoreFacts(ctx, 4, dangling)).rejects.toThrow(/no longer identifies a committed store version/)
  })

  it('reads PNG edit history only, bounds recent operations, and resolves explicit and implicit lineage', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-resolve-store-facts')
    const run = await runSuccessfully(ctx, session, 'science-resolve-store-facts-run')
    const chart: ScienceChartState = {
      runtime: 'matplotlib', figureKey: 'plot.png', png: { width: 1, height: 1, dpi: 100 },
      elements: [], hitmap: [], hitmapStatus: 'unavailable',
      ops: [
        { op: 'set_title', axes: null, text: 'First' },
        { op: 'toggle_grid', axes: 0, visible: true },
      ],
    }
    const first = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png', chart)
    const explicit = await ctx.scienceArtifactStore.appendVersion(first.projectId, first.artifactId, {
      producerSessionId: session.id, data: PNG, mediaType: 'image/png', contentOrigin: 'run-auto', baseVersionId: first.versionId,
    })
    const continued = await ctx.scienceArtifactStore.appendVersion(first.projectId, first.artifactId, {
      producerSessionId: session.id, data: Uint8Array.from([...PNG, 0]), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const firstFacts = await resolveArtifactStoreFacts(ctx, 1, first)
    expect(firstFacts).toMatchObject({ editCount: 2, edits: [{ op: 'toggle_grid', target: 'axes[0].grid' }] })
    const initialFacts = await resolveCapturedArtifactStoreFacts(ctx, 4, first)
    expect(initialFacts.lineage).toBeUndefined()
    const explicitFacts = await resolveCapturedArtifactStoreFacts(ctx, 4, artifactVersionFixture({
      artifactId: first.artifactId, projectId: first.projectId, version: 2, versionId: explicit.versionId,
    }))
    expect(explicitFacts.lineage).toEqual({ kind: 'edited-from', logicalName: 'plot.png', version: 1 })
    const continuedFacts = await resolveCapturedArtifactStoreFacts(ctx, 4, artifactVersionFixture({
      artifactId: first.artifactId, projectId: first.projectId, version: 3, versionId: continued.versionId,
    }))
    expect(continuedFacts.lineage).toEqual({ kind: 'continues', version: 2 })
  })

  it('preserves migrated implicit-baseline lineage and fails loud for dangling baseline references', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-resolve-baseline-invariants')
    const run = await runSuccessfully(ctx, session, 'science-resolve-baseline-invariants-run')
    const first = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const base = await ctx.scienceArtifactStore.getVersion(first.projectId, first.versionId)
    if (base === undefined) throw new Error('expected seeded base version')
    const explicit = await ctx.scienceArtifactStore.appendVersion(first.projectId, first.artifactId, {
      producerSessionId: session.id, data: Uint8Array.from([...PNG, 0]), mediaType: 'image/png', contentOrigin: 'run-auto', baseVersionId: first.versionId,
    })
    const artifact = artifactVersionFixture({
      artifactId: first.artifactId, projectId: first.projectId, version: 2, versionId: explicit.versionId,
    })
    const getVersion = vi.spyOn(ctx.scienceArtifactStore, 'getVersion')
    getVersion.mockResolvedValueOnce({ ...explicit, baseExplicit: false }).mockResolvedValueOnce(base)
    await expect(resolveCapturedArtifactStoreFacts(ctx, 4, artifact)).resolves.toMatchObject({
      lineage: { kind: 'continues', version: 1 },
    })
    getVersion.mockRestore()

    const readVersion = ctx.scienceArtifactStore.getVersion.bind(ctx.scienceArtifactStore)
    const missingBase = vi.spyOn(ctx.scienceArtifactStore, 'getVersion')
    missingBase.mockImplementationOnce(readVersion).mockResolvedValueOnce(undefined)
    await expect(resolveCapturedArtifactStoreFacts(ctx, 4, artifact)).rejects.toThrow(
      /baseline no longer identifies a committed store version/,
    )
    missingBase.mockRestore()

    vi.spyOn(ctx.scienceArtifactStore, 'getArtifact').mockResolvedValueOnce(undefined)
    await expect(resolveCapturedArtifactStoreFacts(ctx, 4, artifact)).rejects.toThrow(/baseline no longer identifies a committed artifact/)
  })
})

describe('scienceArtifactEdits', () => {
  it('maps every chart operation to its model-safe target and keeps the complete count when bounded', () => {
    const chart: ScienceChartState = {
      runtime: 'matplotlib', figureKey: 'plot.png', png: { width: 1, height: 1, dpi: 100 },
      elements: [], hitmap: [], hitmapStatus: 'unavailable',
      ops: [
        { op: 'set_title', axes: null, text: 'Title' },
        { op: 'set_subtitle', axes: 0, text: 'Subtitle' },
        { op: 'set_axis_label', axes: null, axis: 'x', text: 'X' },
        { op: 'set_legend_position', axes: 1, position: 'upper right' },
        { op: 'toggle_grid', axes: null, visible: true },
        { op: 'set_font', axes: null, family: 'Inter', size: 12 },
      ],
    }
    expect(scienceArtifactEdits(chart, 6)).toEqual({
      editCount: 6,
      edits: [
        { op: 'set_title', target: 'title' },
        { op: 'set_subtitle', target: 'axes[0].subtitle' },
        { op: 'set_axis_label', target: 'x_label' },
        { op: 'set_legend_position', target: 'axes[1].legend' },
        { op: 'toggle_grid', target: 'grid' },
        { op: 'set_font', target: 'font' },
      ],
    })
    expect(scienceArtifactEdits(undefined, 2)).toEqual({ edits: [], editCount: 0 })
  })
})

describe('kernelRestartReason', () => {
  const language = 'python' as const

  /** Minimal `ScienceRunTerminal` fixture naming only what `kernelRestartReason` reads plus its required fields. */
  function runAt(runId: string, kernelEpoch: number): ScienceRunTerminal {
    return {
      runId: ScienceRunId(runId),
      language,
      toolCallId: CallId(`call-${runId}`),
      requestHeaderSeq: 1,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      startedAt: 1,
      codeSha256: 'a'.repeat(64),
      scratchKey: 'a'.repeat(64) as never,
      runDirectoryRef: `runs/${runId}/`,
      kernelEpoch,
      status: 'success',
      finishedAt: 2,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    }
  }

  function kernelStarted(kernelEpoch: number, kernelLanguage: 'python' | 'r' = language): ScienceKernel {
    return { kernelEpoch, language: kernelLanguage, state: 'started', environmentRevision: 1, environmentFingerprint: 'a'.repeat(64), at: 1 }
  }

  function kernelExited(kernelEpoch: number, reason: ScienceKernelEndReason): ScienceKernel {
    return {
      kernelEpoch, language, state: 'exited', reason, startedAt: 1,
      environmentRevision: 1, environmentFingerprint: 'a'.repeat(64), at: 2,
    }
  }

  it('is undefined for a language\'s very first kernel epoch', () => {
    const projection = projectionFixture({ runs: [runAt('run-1', 1)], kernels: [kernelStarted(1)] })
    expect(kernelRestartReason(projection, runAt('run-1', 1))).toBeUndefined()
  })

  it('is undefined for a later run reusing the same kernel epoch', () => {
    const projection = projectionFixture({
      runs: [runAt('run-1', 2), runAt('run-2', 2)],
      kernels: [kernelExited(1, 'idle'), kernelStarted(2)],
    })
    expect(kernelRestartReason(projection, runAt('run-2', 2))).toBeUndefined()
  })

  // ScienceKernelEndReason is closed at 7 members; each one
  // names the prior kernel's exact model-facing phrase (context.ts's
  // modelKernelEndReason), never a placeholder shared across reasons.
  it.each<[ScienceKernelEndReason, string]>([
    ['idle', 'idle timeout'],
    ['environment-rebound', 'environment re-bind'],
    ['run-escalation', 'interrupt escalation'],
    ['crash', 'kernel crash'],
    ['session-end', 'session end'],
    ['protocol', 'the kernel stopped responding correctly'],
    ['service-disposed', 'Science services restarting'],
  ])('names the prior kernel\'s model-vocabulary end reason on the first run of a fresh epoch: %s -> %j', (reason, phrase) => {
    const projection = projectionFixture({
      runs: [runAt('run-1', 1), runAt('run-2', 2)],
      kernels: [kernelExited(1, reason), kernelStarted(2)],
    })
    expect(kernelRestartReason(projection, runAt('run-2', 2))).toBe(phrase)
  })

  it('ignores a different language\'s kernel even when the shared epoch counter makes it numerically earlier', () => {
    const projection = projectionFixture({
      runs: [runAt('run-1', 2)],
      kernels: [kernelStarted(1, 'r'), kernelStarted(2)],
    })
    expect(kernelRestartReason(projection, runAt('run-1', 2))).toBeUndefined()
  })

  it('is undefined when the prior exited kernel lacks its required closing facts', () => {
    const projection = projectionFixture({
      runs: [runAt('run-1', 1), runAt('run-2', 2)],
      kernels: [
        {
          kernelEpoch: 1,
          language,
          state: 'exited',
          environmentRevision: 1,
          environmentFingerprint: 'a'.repeat(64),
          at: 1,
        },
        kernelStarted(2),
      ],
    })
    expect(kernelRestartReason(projection, runAt('run-2', 2))).toBeUndefined()
  })
})

describe('closedKernelFacts', () => {
  it('returns undefined for an exited kernel fact missing reason/startedAt — a value the fold never commits but ScienceKernelState\'s plain optional fields do not forbid at the type level', () => {
    const kernel: ScienceKernel = {
      kernelEpoch: 1,
      language: 'python',
      state: 'exited',
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      at: 200,
    }
    expect(closedKernelFacts(kernel)).toBeUndefined()
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
    expect(text).toContain('"kernels"')
    // `kernelCount` is dropped from the metrics passthrough
    // (kernels/history.kernelsOmitted already state the same fact in full).
    expect(text).not.toContain('kernelCount')
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
  ])('caps recent run history at $limit and reports omissions', async ({ limit, expected, omitted }) => {
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
      kernelEpoch: 1,
      status: 'running' as const,
    }))
    const value = await stateValueFromProjection(projectionFixture({
      runs,
      metrics: { runCount: 3, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, kernelCount: 0, outcomeRevision: 0 },
    }), limit, unusedResolver)
    expect(value.runs.map(run => (run as { runId: string }).runId)).toEqual(expected)
    expect(value.history.runsOmitted).toBe(omitted)
  })

  it.each([
    { limit: 1, expected: [3], omitted: 2 },
    { limit: 2, expected: [2, 3], omitted: 1 },
    { limit: 3, expected: [1, 2, 3], omitted: 0 },
  ])('caps recent kernel history at $limit and reports omissions', async ({ limit, expected, omitted }) => {
    const kernels: readonly ScienceKernel[] = [1, 2, 3].map(kernelEpoch => ({
      kernelEpoch,
      language: 'python' as const,
      state: 'exited' as const,
      reason: 'idle' as const,
      startedAt: kernelEpoch,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      at: kernelEpoch + 1,
    }))
    const value = await stateValueFromProjection(projectionFixture({
      kernels,
      metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, kernelCount: 3, outcomeRevision: 0 },
    }), limit, unusedResolver)
    expect(value.kernels.map(kernel => kernel.kernelEpoch)).toEqual(expected)
    expect(value.history.kernelsOmitted).toBe(omitted)
  })

  it('renders a still-running kernel as "running", named by its own start time', async () => {
    const value = await stateValueFromProjection(projectionFixture({
      kernels: [{
        kernelEpoch: 1, language: 'python', state: 'started',
        environmentRevision: 1, environmentFingerprint: 'a'.repeat(64), at: 100,
      }],
    }), 4, unusedResolver)
    expect(value.kernels).toEqual([{ language: 'python', kernelEpoch: 1, state: 'running', startedAt: 100 }])
  })

  it('renders an exited kernel with its model-vocabulary end reason and original start time', async () => {
    const value = await stateValueFromProjection(projectionFixture({
      kernels: [{
        kernelEpoch: 1, language: 'r', state: 'exited', reason: 'environment-rebound',
        startedAt: 100, environmentRevision: 1, environmentFingerprint: 'a'.repeat(64), at: 200,
      }],
    }), 4, unusedResolver)
    expect(value.kernels).toEqual([{ language: 'r', kernelEpoch: 1, state: 'exited', reason: 'environment re-bind', startedAt: 100 }])
  })

  it('renders a replay-derived interrupted kernel without a reason', async () => {
    const value = await stateValueFromProjection(projectionFixture({
      kernels: [{
        kernelEpoch: 1, language: 'python', state: 'interrupted',
        environmentRevision: 1, environmentFingerprint: 'a'.repeat(64),
        startedAt: 100, finishedAt: 150, interruptedAtSeq: 9,
      }],
    }), 4, unusedResolver)
    expect(value.kernels).toEqual([{ language: 'python', kernelEpoch: 1, state: 'interrupted', startedAt: 100 }])
  })

  it('selects metrics fields explicitly, dropping the raw kernelCount counter', async () => {
    const value = await stateValueFromProjection(projectionFixture({
      metrics: { runCount: 2, successfulRunCount: 1, artifactCount: 3, artifactVersionCount: 4, kernelCount: 5, outcomeRevision: 6 },
    }), 4, unusedResolver)
    expect(value.metrics).toEqual({ runCount: 2, successfulRunCount: 1, artifactCount: 3, artifactVersionCount: 4 })
    expect(value.metrics).not.toHaveProperty('kernelCount')
  })

  it.each([
    { limit: 1, expected: ['artifact-3'], omitted: 2 },
    { limit: 2, expected: ['artifact-2', 'artifact-3'], omitted: 1 },
    { limit: 3, expected: ['artifact-1', 'artifact-2', 'artifact-3'], omitted: 0 },
  ])('caps recent artifact-version history at $limit and reports omissions', async ({ limit, expected, omitted }) => {
    const artifacts = ['artifact-1', 'artifact-2', 'artifact-3'].map((artifactId, index) => artifactVersionFixture({
      artifactId: ScienceArtifactId(artifactId),
      logicalName: artifactId,
      versionId: ScienceVersionId(`store-version-${String(index + 1)}`),
      seenAt: index + 1,
    }))
    const stores = artifacts.map(artifact => versionRecordFixture({
      versionId: artifact.versionId, artifactId: artifact.artifactId,
    }))
    const value = await stateValueFromProjection(projectionFixture({
      artifacts,
      metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 3, artifactVersionCount: 3, kernelCount: 0, outcomeRevision: 0 },
    }), limit, resolverFor(stores))
    expect(value.artifacts.map(artifact => artifact.artifactId)).toEqual(expected)
    expect(value.history.artifactVersionsOmitted).toBe(omitted)
  })

  it('exposes only sanitized interpreter facts and a fingerprint preview', async () => {
    const value = await stateValueFromProjection(projectionFixture({
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
    }), 1, unusedResolver)
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

  it('retains a sanitized R-only environment without adding a Python binding', async () => {
    const value = await stateValueFromProjection(projectionFixture({
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
    }), 1, unusedResolver)
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
    async (languageVersion) => {
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
      const state = await stateValueFromProjection(projection, 1, unusedResolver)
      expect(renderedContext).not.toContain(languageVersion)
      expect(JSON.stringify(state)).not.toContain(languageVersion)
      expect(renderedContext).toContain(`Python: available, fingerprint ${'b'.repeat(12)}.`)
      expect(state.environment).toMatchObject({ python: { capability: 'available', fingerprint: 'b'.repeat(12) } })
      expect((state.environment as { python?: { languageVersion?: string } }).python).not.toHaveProperty('languageVersion')
    },
  )

  it('omits Runtime-owned free text that could disclose Host paths', async () => {
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
      kernelEpoch: 1,
      status: 'failed',
      finishedAt: 2,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      failureCode: 'EXECUTION_FAILED',
      failureMessage: 'failed at /secret/runtime/bin/python',
    } as const
    const value = await stateValueFromProjection(projectionFixture({
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
    }), 1, unusedResolver)
    const rendered = JSON.stringify(value)
    expect(rendered).not.toContain('/secret')
    expect(rendered).not.toContain('failureMessage')
    expect(rendered).not.toContain('failureReason')
    expect(rendered).not.toContain('"reason"')
  })

  it('passes through a run with no failure fields unchanged, and strips only failureMessage from one that has it', async () => {
    const run = (runId: string, failureMessage?: string) => ({
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
      kernelEpoch: 1,
      status: 'failed' as const,
      finishedAt: 2,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      failureCode: 'EXECUTION_FAILED',
      ...failureMessage === undefined ? {} : { failureMessage },
    })
    const value = await stateValueFromProjection(projectionFixture({
      runs: [run('without-message'), run('with-message', 'ValueError at /secret/path')],
      metrics: { runCount: 2, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, kernelCount: 0, outcomeRevision: 0 },
    }), 2, unusedResolver)
    expect(value.runs[0]).toMatchObject({ runId: 'without-message', failureCode: 'EXECUTION_FAILED' })
    expect(value.runs[0]).not.toHaveProperty('failureMessage')
    expect(value.runs[1]).toMatchObject({ runId: 'with-message', failureCode: 'EXECUTION_FAILED' })
    expect(value.runs[1]).not.toHaveProperty('failureMessage')
  })

  it('rejects without an initiating Agent', async () => {
    const { ctx } = await setup()
    const result = await ctx.tools.execute({ signal: testSignal, callId: CallId('state-3'), name: 'get_science_state', arguments: {} })
    expect(result.isError).toBe(true)
  })
})

describe('run_python', () => {
  it('registers identical exact-version input and edit schemas for both run tools', async () => {
    const { ctx } = await setup()
    const schemas = ctx.tools.schemas()
    const python = schemas.find(schema => schema.name === 'run_python')
    const r = schemas.find(schema => schema.name === 'run_r')
    const pythonProperties = python?.parameters.properties as Record<string, unknown> | undefined
    const rProperties = r?.parameters.properties as Record<string, unknown> | undefined
    expect(pythonProperties).toMatchObject({
      artifact_inputs: { type: 'array' },
      edit_of: { type: 'array' },
      raster_artifacts: { type: 'array', items: { type: 'string' } },
    })
    expect(rProperties?.artifact_inputs).toEqual(pythonProperties?.artifact_inputs)
    expect(rProperties?.edit_of).toEqual(pythonProperties?.edit_of)
    expect(rProperties?.raster_artifacts).toEqual(pythonProperties?.raster_artifacts)
  })

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

  it('rejects duplicate edit_of paths before publishing a run', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-run-duplicate-edit-path')
    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: CallId('run-duplicate-edit-path'),
      name: 'run_python',
      arguments: {
        code: 'print(1)',
        edit_of: [
          { artifactId: 'artifact-1', version: 1, path: 'edited.png' },
          { artifactId: 'artifact-2', version: 1, path: 'edited.png' },
        ],
      },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('edit_of paths must be unique'))).toBe(true)
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('rejects a raster_artifacts path escape through the real Runtime before publishing a run', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-run-raster-path-escape')
    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: CallId('run-raster-path-escape'),
      name: 'run_python',
      arguments: { code: 'print(1)', raster_artifacts: ['../escape.png'] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('forward-slash relative file path'))).toBe(true)
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('maps artifact_inputs and edit_of into the Runtime request without changing model field values', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-run-exact-inputs')
    const terminal: ScienceRunTerminal = {
      runId: ScienceRunId('run-exact-inputs'),
      language: 'python',
      toolCallId: CallId('run-exact-inputs'),
      requestHeaderSeq: latestRequestHeaderSeq(session) ?? 0,
      environmentRevision: 1,
      environmentFingerprint: 'a'.repeat(64),
      startedAt: 1,
      codeSha256: 'b'.repeat(64),
      scratchKey: 'c'.repeat(64) as never,
      runDirectoryRef: 'runs/run-exact-inputs/',
      kernelEpoch: 1,
      status: 'success',
      finishedAt: 2,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    }
    const startRun = vi.spyOn(ctx.scienceRuntime, 'startRun').mockResolvedValue({
      runId: terminal.runId,
      done: Promise.resolve({
        terminal,
        stdout: { text: '', bytes: 0, truncated: false },
        stderr: { text: '', bytes: 0, truncated: false },
      }),
      cancel() {},
    })
    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: terminal.toolCallId,
      name: 'run_python',
      arguments: {
        code: 'print(1)',
        artifact_inputs: [{ artifactId: 'artifact-input', version: 2, path: 'source/data.csv' }],
        edit_of: [{ artifactId: 'artifact-parent', version: 3, path: 'plots/edited.png' }],
        raster_artifacts: ['debug/preview.png'],
      },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      artifactInputs: [{ artifactId: 'artifact-input', version: 2, path: 'source/data.csv' }],
      editBaselines: { 'plots/edited.png': { artifactId: 'artifact-parent', version: 3 } },
      rasterArtifacts: ['debug/preview.png'],
    }))
  })

  it('runs source through ctx.scienceRuntime and returns the durable terminal result', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-run-success')
    const toolCallId = CallId('run-4')
    // The real agent loop logs `tool/call` before dispatching execution; this
    // direct-composition test supplies that same durable provenance fact.
    session.append('tool/call', { turn: 1, step: 1, callId: toolCallId, name: 'run_python', arguments: '{"code":"print(1)"}' })
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'run_python', arguments: { code: kernelAction({ status: 'ok', stdout: 'fake run output\n' }) },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(true)
    const finished = session.events.find(event => event.type === 'science/run-finished')
    expect(finished?.type === 'science/run-finished' && finished.data.run.status).toBe('success')
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('status: success')
    expect(text).toContain('fake run output')
    // The fake kernel driver replies with fixed stdout only, never writing to
    // SCIENCE_ARTIFACT_DIR, so capture ran and found nothing: the
    // presentation is null, not an empty-artifacts card.
    expect(result.meta).toBeNull()
  })

  it('prepends the kernel-restart line with the exact model phrase when a mid-session environment rebind starts a fresh kernel epoch', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-run-restart-env-rebind')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    const first = authorizeToolCall(session, 1, 'run_python', 'restart-run-1')
    const firstResult = await ctx.tools.execute({
      signal: testSignal, callId: first, name: 'run_python',
      arguments: { code: kernelAction({ status: 'ok' }) },
      agent: fakeAgent(session),
    })
    expect(firstResult.isError).toBe(false)
    const firstText = firstResult.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(firstText).not.toContain('kernel restarted')

    // Direct log append (not `ensureScienceBound`, whose post-first-run
    // guard blocks a product-reachable re-bind):
    // proves the fold-level rebind KernelSet.acquire reacts to, mirroring
    // science-runtime/tests/run.spec.ts's own rebind test.
    const projection = replayScience(session.events)
    const environment = projection?.environment
    if (environment === null || environment === undefined) throw new Error('tool-science test: missing applied environment')
    session.append('science/environment-bound', {
      version: 1,
      environment: { ...environment, revision: environment.revision + 1, configuredAt: Date.now(), validatedAt: Date.now() },
    })

    const second = authorizeToolCall(session, 2, 'run_python', 'restart-run-2')
    const secondResult = await ctx.tools.execute({
      signal: testSignal, callId: second, name: 'run_python',
      arguments: { code: kernelAction({ status: 'ok' }) },
      agent: fakeAgent(session),
    })
    expect(secondResult.isError).toBe(false)
    const secondText = secondResult.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(secondText.startsWith('kernel restarted (environment re-bind): variables from earlier runs are gone\n')).toBe(true)
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
          title: 'plot.png', versionId: 'store-version-plot',
        },
        {
          artifactId: 'artifact-2', logicalName: 'summary.csv', version: 1, mediaType: 'text/csv', bytes: 8,
          title: 'summary.csv', versionId: 'store-version-csv',
        },
      ],
    } as never
    expect(presentationMeta({}, value)).toEqual({
      kind: 'science/artifact',
      version: 2,
      artifacts: [
        {
          artifactId: 'artifact-1', logicalName: 'plot.png', version: 1, title: 'plot.png',
          content: { versionId: 'store-version-plot', mediaType: 'image/png', byteCount: 500 },
        },
        {
          artifactId: 'artifact-2', logicalName: 'summary.csv', version: 1, title: 'summary.csv',
          content: { versionId: 'store-version-csv', mediaType: 'text/csv', byteCount: 8 },
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
  it('omits caption when absent from the durable artifact', () => {
    const value = artifactReceiptFromArtifact(
      artifactVersionFixture({ logicalName: 'main.png', title: 'Main plot' }),
      storeFacts(versionRecordFixture({ latestAnnotation: annotationFixture({ title: 'Main plot' }) })),
      undefined,
    )
    expect(value).not.toHaveProperty('caption')
    expect(formatArtifactReceipt(value)).not.toContain('caption:')
  })

  it('names the producing run tool and turn without exposing its internal run id, and lists direct edits', () => {
    const value = artifactReceiptFromArtifact(
      artifactVersionFixture({ logicalName: 'plot.png', title: 'Plot' }),
      storeFacts(versionRecordFixture({ producerRunId: 'internal-run-id', producerTurn: 3 }), {
        edits: [{ op: 'set_title', target: 'title' }], editCount: 1,
      }),
      'python',
    )
    const text = formatArtifactReceipt(value)
    expect(text).toContain('produced by run_python (turn 3)')
    expect(text).toContain('1 direct edits: set_title (title).')
    expect(text).not.toContain('internal-run-id')
  })

  it('names an R producer and omits producer detail when either the language or turn is unknown', () => {
    const artifact = artifactVersionFixture({ logicalName: 'plot.png', title: 'Plot' })
    const rValue = artifactReceiptFromArtifact(
      artifact,
      storeFacts(versionRecordFixture({ producerRunId: 'r-run', producerTurn: 4 })),
      'r',
    )
    expect(formatArtifactReceipt(rValue)).toContain('produced by run_r (turn 4)')
    expect(artifactReceiptFromArtifact(
      artifact,
      storeFacts(versionRecordFixture({ producerRunId: 'python-run', producerTurn: undefined })),
      'python',
    )).not.toHaveProperty('producer')
  })

  it('curates a non-image artifact identically', () => {
    const value = artifactReceiptFromArtifact(
      artifactVersionFixture({ logicalName: 'summary.csv', title: 'Summary', versionId: ScienceVersionId('store-version-csv') }),
      storeFacts(versionRecordFixture({
        versionId: ScienceVersionId('store-version-csv'), mediaType: 'text/csv', byteCount: 10,
        latestAnnotation: annotationFixture({ versionId: ScienceVersionId('store-version-csv'), title: 'Summary' }),
      })),
      undefined,
    )
    expect(value.versionId).toBe('store-version-csv')
    expect(formatArtifactReceipt(value)).toBe('artifact "summary.csv" v1 (artifact-1), run-auto, curated\ntitle: Summary\ntext/csv, 10 bytes')
  })

  it('names an artifact still on its auto-capture title as auto-captured, not curated', () => {
    const value = artifactReceiptFromArtifact(artifactVersionFixture({ title: 'file' }), storeFacts(versionRecordFixture()), undefined)
    expect(value.curated).toBe(false)
    expect(formatArtifactReceipt(value)).toContain('run-auto, auto-captured')
  })
})

describe('scienceArtifactPresentation', () => {
  it('returns null for an empty artifact list', () => {
    expect(scienceArtifactPresentation([])).toBeNull()
  })

  it('tags a single-item list as version 2', () => {
    const presentation = scienceArtifactPresentation([{
      artifactId: 'artifact-1', logicalName: 'plot.png', version: 2, title: 'Main plot',
      content: { versionId: 'store-version-plot', mediaType: 'image/png', byteCount: 10 },
    }])
    expect(presentation).toEqual({
      kind: 'science/artifact',
      version: 2,
      artifacts: [{
        artifactId: 'artifact-1', logicalName: 'plot.png', version: 2, title: 'Main plot',
        content: { versionId: 'store-version-plot', mediaType: 'image/png', byteCount: 10 },
      }],
    })
  })

  it('carries every entry in a multi-artifact list, in the given order', () => {
    const presentation = scienceArtifactPresentation([
      {
        artifactId: 'artifact-1', logicalName: 'summary.csv', version: 1, title: 'summary.csv',
        content: { versionId: 'store-version-a', mediaType: 'text/csv', byteCount: 4 },
      },
      {
        artifactId: 'artifact-2', logicalName: 'plot.png', version: 1, title: 'plot.png',
        content: { versionId: 'store-version-b', mediaType: 'image/png', byteCount: 8 },
      },
    ]) as { artifacts: { logicalName: string }[] }
    expect(presentation.artifacts.map(item => item.logicalName)).toEqual(['summary.csv', 'plot.png'])
  })
})

describe('annotate_artifact', () => {
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
    expect(text).toContain('produced by run_python (turn 1)')
    expect(text).not.toMatch(/sha256:/)
    expect(text).not.toContain(String(run.runId))
    // Two durable saves (the capture and its curation), one version.
    expect(session.events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(2)
    expect(replayScience(session.events)?.artifacts.map(a => a.version)).toEqual([1])
    if (result.isError) throw new Error('unreachable')
    const value = result.value as unknown as ScienceArtifactReceiptValue
    expect(value.artifactId).toBeTypeOf('string')
    expect(value).toMatchObject({ version: 1, contentOrigin: 'run-auto', curated: true, mediaType: 'image/png', caption: 'A caption' })
    expect(result.meta).toMatchObject({
      kind: 'science/artifact', version: 2,
      artifacts: [{ version: 1, title: 'Main plot', content: { mediaType: 'image/png' } }],
    })
  })

  it('returns a model-visible error when one authorizing call is reused', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-reused-call')
    const run = await runSuccessfully(ctx, session, 'science-annotate-reused-call-run')
    await seedAutoArtifact(ctx, session, run, 'a.csv', Buffer.from('a'), 'text/csv')
    await seedAutoArtifact(ctx, session, run, 'b.csv', Buffer.from('b'), 'text/csv')
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-reused-call-id')
    const first = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'a.csv', title: 'A' }, agent: fakeAgent(session),
    })
    expect(first.isError).toBe(false)
    const second = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'b.csv', title: 'B' }, agent: fakeAgent(session),
    })
    expect(second.isError).toBe(true)
    expect(second.content.some(block => block.type === 'text' && block.text.includes('already authorized a prior artifact annotation'))).toBe(true)
  })

  it('omits producer wording when the stored producer run is not present in the current session', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-unknown-producer')
    const run = await runSuccessfully(ctx, session, 'science-annotate-known-run')
    await seedAutoArtifact(ctx, session, { ...run, runId: ScienceRunId('science-annotate-missing-run') }, 'summary.csv', Buffer.from('a'), 'text/csv')
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-unknown-producer-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'summary.csv', title: 'Summary' }, agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).not.toContain('produced by')
  })

  it('omits producer wording when the artifact has no producer run', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-no-producer')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    await seedAutoArtifact(ctx, session, undefined, 'imported.csv', Buffer.from('a'), 'text/csv')
    const toolCallId = authorizeToolCall(session, 1, 'annotate_artifact', 'science-annotate-no-producer-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'imported.csv', title: 'Imported' }, agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).not.toContain('produced by')
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
    expect(value.mediaType).toBe('text/csv')
    expect(result.meta).toMatchObject({
      kind: 'science/artifact', version: 2,
      artifacts: [{ logicalName: 'summary.csv', title: 'Result summary', content: { mediaType: 'text/csv' } }],
    })
  })

  it('carries the curated version\'s store content reference in the presentation meta', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-annotate-no-name')
    const run = await runSuccessfully(ctx, session, 'science-annotate-no-name-run')
    const seeded = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const toolCallId = authorizeToolCall(session, 2, 'annotate_artifact', 'science-annotate-no-name-call')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: toolCallId, name: 'annotate_artifact',
      arguments: { logical_name: 'plot.png', title: 'Main plot' },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    expect(result.meta).toMatchObject({ artifacts: [{
      content: { versionId: String(seeded.versionId), mediaType: 'image/png', byteCount: PNG.byteLength },
    }] })
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

describe('installValueFromResult / formatInstallResult', () => {
  const stream = (text: string, truncated = false): ScienceInstallValue['stdout'] => ({ text, bytes: Buffer.byteLength(text), truncated })

  it('carries environmentRevision only when the Runtime result names a fresh environment, and always carries environmentChanged', () => {
    expect(installValueFromResult({
      status: 'success',
      environment: { revision: 4 } as never,
      environmentChanged: true,
      stdout: stream(''), stderr: stream(''),
    })).toMatchObject({ status: 'success', environmentRevision: 4, environmentChanged: true })
    expect(installValueFromResult({
      status: 'success',
      environment: { revision: 4 } as never,
      environmentChanged: false,
      stdout: stream(''), stderr: stream(''),
    })).toMatchObject({ status: 'success', environmentRevision: 4, environmentChanged: false })
    expect(installValueFromResult({
      status: 'failed', stdout: stream(''), stderr: stream(''),
    })).toEqual({ status: 'failed', environmentChanged: false, stdout: stream(''), stderr: stream('') })
  })

  it('states plainly that a successful install that appended a fresh revision takes effect on the next run and loses in-memory kernel state then', () => {
    const text = formatInstallResult({
      status: 'success', environmentRevision: 3, environmentChanged: true, stdout: stream(''), stderr: stream(''),
    })
    expect(text).toContain('takes effect on the next run_python/run_r call')
    expect(text).toContain('not now')
    expect(text).toContain('lost then')
  })

  it('states plainly that a redundant successful install changed nothing and restarts no kernel', () => {
    const text = formatInstallResult({
      status: 'success', environmentRevision: 3, environmentChanged: false, stdout: stream(''), stderr: stream(''),
    })
    expect(text).toContain('environment revision 3 unchanged')
    expect(text).toContain('no kernel restarts because of this call')
    expect(text).not.toContain('takes effect')
  })

  it('omits the environment-revision line on a non-success status', () => {
    const text = formatInstallResult({ status: 'failed', environmentChanged: false, stdout: stream(''), stderr: stream('') })
    expect(text).not.toContain('takes effect')
    expect(text).not.toContain('environment revision')
  })

  it('steers the model away from pip/install.packages() only on a failed status', () => {
    const steering = 'the environment is unchanged; try a different package name or version spec — do not fall back to pip/install.packages(), which is lost on the next kernel restart'
    expect(formatInstallResult({ status: 'failed', environmentChanged: false, stdout: stream(''), stderr: stream('') })).toContain(steering)
    expect(formatInstallResult({ status: 'cancelled', environmentChanged: false, stdout: stream(''), stderr: stream('') })).not.toContain(steering)
    expect(formatInstallResult({ status: 'timed-out', environmentChanged: false, stdout: stream(''), stderr: stream('') })).not.toContain(steering)
    expect(formatInstallResult({
      status: 'success', environmentRevision: 1, environmentChanged: true, stdout: stream(''), stderr: stream(''),
    })).not.toContain(steering)
  })

  it('tells the model a timed-out install may have partially or fully written the environment and to verify before retrying', () => {
    const guidance = 'the installer was stopped at its deadline before confirming completion — the environment may be partially or fully written; check get_science_state or try importing the package before deciding whether to retry, and retry at most once'
    expect(formatInstallResult({ status: 'timed-out', environmentChanged: false, stdout: stream(''), stderr: stream('') })).toContain(guidance)
    expect(formatInstallResult({ status: 'failed', environmentChanged: false, stdout: stream(''), stderr: stream('') })).not.toContain(guidance)
    expect(formatInstallResult({ status: 'cancelled', environmentChanged: false, stdout: stream(''), stderr: stream('') })).not.toContain(guidance)
    expect(formatInstallResult({
      status: 'success', environmentRevision: 1, environmentChanged: true, stdout: stream(''), stderr: stream(''),
    })).not.toContain(guidance)
  })

  it('renders "(empty)" for empty streams and appends truncation markers when set', () => {
    const text = formatInstallResult({
      status: 'success', environmentRevision: 1, environmentChanged: true,
      stdout: stream('', false), stderr: stream('boom\n', true),
    })
    expect(text).toContain('--- stdout ---\n(empty)')
    expect(text).toContain('--- stderr ---\nboom\n')
    expect(text).toContain('(stderr truncated)')
    expect(text).not.toContain('(stdout truncated)')
  })

  it('renders captured non-empty stdout and a stdout truncation marker', () => {
    const text = formatInstallResult({
      status: 'success', environmentRevision: 1, environmentChanged: true,
      stdout: stream('installed numpy-1.26.4\n', true), stderr: stream(''),
    })
    expect(text).toContain('installed numpy-1.26.4')
    expect(text).toContain('(stdout truncated)')
    expect(text).not.toContain('(stderr truncated)')
  })
})

describe('install_science_packages', () => {
  it('rejects when no Science Runtime is mounted', async () => {
    const { ctx } = await setup({ withRuntime: false })
    const session = scienceSession(ctx, 'science-install-no-runtime')
    session.append('science/mode-bound', { version: 1, mode: { modeId: 'science', presetId: 'science', modeRevision: 'test-revision' } })
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('install-no-runtime'), name: 'install_science_packages',
      arguments: { language: 'python', packages: ['numpy'] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('no Science Runtime is mounted'))).toBe(true)
  })

  it('rejects a nested Code Mode sub-dispatch before Runtime lookup or side effects', async () => {
    const { ctx } = await setup({ installer: true })
    const session = await boundSession(ctx, 'science-install-nested')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('install-nested'), name: 'install_science_packages',
      arguments: { language: 'python', packages: ['numpy'] },
      agent: fakeAgent(session), parent: Symbol('run_code') as ToolExecutionToken,
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('nested Code Mode sub-dispatch'))).toBe(true)
    expect(session.events.some(event => event.type === 'science/environment-bound' && event.data.environment.revision > 1)).toBe(false)
  })

  it('surfaces the Runtime rejection for a deployment with no configured installer', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-install-not-configured')
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('install-not-configured'), name: 'install_science_packages',
      arguments: { language: 'python', packages: ['numpy'] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('configured micromamba executable path'))).toBe(true)
  })

  it('installs successfully, appends a fresh environment revision when the install actually changed the inventory, and tells the model plainly that it takes effect next run', async () => {
    const { ctx } = await setup({ installer: true })
    const session = await boundSession(ctx, 'science-install-success')
    const before = replayScience(session.events)?.environment
    // The shared fake Python prefix (createFakePythonPrefix) and fake
    // micromamba (makeMicromamba) both report a fixed static package list
    // regardless of what was requested — correct for every other test in
    // this file, but this test specifically exercises a real environment
    // change, so it overwrites both with a marker-file pair that models
    // micromamba actually writing the requested package (mirrors
    // examples/headless-agent's own science fixture, prepareScienceFixture).
    const pandasMarker = join(root, 'fake-conda', 'conda-meta', 'pandas-2.2.0.json')
    writeFileSync(join(root, 'fake-conda', 'bin', 'python'), `#!/bin/sh
case " $* " in
  *" --version "*) printf 'Fake Python 3.13.5\\n' ;;
  *" -m "*)
    if [ -f ${JSON.stringify(pandasMarker)} ]; then
      printf '[{"name":"pip","version":"24.0"},{"name":"numpy","version":"1.26.4"},{"name":"pandas","version":"2.2.0"}]'
    else
      printf '[{"name":"pip","version":"24.0"},{"name":"numpy","version":"1.26.4"}]'
    fi
    ;;
  *" -c "*) printf 'dsh-科学-✓' ;;
  *)
    while [ "$#" -gt 2 ]; do shift; done
    exec "${process.execPath}" "$1" "$2"
    ;;
esac
`)
    chmodSync(join(root, 'fake-conda', 'bin', 'python'), 0o700)
    writeFileSync(join(root, 'fake-micromamba'), `#!/bin/sh\ntouch ${JSON.stringify(pandasMarker)}\nexit 0\n`)
    chmodSync(join(root, 'fake-micromamba'), 0o755)
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('install-success'), name: 'install_science_packages',
      arguments: { language: 'python', packages: ['pandas'] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
    expect(text).toContain('status: success')
    expect(text).toContain('takes effect on the next run_python/run_r call')
    expect(text).toContain('lost then')
    const after = replayScience(session.events)?.environment
    expect(after?.revision).toBe((before?.revision ?? 0) + 1)
  })

  it('reports a redundant install as unchanged, appending no revision', async () => {
    const { ctx } = await setup({ installer: true })
    const session = await boundSession(ctx, 'science-install-redundant')
    const before = replayScience(session.events)?.environment
    // Default fake harness: every requested package is already in the
    // static probe output, modeling the retry this fix targets after a
    // misreported 'timed-out' whose install had, in fact, already finished.
    const result = await ctx.tools.execute({
      signal: testSignal, callId: CallId('install-redundant'), name: 'install_science_packages',
      arguments: { language: 'python', packages: ['numpy'] },
      agent: fakeAgent(session),
    })
    expect(result.isError).toBe(false)
    const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
    expect(text).toContain('status: success')
    expect(text).toContain('unchanged')
    expect(text).not.toContain('takes effect')
    const after = replayScience(session.events)?.environment
    expect(after?.revision).toBe(before?.revision)
  })
})

describe('scienceEdits submit', () => {
  it('commits chart operations and translates stable Runtime chart rejections', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-chart-remote')
    const agent = fakeAgent(session)
    const service = new ScienceEditService(ctx)
    const artifact = artifactVersionFixture({ version: 2 })
    const apply = vi.spyOn(ctx.scienceRuntime, 'applyChartEdit').mockResolvedValue({
      artifact,
      failedOps: [{ index: 1, reason: 'series missing' }],
    })
    const request = {
      artifactId: artifact.artifactId,
      version: 1,
      ops: [{ op: 'set_title' as const, axes: null, text: 'New title' }],
    }
    await expect(service.applyChartOps(agent, request, testSignal)).resolves.toEqual({
      artifactId: artifact.artifactId,
      version: 2,
      origin: 'human-edit',
      failedOps: [{ index: 1, reason: 'series missing' }],
    })
    expect(apply).toHaveBeenCalledWith({ session, ...request, signal: testSignal })

    for (const [runtimeCode, remoteCode] of [
      ['CHART_STALE_VERSION', 'CHART_STALE'],
      ['CHART_NOT_ADDRESSABLE', 'CHART_NOT_ADDRESSABLE'],
      ['CHART_ELEMENT_NOT_FOUND', 'CHART_OP_INVALID'],
      ['CHART_OP_INVALID', 'CHART_OP_INVALID'],
    ] as const) {
      apply.mockRejectedValueOnce(new ScienceRuntimeError(runtimeCode, runtimeCode))
      await expect(service.applyChartOps(agent, request, testSignal))
        .rejects.toMatchObject({ code: remoteCode, message: runtimeCode })
    }
    const infrastructure = new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'kernel failed')
    apply.mockRejectedValueOnce(infrastructure)
    await expect(service.applyChartOps(agent, request, testSignal)).rejects.toBe(infrastructure)
    const unexpected = new Error('unexpected chart edit failure')
    apply.mockRejectedValueOnce(unexpected)
    await expect(service.applyChartOps(agent, request, testSignal)).rejects.toBe(unexpected)
  })

  it('renders a chart preview without committing a version, and translates the same stable Runtime rejections', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-chart-preview-remote')
    const agent = fakeAgent(session)
    const service = new ScienceEditService(ctx)
    const chart: ScienceChartState = {
      runtime: 'matplotlib', figureKey: 'plot.png', png: { width: 640, height: 480, dpi: 100 },
      hitmap: [], hitmapStatus: 'unavailable', elements: [],
      ops: [{ op: 'set_title', axes: null, text: 'New title' }],
    }
    const preview = vi.spyOn(ctx.scienceRuntime, 'previewChartEdit').mockResolvedValue({
      png: PNG,
      chart,
      failedOps: [{ index: 1, reason: 'series missing' }],
    })
    const request = {
      artifactId: ScienceArtifactId('artifact-1'),
      version: 1,
      ops: [{ op: 'set_title' as const, axes: null, text: 'New title' }],
    }
    await expect(service.previewChartOps(agent, request, testSignal)).resolves.toEqual({
      pngBase64: Buffer.from(PNG).toString('base64'),
      chart,
      failedOps: [{ index: 1, reason: 'series missing' }],
    })
    expect(preview).toHaveBeenCalledWith({ session, ...request, signal: testSignal })

    for (const [runtimeCode, remoteCode] of [
      ['CHART_STALE_VERSION', 'CHART_STALE'],
      ['CHART_NOT_ADDRESSABLE', 'CHART_NOT_ADDRESSABLE'],
      ['CHART_ELEMENT_NOT_FOUND', 'CHART_OP_INVALID'],
      ['CHART_OP_INVALID', 'CHART_OP_INVALID'],
    ] as const) {
      preview.mockRejectedValueOnce(new ScienceRuntimeError(runtimeCode, runtimeCode))
      await expect(service.previewChartOps(agent, request, testSignal))
        .rejects.toMatchObject({ code: remoteCode, message: runtimeCode })
    }
    const infrastructure = new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'kernel failed')
    preview.mockRejectedValueOnce(infrastructure)
    await expect(service.previewChartOps(agent, request, testSignal)).rejects.toBe(infrastructure)
    const unexpected = new Error('unexpected chart preview failure')
    preview.mockRejectedValueOnce(unexpected)
    await expect(service.previewChartOps(agent, request, testSignal)).rejects.toBe(unexpected)
  })

  it('adds and removes ignorable user-only notes without queuing model input', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-artifact-notes')
    const run = await runSuccessfully(ctx, session, 'science-artifact-notes-run')
    const artifact = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const followup = vi.fn()
    const agent = { session, followup } as unknown as Agent
    const service = new ScienceEditService(ctx)

    expect(service.addArtifactNote(agent, {
      artifactId: artifact.artifactId, version: artifact.version, text: '  Inspect axis label  ',
    })).toEqual({ accepted: true })
    const added = session.events.at(-1)
    expect(added).toMatchObject({
      type: 'science/artifact-note-added', ignorable: true,
      data: { artifactId: artifact.artifactId, artifactVersion: artifact.version, text: 'Inspect axis label' },
    })
    expect(followup).not.toHaveBeenCalled()
    if (added?.type !== 'science/artifact-note-added') throw new Error('expected note-add event')

    expect(service.removeArtifactNote(agent, { artifactId: artifact.artifactId, noteSeq: added.seq }))
      .toEqual({ accepted: true })
    expect(session.events.at(-1)).toMatchObject({
      type: 'science/artifact-note-removed', ignorable: true,
      data: { artifactId: artifact.artifactId, noteSeq: added.seq },
    })
    expect(() => service.removeArtifactNote(agent, { artifactId: artifact.artifactId, noteSeq: added.seq }))
      .toThrow(/does not identify an active note/)
  })

  it('rejects note writes for absent versions and invalid plain text', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-artifact-note-rejections')
    const run = await runSuccessfully(ctx, session, 'science-artifact-note-rejections-run')
    const artifact = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const service = new ScienceEditService(ctx)
    const agent = fakeAgent(session)

    expect(() => service.addArtifactNote(agent, {
      artifactId: artifact.artifactId, version: artifact.version + 1, text: 'missing version',
    })).toThrow(/does not identify a committed version/)
    for (const text of ['', '  ', 'has\u0000null', '\uD800 lone surrogate']) {
      expect(() => service.addArtifactNote(agent, {
        artifactId: artifact.artifactId, version: artifact.version, text,
      })).toThrow(/artifact note/)
    }
  })

  it('enforces the artifact note length cap at the RPC boundary independent of UI limits', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-artifact-note-length')
    const run = await runSuccessfully(ctx, session, 'science-artifact-note-length-run')
    const artifact = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const service = new ScienceEditService(ctx)
    const agent = fakeAgent(session)

    expect(service.addArtifactNote(agent, {
      artifactId: artifact.artifactId, version: artifact.version, text: 'x'.repeat(8_192),
    })).toEqual({ accepted: true })
    expect(() => service.addArtifactNote(agent, {
      artifactId: artifact.artifactId, version: artifact.version, text: 'x'.repeat(8_193),
    })).toThrow(/artifact note must be at most 8192 characters/)
  })

  it('admits a viewer edit through ScienceEditService.submit and queues the structured message on the live agent', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-edit-submit')
    const run = await runSuccessfully(ctx, session, 'science-edit-submit-run')
    const artifact = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png')
    const followups: UserMessage[] = []
    const agent = {
      session,
      followup: (message: UserMessage) => { followups.push(message) },
    } as unknown as Agent
    const service = new ScienceEditService(ctx)
    await expect(service.submit(agent, { targets: [{
      artifactId: ScienceArtifactId('absent'), logicalName: 'absent.png', version: 1,
      target: { kind: 'normalized-region', x: 0, y: 0, width: 1, height: 1 } }], instruction: 'change region',
    })).rejects.toThrow(/does not identify a committed artifact/)
    expect(followups).toHaveLength(0)
    const receipt = await service.submit(agent, { targets: [
      {
        artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1,
        target: { kind: 'normalized-region', x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      },
      {
        artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1,
        target: { kind: 'normalized-region', x: 0, y: 0, width: 0.25, height: 0.25 },
      },
    ], instruction: 'brighten the selected regions' })
    expect(receipt).toEqual({ accepted: true })
    expect(followups).toHaveLength(1)
    expect(followups[0]?.source).toMatchObject({ kind: 'science-edit' })
    if (followups[0]?.source.kind !== 'science-edit') throw new Error('expected science-edit source')
    expect(followups[0].source.targets[0]).toEqual({ artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1,
      target: { kind: 'normalized-region', x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })
    expect(followups[0].source.targets).toHaveLength(2)
    expect(followups[0]?.content.filter(block => block.type === 'image')).toHaveLength(1)
  })

  it('admits an element target without reading the artifact store or minting an image', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-edit-submit-element')
    const run = await runSuccessfully(ctx, session, 'science-edit-submit-element-run')
    const artifact = await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png', {
      runtime: 'matplotlib', figureKey: 'plot.png', png: { width: 1, height: 1, dpi: 100 },
      hitmap: [], hitmapStatus: 'unavailable', ops: [],
      elements: [{ id: 'axes[0].title', kind: 'title', axes: 0, label: null, current: 'Loss' }],
    })
    const followups: UserMessage[] = []
    const agent = {
      session,
      followup: (message: UserMessage) => { followups.push(message) },
    } as unknown as Agent
    const service = new ScienceEditService(ctx)
    const readBlob = vi.spyOn(ctx.scienceArtifactStore, 'readBlob')

    const receipt = await service.submit(agent, { targets: [{
      artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1,
      target: { kind: 'element', elementId: 'axes[0].title', elementKind: 'title', axes: 0, label: null, current: 'Loss' },
    }], instruction: 'shorten the title' })

    expect(receipt).toEqual({ accepted: true })
    expect(readBlob).not.toHaveBeenCalled()
    expect(followups).toHaveLength(1)
    expect(followups[0]?.content.filter(block => block.type === 'image')).toHaveLength(0)
    const text = followups[0]?.content[0]
    expect(text?.type === 'text' && text.text).toContain('element("axes[0].title", kind=title, axes=0, label=null, current="Loss")')
  })

  it('rejects a non-image target without reading its (nonexistent) figure state', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-edit-submit-non-image')
    const run = await runSuccessfully(ctx, session, 'science-edit-submit-non-image-run')
    const artifact = await seedAutoArtifact(ctx, session, run, 'summary.csv', Buffer.from('a,b\n1,2\n'), 'text/csv')
    const service = new ScienceEditService(ctx)
    const agent = fakeAgent(session)
    const getFigureState = vi.spyOn(ctx.scienceArtifactStore, 'getFigureState')

    await expect(service.submit(agent, { targets: [{
      artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1,
      target: { kind: 'normalized-region', x: 0, y: 0, width: 1, height: 1 },
    }], instruction: 'brighten it' })).rejects.toThrow(/raster image artifact/)
    expect(getFigureState).not.toHaveBeenCalled()
  })

  it('rejects a target whose session event names a version the store never committed', async () => {
    const { ctx } = await setup()
    const session = await boundSession(ctx, 'science-edit-submit-dangling')
    const { projectId } = await ctx.scienceArtifactStore.openProject(session.header.cwd ?? '')
    const dangling = artifactVersionFixture({ projectId, versionId: ScienceVersionId('never-committed-edit-target') })
    session.append('science/artifact-saved', { version: 1, artifact: dangling })
    const service = new ScienceEditService(ctx)
    const agent = fakeAgent(session)

    await expect(service.submit(agent, { targets: [{
      artifactId: dangling.artifactId, logicalName: dangling.logicalName, version: 1,
      target: { kind: 'normalized-region', x: 0, y: 0, width: 1, height: 1 },
    }], instruction: 'brighten it' })).rejects.toThrow(/no longer identifies a committed store version/)
  })

  it('forwards a save-as request to the Runtime and returns the new artifact identity', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-save-as-remote')
    const agent = fakeAgent(session)
    const service = new ScienceEditService(ctx)
    const artifact = artifactVersionFixture({ artifactId: ScienceArtifactId('artifact-copy'), logicalName: 'copy.csv', version: 1 })
    const saveArtifactAs = vi.spyOn(ctx.scienceRuntime, 'saveArtifactAs').mockResolvedValue(artifact)

    const receipt = await service.saveArtifactAs(agent, { sourceVersionId: 'store-version-1', newLogicalName: 'copy.csv' }, testSignal)

    expect(receipt).toEqual({ artifactId: 'artifact-copy', logicalName: 'copy.csv', version: 1 })
    expect(saveArtifactAs).toHaveBeenCalledWith({
      session, sourceVersionId: ScienceVersionId('store-version-1'), newLogicalName: 'copy.csv', signal: testSignal,
    })
  })

  it('translates stable Runtime save-as rejections and passes through every other error unchanged', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-save-as-remote-errors')
    const agent = fakeAgent(session)
    const service = new ScienceEditService(ctx)
    const saveArtifactAs = vi.spyOn(ctx.scienceRuntime, 'saveArtifactAs')
    const request = { sourceVersionId: 'store-version-1', newLogicalName: 'copy.csv' }

    for (const [runtimeCode, remoteCode] of [
      ['ARTIFACT_VERSION_NOT_FOUND', 'SAVE_AS_SOURCE_NOT_FOUND'],
      ['ARTIFACT_LOGICAL_NAME_CONFLICT', 'SAVE_AS_NAME_CONFLICT'],
    ] as const) {
      saveArtifactAs.mockRejectedValueOnce(new ScienceRuntimeError(runtimeCode, runtimeCode))
      await expect(service.saveArtifactAs(agent, request, testSignal))
        .rejects.toMatchObject({ code: remoteCode, message: runtimeCode })
    }
    const infrastructure = new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'store failed')
    saveArtifactAs.mockRejectedValueOnce(infrastructure)
    await expect(service.saveArtifactAs(agent, request, testSignal)).rejects.toBe(infrastructure)
    const unexpected = new Error('unexpected save-as failure')
    saveArtifactAs.mockRejectedValueOnce(unexpected)
    await expect(service.saveArtifactAs(agent, request, testSignal)).rejects.toBe(unexpected)
  })
})


describe('get_science_state artifact sanitization', () => {
  it('omits publication state and metrics from the model response', async () => {
    const value = await stateValueFromProjection(projectionFixture(), 20, unusedResolver)
    expect(value).not.toHaveProperty('outcome')
    expect(value.metrics).not.toHaveProperty('outcomeRevision')
  })

  it('reports content_origin as human-edit, and never a producer run, for a direct-edit version', async () => {
    const artifact = artifactVersionFixture({ logicalName: 'chart.png', version: 2 })
    const store = versionRecordFixture({
      contentOrigin: 'human-edit', baseVersionId: ScienceVersionId('store-version-1'), baseExplicit: true,
      producerRunId: undefined, producerToolCallId: undefined, producerRequestHeaderSeq: undefined,
    })
    const value = await stateValueFromProjection(projectionFixture({ artifacts: [artifact] }), 20, resolverFor([store]))
    expect(value.artifacts).toEqual([expect.objectContaining({ contentOrigin: 'human-edit' })])
    expect(value.artifacts[0]).not.toHaveProperty('runId')
    expect(value.artifacts[0]).not.toHaveProperty('parent')
  })

  it('returns the complete direct-edit count with only the configured number of recent operations', async () => {
    const { ctx } = await setup({ stateHistoryLimit: 1 })
    const session = scienceSession(ctx, 'science-state-direct-edits')
    const run = await runSuccessfully(ctx, session, 'science-state-direct-edits-run')
    const chart: ScienceChartState = {
      runtime: 'matplotlib', figureKey: 'plot.png', png: { width: 1, height: 1, dpi: 100 },
      elements: [], hitmap: [], hitmapStatus: 'unavailable',
      ops: [
        { op: 'set_title', axes: null, text: 'First' },
        { op: 'toggle_grid', axes: 0, visible: true },
      ],
    }
    await seedAutoArtifact(ctx, session, run, 'plot.png', PNG, 'image/png', chart)
    const state = await ctx.tools.execute({
      signal: testSignal, callId: CallId('science-state-direct-edits-read'), name: 'get_science_state', arguments: {}, agent: fakeAgent(session),
    })
    expect(state.isError).toBe(false)
    if (state.isError) throw new Error('unreachable')
    expect(state.value).toMatchObject({
      artifacts: [{ editCount: 2, edits: [{ op: 'toggle_grid', target: 'axes[0].grid' }] }],
    })
  })

  it('omits the internal store version id, full fingerprint, tool call, and request-header sequence for a curated artifact', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-state-artifact')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
    const runCallId = CallId('science-state-artifact-run')
    session.append('tool/call', { turn: 1, step: 1, callId: runCallId, name: 'run_python', arguments: '{"code":"print(1)"}' })
    const runResult = await ctx.tools.execute({
      signal: testSignal, callId: runCallId, name: 'run_python', arguments: { code: kernelAction({ status: 'ok' }) }, agent: fakeAgent(session),
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
    expect(artifact).toMatchObject({
      logicalName: 'plot.png', version: 1, contentOrigin: 'run-auto', curated: true, mediaType: 'image/png', caption: 'A caption',
    })
    expect(artifact).not.toHaveProperty('versionId')
    expect(artifact).not.toHaveProperty('sha256')
    expect(artifact).not.toHaveProperty('toolCallId')
    expect(artifact).not.toHaveProperty('requestHeaderSeq')
    expect(artifact).not.toHaveProperty('environmentRevision')
    expect(artifact).not.toHaveProperty('environmentFingerprint')
    expect(artifact).not.toHaveProperty('environmentFingerprintPreview')
  })

  it('includes a run-auto artifact with no model title override, and its own bounded fields', async () => {
    const { ctx } = await setup()
    const session = scienceSession(ctx, 'science-state-artifact-auto')
    await ctx.systemPrompt.assemble({ agent: fakeAgent(session), signal: testSignal })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
    const runCallId = CallId('science-state-artifact-auto-run')
    session.append('tool/call', { turn: 1, step: 1, callId: runCallId, name: 'run_python', arguments: '{"code":"print(1)"}' })
    const runResult = await ctx.tools.execute({
      signal: testSignal, callId: runCallId, name: 'run_python', arguments: { code: kernelAction({ status: 'ok' }) }, agent: fakeAgent(session),
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
    expect(value.artifacts[0]).toMatchObject({
      logicalName: 'summary.csv', version: 1, contentOrigin: 'run-auto', curated: false, title: 'summary.csv', mediaType: 'text/csv',
    })
    expect(value.artifacts[0]).not.toHaveProperty('width')
    expect(value.artifacts[0]).not.toHaveProperty('height')
  })
})
