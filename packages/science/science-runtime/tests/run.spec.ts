/** Focused kernel-run pipeline coverage: acquisition, interrupt-first cancel/timeout, terminal classification, capture, and replay. */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MAX_OUTPUT_BYTES } from '../src/execution.ts'
import { KernelSet } from '../src/kernel-set.ts'
import { ensureSessionScratch, planKernelScratch, planSessionScratch } from '../src/scratch.ts'
import ScienceRuntime from '../src/index.ts'
import {
  attachScienceSession,
  authorizeConcurrentRuns,
  authorizePythonRun,
  authorizeRun,
  createFakePythonPrefix,
  createFakeRPrefix,
  createFakeSandboxRunner,
  createKernelRuntimeHarness,
  createScienceSession,
  installTestKernelSet,
  KERNEL_ASSETS_DELAYED_READY_ROOT,
  KERNEL_ASSETS_NO_READY_ROOT,
  kernelAction,
  mountArtifactStore,
  rejectSessionAppend,
} from './harness.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Bind the fake Python profile through the public Runtime operation. */
async function bindFakePython(
  runtime: Awaited<ReturnType<typeof createKernelRuntimeHarness>>['runtime'],
  session: ReturnType<typeof createScienceSession>,
): Promise<void> {
  await runtime.bindEnvironment({
    session,
    profileId: ScienceEnvironmentProfileId('fake'),
    signal: new AbortController().signal,
  })
}

/** Assemble one root, fake Python prefix, kernel-capable harness, and bound Science session. */
async function readyPythonHarness(id: string, kernelIdleTimeoutMs?: number): Promise<{
  readonly root: string
  readonly ctx: Context
  readonly runtime: Awaited<ReturnType<typeof createKernelRuntimeHarness>>['runtime']
  readonly session: Session
}> {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-'))
  roots.push(root)
  const prefix = createFakePythonPrefix(root)
  const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, kernelIdleTimeoutMs)
  contexts.push(harness.ctx)
  const session = createScienceSession(harness.ctx, id)
  await bindFakePython(harness.runtime, session)
  return { root, ctx: harness.ctx, runtime: harness.runtime, session }
}

/**
 * Chmods a caller-set target read-only the moment the kernel's own confined
 * spawn is attempted (identified by `stdio.stdin === 'pipe'`), reaching a
 * failure window strictly after session-scratch materialization but
 * strictly before createRunScratch.
 */
class ChmodOnKernelSpawnSubprocess extends LocalSubprocessRuntime {
  chmodTarget: string | undefined

  override spawn(spec: Parameters<LocalSubprocessRuntime['spawn']>[0]): ReturnType<LocalSubprocessRuntime['spawn']> {
    if (spec.stdio.stdin === 'pipe' && this.chmodTarget !== undefined) chmodSync(this.chmodTarget, 0o500)
    return super.spawn(spec)
  }
}

/**
 * Wraps a real subprocess runtime so the kernel's own confined spawn
 * (identified by `stdio.stdin === 'pipe'`, unique among this harness's
 * spawns — `mkfifo` uses `stdin: 'ignore'`) has its handle transformed by
 * `transform`; every other spawn and every other method delegates
 * unchanged. Matches `kernel-set.spec.ts`'s own `wrapWithUnprovenQuiescence` pattern.
 */
function wrapKernelSpawn(inner: SubprocessRuntime, transform: (handle: SubprocessHandle) => SubprocessHandle): SubprocessRuntime {
  return {
    executionWorld: inner.executionWorld,
    resolveExecutable: (command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal) =>
      inner.resolveExecutable(command, env, signal),
    spawn: (spec: SubprocessSpawnSpec) => {
      const handle = inner.spawn(spec)
      return spec.stdio.stdin === 'pipe' ? transform(handle) : handle
    },
    spawnTerminal: (spec: Parameters<SubprocessRuntime['spawnTerminal']>[0]) => inner.spawnTerminal(spec),
  } as unknown as SubprocessRuntime
}

describe('ScienceRuntime.startRun preflight', () => {
  it('rejects malformed source before any kernel work', async () => {
    const { runtime, session } = await readyPythonHarness('science-run-preflight-source')
    await expect(runtime.startRun({
      session, language: 'python', code: '', ...authorizePythonRun(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('requires an applied environment before acquiring a kernel', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-unready-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-unready')
    await expect(harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
  })

  it('rejects a run for a language the applied environment has no available binding for', async () => {
    // readyPythonHarness binds a profile with only pythonPrefix configured:
    // the environment is applied (python is available), but r was never
    // observed at all — selectBinding must still refuse it.
    const { runtime, session } = await readyPythonHarness('science-run-unbound-language')
    await expect(runtime.startRun({
      session, language: 'r', code: kernelAction({ status: 'ok' }),
      ...authorizeRun(session, 'r'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY', message: 'Science r environment is not available' })
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('queues a second concurrent run for the same session instead of rejecting or cancelling it', async () => {
    // Regression for a Science Runtime bug: two run_python/run_r calls
    // issued together in one assistant step (the durable session log admits
    // only one 'running' run at a time — transition.ts's own
    // `applyRunStarted` invariant) used to depend entirely on the tool
    // scheduler to serialize them; a caller that DID reach `startRun` while
    // another was live got an outright `RUNTIME_BUSY` rejection instead of
    // a real turn. `reserveQueued` now queues that second caller instead.
    const { runtime, session } = await readyPythonHarness('science-run-busy')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 50 }),
      ...authorizePythonRun(session, 'science-run-busy-1'), signal: new AbortController().signal,
    })
    const secondStarting = runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-busy-2'), signal: new AbortController().signal,
    })
    await expect(first.done).resolves.toMatchObject({ terminal: { status: 'success' } })
    const second = await secondStarting
    await expect(second.done).resolves.toMatchObject({ terminal: { status: 'success' } })
    expect(session.events.filter(event => event.type === 'science/run-started')).toHaveLength(2)
  })

  it('cancels a queued run cleanly, without ever spawning a kernel, when its own signal aborts before its turn arrives', async () => {
    const { runtime, session } = await readyPythonHarness('science-run-queued-cancel')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 5_000, trapSigint: true }),
      ...authorizePythonRun(session, 'science-run-queued-cancel-1'), signal: new AbortController().signal,
    })
    const secondCaller = new AbortController()
    const secondStarting = runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-queued-cancel-2'), signal: secondCaller.signal,
    })
    secondCaller.abort()
    await expect(secondStarting).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    first.cancel()
    await expect(first.done).resolves.toMatchObject({ terminal: { status: 'cancelled' } })
    expect(session.events.some(event => event.type === 'science/run-started'
      && event.data.run.toolCallId === 'science-run-queued-cancel-2')).toBe(false)
  })

  it('rejects a queued run with SERVICE_DISPOSING, without acquiring a lease, once the Runtime begins disposing while it waits', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-queued-dispose-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-queued-dispose')
    await bindFakePython(harness.runtime, session)
    const first = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 5_000, trapSigint: true }),
      ...authorizePythonRun(session, 'science-run-queued-dispose-1'), signal: new AbortController().signal,
    })
    const secondStarting = harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-queued-dispose-2'), signal: new AbortController().signal,
    })
    // Attached before disposal, not after: `secondStarting` can reject the
    // instant `disposeAll` cancels the run it is queued behind, and nothing
    // may leave it unhandled in between.
    const secondRejection = expect(secondStarting).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' })
    await harness.runtimeFiber.dispose()
    await secondRejection
    await expect(first.done).resolves.toMatchObject({ terminal: { status: 'cancelled' } })
    expect(session.events.some(event => event.type === 'science/run-started'
      && event.data.run.toolCallId === 'science-run-queued-dispose-2')).toBe(false)
  })

  it('rejects a fresh run with RUNTIME_BUSY when a prior run-finished append never committed, leaving the projection with an open run', async () => {
    // The lease itself is released once settlePublishedKernelRun's outer
    // finally runs, even though run-finished never committed — so a second
    // startRun call must be refused by the projection's own open-run check
    // (index.ts), not by the lease registry's busy check.
    const { runtime, session } = await readyPythonHarness('science-run-stuck-open')
    const finishError = new Error('injected run-finished append failure')
    rejectSessionAppend(session, 'science/run-finished', finishError)
    const stuck = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-stuck-open-1'), signal: new AbortController().signal,
    })
    await expect(stuck.done).rejects.toMatchObject({ code: 'TERMINAL_COMMIT_FAILED' })
    await expect(runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-stuck-open-2'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
  })

  it('rejects kernel execution pre-publication on win32', async () => {
    const { runtime, session } = await readyPythonHarness('science-run-win32')
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    if (original === undefined) throw new Error('process.platform descriptor is unavailable')
    Object.defineProperty(process, 'platform', { ...original, value: 'win32' })
    try {
      await expect(runtime.startRun({
        session, language: 'python', code: kernelAction({ status: 'ok' }),
        ...authorizePythonRun(session), signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'KERNEL_UNSUPPORTED_PLATFORM' })
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('rejects an R run whose session scratch directory would contain an ASCII space', async () => {
    // bindEnvironment's own R probe already rejects a space in the same
    // session-scratch root (environment.spec.ts's own "spaced" coverage), so
    // this reaches startRun's independent check the same way that test does:
    // an environment-bound fact appended directly, bypassing the probe.
    const root = mkdtempSync(join(process.cwd(), '.science runtime-r-space-'))
    roots.push(root)
    const prefix = createFakeRPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { r: { rPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-r-space')
    session.append('science/environment-bound', {
      version: 1,
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('r'),
        configuredAt: 1,
        validatedAt: 1,
        status: 'applied',
        r: {
          language: 'r',
          configuredPrefix: prefix,
          canonicalPrefix: prefix,
          executable: join(prefix, 'bin', 'Rscript'),
          executableIdentity: 'test-identity',
          languageVersion: 'Fake R 4.5.0',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: 'b'.repeat(64),
          packages: [{ name: 'base', version: '4.5.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
          capability: 'available',
        },
      },
    })
    await expect(harness.runtime.startRun({
      session, language: 'r', code: kernelAction({ status: 'ok' }),
      ...authorizeRun(session, 'r'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
  })

  it('aggregates a vetoed run-started append with cleanup failures on both the unpublished run directory and the session scratch root', async () => {
    // An environment-bound fact appended directly (bypassing bindEnvironment,
    // as the R-space test above does) means this startRun's own
    // materializeSessionScratch call is the FIRST ever for this session
    // (scratchPreparation.created === true), so a vetoed run-started append
    // reaches both real rollback attempts instead of rollbackSessionScratch's
    // no-op fast path for already-owned scratch.
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-aggregate-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-aggregate-cleanup')
    const dshHome = join(root, 'dsh-home')
    const sessionScratch = await planSessionScratch(dshHome, session)
    session.append('science/environment-bound', {
      version: 1,
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('fake'),
        configuredAt: 1,
        validatedAt: 1,
        status: 'applied',
        python: {
          language: 'python',
          configuredPrefix: prefix,
          canonicalPrefix: prefix,
          executable: join(prefix, 'bin', 'python'),
          executableIdentity: 'test-identity',
          languageVersion: 'Fake Python 3.13.5',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: 'b'.repeat(64),
          packages: [{ name: 'pip', version: '24.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
          capability: 'available',
        },
      },
    })
    const appendError = new Error('injected run-started append failure')
    rejectSessionAppend(session, 'science/run-started', appendError, () => {
      // Fires only once materializeSessionScratch and createRunScratch have
      // already succeeded, so this chmod targets cleanup, not creation.
      chmodSync(sessionScratch.runs, 0o500)
      chmodSync(dirname(sessionScratch.root), 0o500)
    })
    try {
      await expect(harness.runtime.startRun({
        session, language: 'python', code: kernelAction({ status: 'ok' }),
        ...authorizePythonRun(session), signal: new AbortController().signal,
      })).rejects.toThrow(AggregateError)
    } finally {
      chmodSync(sessionScratch.runs, 0o700)
      chmodSync(dirname(sessionScratch.root), 0o700)
    }
  })

  it('aggregates a kernel-acquisition failure with a session-scratch rollback failure (root not yet created by any prior operation)', async () => {
    // An environment-bound fact appended directly (bypassing bindEnvironment,
    // as the R-space test above does) means this startRun's own
    // materializeSessionScratch call is the FIRST ever for this session
    // (scratchPreparation.created === true). The kernel spawn itself then
    // fails (no-ready driver, short deadline) before createRunScratch ever
    // runs, so runScratch stays undefined and the AggregateError's message
    // selects the pre-publication branch.
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-aggregate-prekernel-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ChmodOnKernelSpawnSubprocess)
    const runner = createFakeSandboxRunner(root)
    await ctx.plugin(LocalSandboxProvider, {
      runnerCommand: [runner],
      runnerFailureSignatures: ['science-runtime fake runner failure'],
    })
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { fake: { pythonPrefix: prefix } },
      timeoutMs: 10_000,
    })
    const runtime = ctx.scienceRuntime
    const session = createScienceSession(ctx, 'science-run-aggregate-prekernel')
    const dshHome = join(root, 'dsh-home')
    const sessionScratch = await planSessionScratch(dshHome, session)
    session.append('science/environment-bound', {
      version: 1,
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('fake'),
        configuredAt: 1,
        validatedAt: 1,
        status: 'applied',
        python: {
          language: 'python',
          configuredPrefix: prefix,
          canonicalPrefix: prefix,
          executable: join(prefix, 'bin', 'python'),
          executableIdentity: 'test-identity',
          languageVersion: 'Fake Python 3.13.5',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: 'b'.repeat(64),
          packages: [{ name: 'pip', version: '24.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
          capability: 'available',
        },
      },
    })
    installTestKernelSet(ctx, runtime, { assetsRoot: KERNEL_ASSETS_NO_READY_ROOT, kernelStartTimeoutMs: 200 })
    const subprocess = ctx.subprocess as ChmodOnKernelSpawnSubprocess
    subprocess.chmodTarget = dirname(sessionScratch.root)
    try {
      await expect(runtime.startRun({
        session, language: 'python', code: kernelAction({ status: 'ok' }),
        ...authorizePythonRun(session), signal: new AbortController().signal,
      })).rejects.toThrow(AggregateError)
    } finally {
      chmodSync(dirname(sessionScratch.root), 0o700)
    }
  })
})

describe('ScienceRuntime.startRun kernel acquisition', () => {
  it('commits kernel-state(started) before run-started on a fresh spawn, carrying the run\'s kernelEpoch', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-fresh-spawn')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await handle.done
    const kernelStateIndex = session.events.findIndex(event => event.type === 'science/kernel-state')
    const runStartedIndex = session.events.findIndex(event => event.type === 'science/run-started')
    expect(kernelStateIndex).toBeGreaterThanOrEqual(0)
    expect(kernelStateIndex).toBeLessThan(runStartedIndex)
    const runStarted = session.events[runStartedIndex]
    const kernelState = session.events[kernelStateIndex]
    expect(runStarted?.data).toMatchObject({ run: { kernelEpoch: 1 } })
    expect(kernelState?.data).toMatchObject({ kernel: { kernelEpoch: 1, language: 'python', state: 'started' } })
  })

  it('reuses the same kernel epoch across two runs (state persistence at the protocol level)', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-reuse')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-reuse-1'), signal: new AbortController().signal,
    })
    await first.done
    const second = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-reuse-2'), signal: new AbortController().signal,
    })
    await second.done
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started).toHaveLength(2)
    expect(started[0]?.data).toMatchObject({ run: { kernelEpoch: 1 } })
    expect(started[1]?.data).toMatchObject({ run: { kernelEpoch: 1 } })
    expect(session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(1)
  })

  it('ends the stale kernel with environment-rebound and starts a fresh epoch when the environment rebinds', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-rebind')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-rebind-1'), signal: new AbortController().signal,
    })
    await first.done
    const projection = replayScience(session.events)
    const environment = projection?.environment
    if (environment === null || environment === undefined) throw new Error('missing applied environment')
    session.append('science/environment-bound', {
      version: 1,
      environment: { ...environment, revision: environment.revision + 1, configuredAt: Date.now(), validatedAt: Date.now() },
    })
    const second = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-rebind-2'), signal: new AbortController().signal,
    })
    await second.done
    const kernelFacts = session.events.filter(event => event.type === 'science/kernel-state')
    expect(kernelFacts).toHaveLength(3)
    expect(kernelFacts[1]?.data).toMatchObject({ kernel: { state: 'exited', reason: 'environment-rebound', kernelEpoch: 1 } })
    expect(kernelFacts[2]?.data).toMatchObject({ kernel: { state: 'started', kernelEpoch: 2 } })
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started[1]?.data).toMatchObject({ run: { kernelEpoch: 2 } })
  })

  it('lets a Python and R run issued together (Promise.all, no await between them) both complete rather than cancelling whichever is second', async () => {
    // Regression: a model issuing run_python and run_r in one assistant step
    // used to have the second call's `startRun` reach `KernelSet.acquire`
    // only once the tool scheduler finally let it start (after the first
    // call's whole result committed), and a caller-signal abort landing in
    // that widened window produced `OPERATION_CANCELLED` with no
    // `run-started` fact — see the Agent Note. Both must still get a real,
    // durable result when issued together and never cancelled.
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-cross-language-'))
    roots.push(root)
    const pythonPrefix = createFakePythonPrefix(root)
    const rPrefix = createFakeRPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { both: { pythonPrefix, rPrefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-cross-language')
    await harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('both'), signal: new AbortController().signal,
    })
    // One shared step/request-header, one tool/call per language — the same
    // facts a real assistant step emitting both calls together produces.
    const authorized = authorizeConcurrentRuns(session)
    const [pythonHandle, rHandle] = await Promise.all([
      harness.runtime.startRun({
        session, language: 'python', code: kernelAction({ status: 'ok' }),
        toolCallId: authorized.python, requestHeaderSeq: authorized.requestHeaderSeq, signal: new AbortController().signal,
      }),
      harness.runtime.startRun({
        session, language: 'r', code: kernelAction({ status: 'ok' }),
        toolCallId: authorized.r, requestHeaderSeq: authorized.requestHeaderSeq, signal: new AbortController().signal,
      }),
    ])
    await expect(pythonHandle.done).resolves.toMatchObject({ terminal: { status: 'success', language: 'python' } })
    await expect(rHandle.done).resolves.toMatchObject({ terminal: { status: 'success', language: 'r' } })
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started).toHaveLength(2)
    expect(started.map(event => event.data.run.language).sort()).toEqual(['python', 'r'])
  })

  it('allocates kernelEpoch N+1 through the real durable-projection allocator for a session seeded with prior kernel facts', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-epoch-continuity')
    const projection = replayScience(session.events)
    const environment = projection?.environment
    if (
      environment === null || environment === undefined
      || environment.python === undefined || environment.python.capability !== 'available'
    ) {
      throw new Error('missing available python environment')
    }
    // Seeded directly (no live kernel ever spawned in this test), matching a
    // session resumed after a Host restart whose prior kernel history is
    // durable but not live: `nextKernelEpoch` (index.ts) must derive the
    // next epoch from the projection's last kernel record alone.
    const startedAt = Date.now()
    session.append('science/kernel-state', {
      version: 1,
      kernel: {
        kernelEpoch: 1,
        language: 'python',
        state: 'started',
        environmentRevision: environment.revision,
        environmentFingerprint: environment.python.bindingFingerprint,
        at: startedAt,
      },
    })
    session.append('science/kernel-state', {
      version: 1,
      kernel: {
        kernelEpoch: 1,
        language: 'python',
        state: 'exited',
        reason: 'idle',
        startedAt,
        environmentRevision: environment.revision,
        environmentFingerprint: environment.python.bindingFingerprint,
        at: Date.now(),
      },
    })
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await handle.done
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started).toHaveLength(1)
    expect(started[0]?.data).toMatchObject({ run: { kernelEpoch: 2 } })
    const kernelFacts = session.events.filter(event => event.type === 'science/kernel-state')
    expect(kernelFacts[2]?.data).toMatchObject({ kernel: { state: 'started', kernelEpoch: 2 } })
  })

  it('maps a spawn that never reaches READY to a pre-publication KERNEL_START_FAILED rejection', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-kernel-start-failed-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-kernel-start-failed')
    await bindFakePython(harness.runtime, session)
    // The no-ready driver never sends READY: KernelProcess.start() throws
    // KernelProtocolError once the (short) start deadline elapses, which
    // startRun must translate to KERNEL_START_FAILED before publication.
    installTestKernelSet(harness.ctx, harness.runtime, {
      assetsRoot: KERNEL_ASSETS_NO_READY_ROOT,
      kernelStartTimeoutMs: 200,
    })
    await expect(harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'KERNEL_START_FAILED' })
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('classifies a discarded kernel whose own teardown also failed as KERNEL_START_FAILED with the AggregateError cause class', async () => {
    const { root, runtime, session } = await readyPythonHarness('science-run-discard-aggregate')
    const sessionScratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    // This session's first-ever startRun spawns kernel epoch 1.
    const planned = planKernelScratch(sessionScratch, 'python', 1)
    const appendError = new Error('injected kernel-state append failure')
    rejectSessionAppend(session, 'science/kernel-state', appendError, () => {
      // Also make the fresh kernel's own discard-time teardown fail: its
      // response FIFO cannot be unlinked once the containing directory loses
      // write access.
      chmodSync(planned.directory, 0o500)
    })
    try {
      const rejection = runtime.startRun({
        session, language: 'python', code: kernelAction({ status: 'ok' }),
        ...authorizePythonRun(session), signal: new AbortController().signal,
      })
      await expect(rejection).rejects.toMatchObject({ code: 'KERNEL_START_FAILED' })
      await expect(rejection).rejects.toThrow(/the kernel could not be stopped cleanly after its startup failed/)
    } finally {
      chmodSync(planned.directory, 0o700)
    }
  })

  it('classifies a plain kernel spawn failure as KERNEL_START_FAILED with the default cause class', async () => {
    // A subprocess seam that spawns the kernel's own confined process
    // without the requested stdin pipe: KernelProcess's constructor throws a
    // plain Error, never wrapped by discardUnregisteredKernel (that path
    // only runs once a kernel has actually started), so kernelAcquisitionError
    // falls through every specific class to the generic cause-class fallback.
    const { runtime, session, ctx } = await readyPythonHarness('science-run-generic-start-failure')
    installTestKernelSet(ctx, runtime, {
      subprocess: wrapKernelSpawn(ctx.subprocess, handle => ({ ...handle, stdin: undefined })),
    })
    const rejection = runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await expect(rejection).rejects.toMatchObject({ code: 'KERNEL_START_FAILED' })
    await expect(rejection).rejects.toThrow(/the kernel process could not be started/)
  }, 15_000)

  it('classifies a settleKernelExecution rejection as TERMINAL_COMMIT_FAILED (interrupt() itself throws)', async () => {
    // The interrupt-first path calls kernel.interrupt() with no try/catch
    // of its own around that specific call: a subprocess seam whose own
    // interrupt() throws propagates straight out of settleKernelExecution,
    // reaching settlePublishedKernelRun's own catch around that call.
    const { runtime, session, ctx } = await readyPythonHarness('science-run-interrupt-throws')
    installTestKernelSet(ctx, runtime, {
      subprocess: wrapKernelSpawn(ctx.subprocess, handle => ({
        ...handle, interrupt: () => { throw new Error('injected interrupt failure') },
      })),
    })
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 5_000, trapSigint: true }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    handle.cancel()
    await expect(handle.done).rejects.toMatchObject({ code: 'TERMINAL_COMMIT_FAILED' })
  })

  it('classifies a settleKernelExecution rejection as SESSION_NOT_LIVE when the Session detached at the same moment', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-interrupt-throws-detached-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const attached = attachScienceSession(harness.ctx, 'science-run-interrupt-throws-detached')
    await bindFakePython(harness.runtime, attached.session)
    installTestKernelSet(harness.ctx, harness.runtime, {
      subprocess: wrapKernelSpawn(harness.ctx.subprocess, handle => ({
        ...handle, interrupt: () => { throw new Error('injected interrupt failure') },
      })),
    })
    const handle = await harness.runtime.startRun({
      session: attached.session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 5_000, trapSigint: true }),
      ...authorizePythonRun(attached.session), signal: new AbortController().signal,
    })
    // Detaching the Session aborts the run's own OperationControl the same
    // way cancel() does (session-detached cause), triggering the same
    // interrupt-first path — but by the time settleKernelExecution's own
    // rejection is caught, the Session is already gone.
    attached.detach()
    await expect(handle.done).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
  })

  it('passes a ScienceRuntimeError from KernelSet.acquire through unchanged (confinement failure at kernel spawn)', async () => {
    // confine() fails before KernelProcess ever spawns a driver, so this
    // reuses the real subprocess/sandbox composition (mkfifo genuinely
    // creates the response FIFO) with only the kernel's own confine call
    // wrapped to report partial enforcement — bindEnvironment's own probes,
    // already run against the real (full) sandbox, are unaffected.
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-confine-passthrough-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-confine-passthrough')
    await bindFakePython(harness.runtime, session)
    installTestKernelSet(harness.ctx, harness.runtime, {
      sandbox: {
        confine: (argv: readonly string[], policy: SandboxPolicy) =>
          ({ ...harness.ctx.sandbox.confine(argv, policy), enforcement: 'partial' as const }),
      } as unknown as typeof harness.ctx.sandbox,
    })
    await expect(harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE', message: 'Science requires full sandbox enforcement' })
  })

  it('bounds kernel spawn by the run\'s own cancellation, not only kernelStartTimeoutMs', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-kernel-spawn-cancel-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-spawn-cancel')
    await bindFakePython(harness.runtime, session)
    // The delayed-ready driver withholds READY for 300ms; kernelStartTimeoutMs
    // is generously long so only the request's own signal, threaded into
    // KernelProcess.start, can end the wait early. Pre-fix, cancel() was
    // inert during spawn: startRun would only observe it at the next
    // assertPrepublication check once the spawn eventually finished on its
    // own, ~300ms later.
    installTestKernelSet(harness.ctx, harness.runtime, {
      assetsRoot: KERNEL_ASSETS_DELAYED_READY_ROOT,
      kernelStartTimeoutMs: 5_000,
    })
    const controller = new AbortController()
    const pending = harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: controller.signal,
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    const abortedAt = Date.now()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(Date.now() - abortedAt).toBeLessThan(200)
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('disarms the acquired kernel\'s idle timer immediately on acquisition, before run-started commits', async () => {
    const { ctx, session, runtime } = await readyPythonHarness('science-run-idle-disarm-order')
    // Records call order across two independently observed points: the
    // real prototype method every KernelSet instance shares (so this
    // catches the disarm regardless of which internal KernelSet the
    // Runtime holds) and the durable run-started append, via the same
    // internal/dispatch injection pattern `failures.spec.ts` uses.
    // `mockImplementation` still calls through to the real disarm, so the
    // kernel's idle timer is genuinely cleared, not merely observed.
    const order: string[] = []
    // Captured before vi.spyOn replaces the prototype method (referencing
    // it afterward would recurse into the spy itself); called via
    // `.apply(this, args)` below, so it is never invoked unbound.
    // oxlint-disable-next-line typescript/unbound-method
    const original = KernelSet.prototype.disarmIdleTimer
    const disarmSpy = vi.spyOn(KernelSet.prototype, 'disarmIdleTimer')
      .mockImplementation(function (this: KernelSet, ...args: Parameters<typeof original>) {
        order.push('disarm')
        original.apply(this, args)
      })
    const stop = ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [, event] = args as [unknown, { readonly type?: string }]
      if (event?.type === 'science/run-started') order.push('run-started')
    }, { global: true })
    try {
      const handle = await runtime.startRun({
        session, language: 'python', code: kernelAction({ status: 'ok' }),
        ...authorizePythonRun(session), signal: new AbortController().signal,
      })
      await handle.done
    } finally {
      stop()
      disarmSpy.mockRestore()
    }
    // Pre-fix: `startRun` called `disarmIdleTimer` only after `run-started`
    // committed, several real awaits after the kernel was actually
    // acquired — a window an idle expiry could spuriously fire inside.
    expect(order).toEqual(['disarm', 'run-started'])
  })

  it('spawns a kernel through the constructor\'s own KernelSet, never a test replacement (nextEpoch/onKernelStarted/onKernelEnded wiring)', async () => {
    // A prefix whose forwarding case ignores the given driverPath and always
    // runs the fake kernel-wire-protocol driver: resolveKernelDriverPath still resolves the
    // real shipped kernel_python.py path unmodified (installTestKernelSet is
    // never called), so this is the only way to exercise ScienceRuntime's
    // own constructor-wired nextEpoch/onKernelStarted/onKernelEnded
    // callbacks without a real interpreter.
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-real-wiring-'))
    roots.push(root)
    const fakeDriverPath = join(FIXTURES, 'fake-kernel-driver.mjs')
    const prefix = join(root, 'fake-conda-real-wiring')
    mkdirSync(join(prefix, 'bin'), { recursive: true })
    mkdirSync(join(prefix, 'conda-meta'), { recursive: true })
    writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-08-13 <==\n+python-3.13.5\n')
    const executable = join(prefix, 'bin', 'python')
    writeFileSync(executable, `#!/bin/sh
case " $* " in
  *" --version "*) printf 'Fake Python 3.13.5\\n' ;;
  *" -m "*) printf '[{"name":"pip","version":"24.0"}]' ;;
  *" -c "*) printf 'dsh-科学-✓' ;;
  *)
    while [ "$#" -gt 2 ]; do shift; done
    exec "${process.execPath}" "${fakeDriverPath}" "$2"
    ;;
esac
`)
    chmodSync(executable, 0o700)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(LocalSubprocessRuntime)
    const runner = createFakeSandboxRunner(root)
    await ctx.plugin(LocalSandboxProvider, {
      runnerCommand: [runner],
      runnerFailureSignatures: ['science-runtime fake runner failure'],
    })
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { fake: { pythonPrefix: prefix } },
      timeoutMs: 10_000,
    })
    const runtime = ctx.scienceRuntime
    const session = createScienceSession(ctx, 'science-real-wiring')
    await bindFakePython(runtime, session)
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await expect(handle.done).resolves.toMatchObject({ terminal: { status: 'success' } })
    expect(session.events.some(event => event.type === 'science/kernel-state')).toBe(true)
  })
})

describe('ScienceRuntime.startRun terminal classification', () => {
  it('classifies a DONE ok/error frame as success/EXECUTION_FAILED with bounded output tails', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-classify')
    const ok = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-classify-ok'), signal: new AbortController().signal,
    })
    await expect(ok.done).resolves.toMatchObject({ terminal: { status: 'success' } })

    const failed = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'error', detail: 'ValueError' }),
      ...authorizePythonRun(session, 'science-run-classify-error'), signal: new AbortController().signal,
    })
    await expect(failed.done).resolves.toMatchObject({
      terminal: { status: 'failed', failureCode: 'EXECUTION_FAILED' },
    })
    expect(session.events.filter(event => event.type === 'science/run-finished')).toHaveLength(2)
  })

  it('classifies a DONE interrupted frame with no host abort in flight as failed/EXECUTION_FAILED and keeps the kernel', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-self-interrupted')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'interrupted' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await expect(handle.done).resolves.toMatchObject({
      terminal: { status: 'failed', failureCode: 'EXECUTION_FAILED' },
    })
    // The kernel survives (no exited kernel-state fact) and serves a following run on the same epoch.
    expect(session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(1)
    const next = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-self-interrupted-next'), signal: new AbortController().signal,
    })
    await expect(next.done).resolves.toMatchObject({ terminal: { status: 'success' } })
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started[1]?.data).toMatchObject({ run: { kernelEpoch: 1 } })
  })

  it('never populates exitCode/signal on a kernel-run terminal', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-no-exit-code')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    const result = await handle.done
    expect(result.terminal).not.toHaveProperty('exitCode')
    expect(result.terminal).not.toHaveProperty('signal')
  })

  it('classifies an uncommanded kernel crash mid-run as KERNEL_DIED, ending the kernel with reason crash', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-crash')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'crash' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await expect(handle.done).resolves.toMatchObject({
      terminal: { status: 'failed', failureCode: 'KERNEL_DIED' },
    })
    await vi.waitFor(() => {
      expect(session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(2)
    })
    const kernelFacts = session.events.filter(event => event.type === 'science/kernel-state')
    expect(kernelFacts[1]?.data).toMatchObject({ kernel: { state: 'exited', reason: 'crash' } })
  })

  it('classifies a protocol-breaking driver reply as KERNEL_DIED for the run and protocol for the kernel', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-protocol')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'garbage' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await expect(handle.done).resolves.toMatchObject({
      terminal: { status: 'failed', failureCode: 'KERNEL_DIED' },
    })
    await vi.waitFor(() => {
      expect(session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(2)
    })
    const kernelFacts = session.events.filter(event => event.type === 'science/kernel-state')
    expect(kernelFacts[1]?.data).toMatchObject({ kernel: { state: 'exited', reason: 'protocol' } })
  })

  it('reads exact stdout/stderr byte counts from the per-run capture files', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-output')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok', stdout: '运行-✓\n', stderr: 'warn\n' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    const result = await handle.done
    expect(result.stdout).toEqual({ text: '运行-✓\n', bytes: Buffer.byteLength('运行-✓\n'), truncated: false })
    expect(result.stderr).toEqual({ text: 'warn\n', bytes: Buffer.byteLength('warn\n'), truncated: false })
    expect(result.terminal).toMatchObject({ stdoutBytes: result.stdout.bytes, stderrBytes: result.stderr.bytes })
    expect(JSON.stringify(session.events)).not.toContain('运行-✓')
  })

  it('truncates a stdout tail exceeding MAX_OUTPUT_BYTES, retaining exactly the last MAX_OUTPUT_BYTES bytes', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-output-over')
    const written = 'x'.repeat(MAX_OUTPUT_BYTES + 6_000)
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok', stdout: written }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    const result = await handle.done
    expect(result.stdout).toEqual({ text: 'x'.repeat(MAX_OUTPUT_BYTES), bytes: written.length, truncated: true })
    expect(result.terminal).toMatchObject({ stdoutBytes: written.length, stdoutTruncated: true })
  })

  it('does not truncate a stdout tail exactly MAX_OUTPUT_BYTES bytes long', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-output-exact')
    const written = 'x'.repeat(MAX_OUTPUT_BYTES)
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok', stdout: written }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    const result = await handle.done
    expect(result.stdout).toEqual({ text: written, bytes: MAX_OUTPUT_BYTES, truncated: false })
    expect(result.terminal).toMatchObject({ stdoutBytes: MAX_OUTPUT_BYTES, stdoutTruncated: false })
  })

  it('truncates mid-multibyte-character when the tail boundary splits it, matching the byte-level split exactly', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-output-split')
    // 'é' (2 UTF-8 bytes) at the very start, then MAX_OUTPUT_BYTES-1 ASCII
    // bytes: total size MAX_OUTPUT_BYTES+1, so the tail cut (byte offset 1)
    // falls between the two bytes of 'é', leaving a lone continuation byte as
    // the tail's first byte — readCaptureTail reads raw bytes with no
    // multibyte-boundary alignment, so decoding the retained buffer as
    // UTF-8 turns that orphaned continuation byte into one U+FFFD
    // replacement character.
    const written = `é${'x'.repeat(MAX_OUTPUT_BYTES - 1)}`
    expect(Buffer.byteLength(written)).toBe(MAX_OUTPUT_BYTES + 1)
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok', stdout: written }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    const result = await handle.done
    // The retained raw tail is exactly MAX_OUTPUT_BYTES bytes (one lone
    // continuation byte decoding to one U+FFFD, followed by MAX_OUTPUT_BYTES-1
    // ASCII bytes) — this exact decoded text is the only value that byte
    // offset can produce, so matching it proves the retained-tail length.
    const expectedTail = `�${'x'.repeat(MAX_OUTPUT_BYTES - 1)}`
    expect(result.stdout).toEqual({ text: expectedTail, bytes: MAX_OUTPUT_BYTES + 1, truncated: true })
    expect(result.terminal).toMatchObject({ stdoutBytes: MAX_OUTPUT_BYTES + 1, stdoutTruncated: true })
  })

  it('marks a run outputDegraded iff the DONE frame carried the capture-degraded flag', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-degraded')
    const degraded = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok', flags: 'capture-degraded' }),
      ...authorizePythonRun(session, 'science-run-degraded-1'), signal: new AbortController().signal,
    })
    await expect(degraded.done).resolves.toMatchObject({ terminal: { outputDegraded: true } })
    const clean = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-degraded-2'), signal: new AbortController().signal,
    })
    const cleanResult = await clean.done
    expect(cleanResult.terminal).not.toHaveProperty('outputDegraded')
  })
})

describe('ScienceRuntime.startRun interrupt-first cancel/timeout', () => {
  it('survives a cancel answered by DONE interrupted (interrupt-survive)', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-interrupt-survive')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 10_000, trapSigint: true }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    handle.cancel()
    await expect(handle.done).resolves.toMatchObject({ terminal: { status: 'cancelled', failureCode: 'CANCELLED' } })
    // The kernel survives: no exited kernel-state fact, and a fresh run reuses the same epoch.
    expect(session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(1)
    const next = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-interrupt-survive-next'), signal: new AbortController().signal,
    })
    await expect(next.done).resolves.toMatchObject({ terminal: { status: 'success' } })
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started[1]?.data).toMatchObject({ run: { kernelEpoch: 1 } })
  })

  it('escalates and retires the kernel when no DONE arrives within the descendant grace window (interrupt-escalate)', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-escalate')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 60_000, trapSigint: false }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    handle.cancel()
    await expect(handle.done).resolves.toMatchObject({ terminal: { status: 'cancelled', failureCode: 'CANCELLED' } })
    await vi.waitFor(() => {
      expect(session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(2)
    }, { timeout: 10_000 })
    const kernelFacts = session.events.filter(event => event.type === 'science/kernel-state')
    expect(kernelFacts[1]?.data).toMatchObject({ kernel: { state: 'exited', reason: 'run-escalation' } })
    const next = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-escalate-next'), signal: new AbortController().signal,
    })
    await expect(next.done).resolves.toMatchObject({ terminal: { status: 'success' } })
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started[1]?.data).toMatchObject({ run: { kernelEpoch: 2 } })
  }, 15_000)

  it('retires the kernel when SIGINT lands on an effectively idle kernel (taint-retirement)', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-taint', 500)
    // A run that replies immediately, but is cancelled right as it starts:
    // the SIGINT lands after the kernel already settled its own DONE ok, so
    // the run's own terminal stays first-cause-governed and the kernel is
    // retired rather than reused.
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    handle.cancel()
    const result = await handle.done
    expect(result.terminal.status).toBe('cancelled')
    await vi.waitFor(() => {
      expect(session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(2)
    })
    const kernelFacts = session.events.filter(event => event.type === 'science/kernel-state')
    expect(kernelFacts[1]?.data).toMatchObject({ kernel: { state: 'exited', reason: 'run-escalation' } })
  })

  it('logs a failed background retirement without rejecting the run\'s own settlement (taint-retirement fire-and-forget)', async () => {
    const { root, ctx, session, runtime } = await readyPythonHarness('science-run-taint-retire-fails', 500)
    const sessionScratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    const planned = planKernelScratch(sessionScratch, 'python', 1)
    const errors: string[] = []
    ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    // Removing the response FIFO during the background retirement's own
    // end() needs write access on the kernel directory: chmodding it after
    // READY (already reached — the run above already completed) makes that
    // retirement's own teardown fail, without touching this run's own
    // settlement at all.
    chmodSync(planned.directory, 0o500)
    handle.cancel()
    try {
      const result = await handle.done
      expect(result.terminal.status).toBe('cancelled')
      await vi.waitFor(() => { expect(errors).toHaveLength(1) })
      expect(errors[0]).toContain('kernel retirement failed')
    } finally {
      chmodSync(planned.directory, 0o700)
    }
  })

  it('settles a published run as timed-out through the same interrupt-first path', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-timeout-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 3_000)
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-timeout')
    await bindFakePython(harness.runtime, session)
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 60_000, trapSigint: true }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await expect(handle.done).resolves.toMatchObject({ terminal: { status: 'timed-out', failureCode: 'TIMEOUT' } })
  }, 15_000)
})

describe('ScienceRuntime.startRun capture and replay', () => {
  it('auto-captures an eligible file written to the run\'s artifact directory', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-capture')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    const result = await handle.done
    expect(result.capture).toBeDefined()
  })

  it('replays a cold session to the same run history as the live one, with its still-open kernel derived interrupted', async () => {
    const { session, runtime } = await readyPythonHarness('science-run-cold-replay')
    const handle = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await handle.done
    const live = replayScience(session.events)
    // The live kernel survives a successful run (reusable, not retired), but
    // a cold resume has no live process to observe: `session/end-seed`
    // derives it interrupted rather than presenting a kernel a fresh
    // Host restart could never actually own.
    expect(live?.kernels).toMatchObject([{ state: 'started' }])
    const cold = Session.create(SessionId('science-run-cold-replay-cold'), session.events)
    const coldProjection = replayScience(cold.events)
    expect(coldProjection?.kernels).toMatchObject([{ state: 'interrupted', kernelEpoch: 1 }])
    expect(coldProjection?.runs).toEqual(live?.runs)
    expect(coldProjection?.environment).toEqual(live?.environment)
  })
})
