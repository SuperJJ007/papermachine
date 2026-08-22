/**
 * `KernelSet` against a fake kernel-wire-protocol driver (`fixtures/kernel-set-assets/`),
 * driven through the real `dsh-subprocess-local` and `dsh-sandbox-local`
 * providers the way `kernel-process.spec.ts` composes them: epoch
 * allocation, idle expiry, environment-rebound respawn, same-id quarantine,
 * detach/dispose teardown, and callback fidelity.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import { ScienceEnvironmentProfileId, ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceEnvironmentBinding, ScienceInterpreterAvailableBinding, ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { KernelExitedError, KernelProcess, KernelProtocolError } from '../src/kernel-process.ts'
import type { KernelExecuteRequest } from '../src/kernel-process.ts'
import {
  KernelEpochRegressionError,
  KernelSet,
  KernelSetConflictError,
  KernelSetDetachedError,
  KernelSetQuarantinedError,
} from '../src/kernel-set.ts'
import type { AcquiredKernel, ScienceKernelEndedFact, ScienceKernelStartedFact } from '../src/kernel-set.ts'
import { ensureSessionScratch, planKernelScratch } from '../src/scratch.ts'
import type { ScienceSessionScratch } from '../src/scratch.ts'
import { attachScienceSession, createFakeSandboxRunner } from './harness.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const ASSETS_ROOT = join(FIXTURES, 'kernel-set-assets')
const DELAYED_READY_ASSETS_ROOT = join(FIXTURES, 'kernel-set-assets-delayed-ready')
const NO_READY_ASSETS_ROOT = join(FIXTURES, 'kernel-set-assets-no-ready')

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A fake "interpreter" executable: discards every hardening flag
 * `interpreterArgv` prepends and forwards the trailing driver-path/fifo-path
 * pair to this Node process (see `kernel-process.spec.ts`'s identical fixture).
 */
function createFakeInterpreterPrefix(root: string, language: ScienceLanguage): string {
  const prefix = join(root, `fake-${language}-conda`)
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  const executable = join(prefix, 'bin', language === 'python' ? 'python' : 'Rscript')
  writeFileSync(executable, `#!/bin/sh\nwhile [ "$#" -gt 2 ]; do shift; done\nexec "${process.execPath}" "$1" "$2"\n`)
  chmodSync(executable, 0o755)
  return prefix
}

/** Fabricate an already-observed available binding; `KernelSet`/`KernelProcess` never re-validate it. */
function fakeBinding(language: ScienceLanguage, prefix: string): ScienceInterpreterAvailableBinding {
  return {
    language,
    configuredPrefix: prefix,
    canonicalPrefix: prefix,
    executable: join(prefix, 'bin', language === 'python' ? 'python' : 'Rscript'),
    executableIdentity: 'fake-identity',
    languageVersion: 'fake-1.0',
    condaHistorySha256: 'fake-history-sha',
    bindingFingerprint: `fake-binding-${language}`,
    packages: [],
    packagesSha256: 'fake-packages-sha',
    packagesTruncated: false,
    capability: 'available',
  }
}

/**
 * Flush one RUN request's private scratch: a JSON action file the fake
 * driver reads instead of real source (see `kernel-process.spec.ts`'s
 * identical fixture).
 */
async function prepareRun(root: string, runId: string, action: Record<string, unknown>): Promise<KernelExecuteRequest> {
  const dir = join(root, 'kernel-runs', runId)
  const artifactDir = join(dir, 'artifacts')
  await mkdir(artifactDir, { recursive: true })
  const sourcePath = join(dir, 'action.json')
  await writeFile(sourcePath, JSON.stringify(action))
  return {
    runId: ScienceRunId(runId),
    sourcePath,
    cwd: dir,
    stdoutPath: join(dir, 'stdout.txt'),
    stderrPath: join(dir, 'stderr.txt'),
    artifactDir,
    inputDir: join(dir, 'inputs'),
  }
}

/** One recorded `onKernelStarted` / `onKernelEnded` invocation. */
interface Recorded<Fact> {
  readonly session: Session
  readonly fact: Fact
}

/** Test-controlled epoch allocator: an auto-incrementing counter by default, or an exact scripted sequence. */
interface EpochAllocator {
  readonly calls: Session[]
  sequence: number[] | undefined
  readonly fn: (session: Session) => number
}

function createEpochAllocator(): EpochAllocator {
  const calls: Session[] = []
  let counter = 0
  const allocator: EpochAllocator = {
    calls,
    sequence: undefined,
    fn: (session: Session) => {
      calls.push(session)
      if (allocator.sequence !== undefined) {
        const scripted = allocator.sequence[calls.length - 1]
        if (scripted === undefined) throw new Error('test epoch sequence exhausted')
        return scripted
      }
      counter += 1
      return counter
    },
  }
  return allocator
}

/**
 * Wrap a real subprocess runtime so the kernel's own confined spawn
 * (identified by `stdio.stdin === 'pipe'`, unique among this harness's
 * spawns to `KernelProcess`'s spawn — `mkfifo` uses `stdin: 'ignore'`)
 * reports its tree as never provably quiescent within `quiesce()`'s two
 * grace-bounded observations, and its `terminate()` throws — reproducing
 * `quiesce()`'s `{ quiescent: false }` result (as if a straggler descendant
 * survived both escalation tiers) without waiting out real OS-level grace
 * timing. The later unbounded observation resolves once
 * `proveQuiescence()` is called, simulating the straggler finally being
 * reaped.
 */
function wrapWithUnprovenQuiescence(inner: SubprocessRuntime): {
  readonly subprocess: SubprocessRuntime
  readonly proveQuiescence: () => void
} {
  const proven = Promise.withResolvers<boolean>()
  const subprocess = {
    executionWorld: inner.executionWorld,
    resolveExecutable: (command: string) => inner.resolveExecutable(command),
    spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
      const handle = inner.spawn(spec)
      if (spec.stdio.stdin !== 'pipe') return handle
      return {
        ...handle,
        terminate: () => { throw new Error('kernel-set.spec.ts: simulated termination failure (straggler simulation)') },
        waitForExit: (signal?: AbortSignal) => (signal === undefined ? proven.promise : Promise.resolve(false)),
      }
    },
    spawnTerminal: (spec: SubprocessTerminalSpawnSpec) => inner.spawnTerminal(spec),
  } as unknown as SubprocessRuntime
  return { subprocess, proveQuiescence: () => { proven.resolve(true) } }
}

/**
 * Wrap a real subprocess runtime to count every confined kernel spawn (the
 * same `stdio.stdin === 'pipe'` signature {@link wrapWithUnprovenQuiescence}
 * keys on) and every `EXIT` frame written to one of their stdin pipes —
 * `KernelProcess.end()`'s own commanded-teardown signal, the one write site
 * for that frame — without altering any spawned handle's real behavior.
 */
function wrapTrackingKernelSpawns(inner: SubprocessRuntime): {
  readonly subprocess: SubprocessRuntime
  readonly spawnCount: () => number
  readonly exitWriteCount: () => number
} {
  let spawns = 0
  let exitWrites = 0
  const subprocess = {
    executionWorld: inner.executionWorld,
    resolveExecutable: (command: string) => inner.resolveExecutable(command),
    spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
      const handle = inner.spawn(spec)
      if (spec.stdio.stdin !== 'pipe' || handle.stdin === undefined) return handle
      spawns += 1
      const realStdin = handle.stdin
      const trackedStdin = {
        write: (chunk: string) => {
          if (chunk.startsWith('EXIT')) exitWrites += 1
          return realStdin.write(chunk)
        },
      } as unknown as NonNullable<SubprocessHandle['stdin']>
      return { ...handle, stdin: trackedStdin }
    },
    spawnTerminal: (spec: SubprocessTerminalSpawnSpec) => inner.spawnTerminal(spec),
  } as unknown as SubprocessRuntime
  return { subprocess, spawnCount: () => spawns, exitWriteCount: () => exitWrites }
}

interface Harness {
  readonly root: string
  readonly ctx: Context
  readonly dshHome: string
  readonly kernelSet: KernelSet
  readonly started: Recorded<ScienceKernelStartedFact>[]
  readonly ended: Recorded<ScienceKernelEndedFact>[]
  readonly epochAllocator: EpochAllocator
  session(id: string): Promise<{ readonly session: Session; readonly sessionScratch: ScienceSessionScratch }>
  environment(revision: number, languages: readonly ScienceLanguage[]): ScienceEnvironmentBinding
}

/** Assemble one real Session/subprocess-local/sandbox-local composition and a `KernelSet` sharing them. */
async function createHarness(options: { readonly kernelIdleTimeoutMs?: number } = {}): Promise<Harness> {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-kernel-set-'))
  roots.push(root)
  const dshHome = join(root, 'dsh-home')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  const runner = createFakeSandboxRunner(root)
  await ctx.plugin(LocalSandboxProvider, {
    runnerCommand: [runner],
    runnerFailureSignatures: ['science-runtime fake runner failure'],
  })
  const started: Recorded<ScienceKernelStartedFact>[] = []
  const ended: Recorded<ScienceKernelEndedFact>[] = []
  const epochAllocator = createEpochAllocator()
  const kernelSet = new KernelSet({
    subprocess: ctx.subprocess,
    sandbox: ctx.sandbox,
    assetsRoot: ASSETS_ROOT,
    kernelIdleTimeoutMs: options.kernelIdleTimeoutMs ?? 1_800_000,
    kernelStartTimeoutMs: 5_000,
    nextEpoch: epochAllocator.fn,
    onKernelStarted: (session, fact) => { started.push({ session, fact }) },
    onKernelEnded: (session, fact) => { ended.push({ session, fact }) },
  })
  const pythonPrefix = createFakeInterpreterPrefix(root, 'python')
  const rPrefix = createFakeInterpreterPrefix(root, 'r')
  return {
    root,
    ctx,
    dshHome,
    kernelSet,
    started,
    ended,
    epochAllocator,
    session: async (id) => {
      const session = ctx.sessions.create(SessionId(id))
      const sessionScratch = await ensureSessionScratch(dshHome, session)
      return { session, sessionScratch }
    },
    environment: (revision, languages) => ({
      revision,
      profileId: ScienceEnvironmentProfileId('fake'),
      configuredAt: Date.now(),
      validatedAt: Date.now(),
      status: 'applied',
      ...(languages.includes('python') ? { python: fakeBinding('python', pythonPrefix) } : {}),
      ...(languages.includes('r') ? { r: fakeBinding('r', rPrefix) } : {}),
    }),
  }
}

describe('KernelSet', () => {
  it('ends an idle kernel with reason idle after kernelIdleTimeoutMs of no activity', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({ kernelIdleTimeoutMs: 1_000 })
    const { session, sessionScratch } = await harness.session('kernel-idle')
    const { process: kernel } = await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    await vi.advanceTimersByTimeAsync(1_000)
    vi.useRealTimers()
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })
    expect(harness.ended[0]?.fact.reason).toBe('idle')
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'commanded' })
  })

  it('resets the idle timer on a completed execution, extending life past the original deadline', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({ kernelIdleTimeoutMs: 1_000 })
    const { session, sessionScratch } = await harness.session('kernel-idle-reset')
    const { process: kernel } = await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    await vi.advanceTimersByTimeAsync(999)
    const request = await prepareRun(harness.root, 'run-activity', { status: 'ok' })
    await kernel.execute(request)
    harness.kernelSet.resetIdleTimer(session, 'python')
    // Past the ORIGINAL deadline (999 + 2 = 1001 > 1000) but well before the reset one (999 + 1000 = 1999).
    await vi.advanceTimersByTimeAsync(2)
    expect(harness.ended).toHaveLength(0)
    // Positive liveness proof: a no-op resetIdleTimer would
    // already have ended this kernel from the ORIGINAL deadline by now (a
    // mutation the acceptor verified this test previously did not catch);
    // a successful execute against the same kernel object only succeeds
    // while it is still the one live, running process.
    const proofRequest = await prepareRun(harness.root, 'run-after-original-deadline', { status: 'ok' })
    await expect(kernel.execute(proofRequest)).resolves.toMatchObject({ status: 'ok' })
    // Past the reset deadline too.
    await vi.advanceTimersByTimeAsync(1_000)
    vi.useRealTimers()
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })
    expect(harness.ended[0]?.fact.reason).toBe('idle')
  })

  it('never fires the idle timer while a run is in flight (disarmed) and rearms only after it completes', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({ kernelIdleTimeoutMs: 1_000 })
    const { session, sessionScratch } = await harness.session('kernel-idle-disarm')
    const { process: kernel } = await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    harness.kernelSet.disarmIdleTimer(session, 'python')
    // Advance well past what would have been the idle deadline while a "run" is in flight.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(harness.ended).toHaveLength(0)
    // Positive liveness proof: the kernel is still responsive, not merely
    // "not yet observed as ended".
    const request = await prepareRun(harness.root, 'run-mid-disarm', { status: 'ok' })
    await expect(kernel.execute(request)).resolves.toMatchObject({ status: 'ok' })
    // Rearm on DONE: a fresh full window measured from now.
    harness.kernelSet.resetIdleTimer(session, 'python')
    await vi.advanceTimersByTimeAsync(999)
    expect(harness.ended).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })
    expect(harness.ended[0]?.fact.reason).toBe('idle')
  })

  it('is a no-op to disarm or reset a language with no live kernel, and disarm is idempotent on a live one', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-disarm-noop')
    expect(() => { harness.kernelSet.disarmIdleTimer(session, 'python') }).not.toThrow()
    expect(() => { harness.kernelSet.resetIdleTimer(session, 'python') }).not.toThrow()
    await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    harness.kernelSet.disarmIdleTimer(session, 'python')
    // A second disarm finds idleTimer already undefined for this live kernel.
    expect(() => { harness.kernelSet.disarmIdleTimer(session, 'python') }).not.toThrow()
  })

  it('lets python and r kernels coexist independently for one session', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-coexist')
    const environment = harness.environment(1, ['python', 'r'])
    const { process: python } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    const { process: r } = await harness.kernelSet.acquire(session, 'r', environment, sessionScratch)
    expect(python).not.toBe(r)
    expect(harness.started).toHaveLength(2)
    expect(harness.started.map(entry => entry.fact.language).sort()).toEqual(['python', 'r'])
    const { process: pythonAgain } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    const { process: rAgain } = await harness.kernelSet.acquire(session, 'r', environment, sessionScratch)
    expect(pythonAgain).toBe(python)
    expect(rAgain).toBe(r)
    expect(harness.started).toHaveLength(2)
  })

  it('returns the same live kernel on a second acquire with the same environment revision (no respawn)', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-reuse')
    const environment = harness.environment(1, ['python'])
    const { process: first } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    const { process: second } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    expect(second).toBe(first)
    expect(harness.started).toHaveLength(1)
    expect(harness.epochAllocator.calls).toHaveLength(1)
  })

  it('ends a stale-revision live kernel with environment-rebound and spawns a fresh epoch', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-rebind')
    const { process: first } = await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    const { process: second } = await harness.kernelSet.acquire(session, 'python', harness.environment(2, ['python']), sessionScratch)
    expect(second).not.toBe(first)
    expect(harness.ended).toHaveLength(1)
    expect(harness.ended[0]?.fact.reason).toBe('environment-rebound')
    expect(harness.ended[0]?.fact.environmentRevision).toBe(1)
    expect(harness.started).toHaveLength(2)
    expect(harness.started[0]?.fact.kernelEpoch).toBe(1)
    expect(harness.started[1]?.fact.kernelEpoch).toBe(2)
    await expect(first.exited).resolves.toMatchObject({ cause: 'commanded' })
  })

  it('ends the stale kernel exactly once when two concurrent acquire calls race onto the same rebind decision', async () => {
    // Both calls fetch the same live (stale-revision) kernel reference
    // before either has a chance to remove it from entry.kernels: whichever
    // reaches endKernel first tears it down for real; the other's endKernel
    // call must find it already gone and reuse the same in-flight teardown
    // rather than starting a second one for an already-removed kernel.
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-rebind-race')
    await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    expect(harness.started).toHaveLength(1)
    const rebindEnvironment = harness.environment(2, ['python'])
    const [firstResult, secondResult] = await Promise.allSettled([
      harness.kernelSet.acquire(session, 'python', rebindEnvironment, sessionScratch),
      harness.kernelSet.acquire(session, 'python', rebindEnvironment, sessionScratch),
    ])
    expect(firstResult.status).toBe('fulfilled')
    expect(secondResult.status).toBe('fulfilled')
    expect(harness.ended.filter(entry => entry.fact.reason === 'environment-rebound')).toHaveLength(1)
  })

  it('keeps entry.spawning bookkeeping consistent when two concurrent acquire calls race to spawn the same (session, language)', async () => {
    // Out-of-contract concurrent use (this module's own doc: "unspecified
    // interleaving" outside the single-caller-per-session discipline), kept
    // safe rather than corrupting registry bookkeeping: both spawns succeed
    // and both are torn down cleanly regardless of which the registry ends
    // up tracking as this language's live kernel.
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-spawning-race')
    const environment = harness.environment(1, ['python'])
    const [firstResult, secondResult] = await Promise.allSettled([
      harness.kernelSet.acquire(session, 'python', environment, sessionScratch),
      harness.kernelSet.acquire(session, 'python', environment, sessionScratch),
    ])
    expect(firstResult.status).toBe('fulfilled')
    expect(secondResult.status).toBe('fulfilled')
    expect(harness.started).toHaveLength(2)
    const settled = await harness.kernelSet.disposeAll()
    expect(settled.every(result => result.status === 'fulfilled')).toBe(true)
  })

  it('fails loud when the injected epoch allocator returns a non-increasing epoch', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-epoch-regression')
    harness.epochAllocator.sequence = [1, 1]
    await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python', 'r']), sessionScratch)
    await expect(harness.kernelSet.acquire(session, 'r', harness.environment(1, ['python', 'r']), sessionScratch))
      .rejects.toThrow(KernelEpochRegressionError)
  })

  it('ends every live kernel with session-end on detach', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-detach')
    const environment = harness.environment(1, ['python', 'r'])
    await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    await harness.kernelSet.acquire(session, 'r', environment, sessionScratch)
    harness.kernelSet.detach(session)
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(2) })
    expect(harness.ended.map(entry => entry.fact.reason)).toEqual(['session-end', 'session-end'])
  })

  it('is a no-op when detach is called for a session that owns no kernel', async () => {
    const harness = await createHarness()
    const { session } = await harness.session('kernel-detach-empty')
    expect(() => { harness.kernelSet.detach(session) }).not.toThrow()
    expect(harness.ended).toHaveLength(0)
  })

  it('rejects acquire on an exact Session object already detached', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-detached-acquire')
    const environment = harness.environment(1, ['python'])
    await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    harness.kernelSet.detach(session)
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })
    await expect(harness.kernelSet.acquire(session, 'python', environment, sessionScratch))
      .rejects.toThrow(KernelSetDetachedError)
  })

  it('ends every live kernel across every session with service-disposed on disposeAll', async () => {
    const harness = await createHarness()
    const a = await harness.session('kernel-dispose-a')
    const b = await harness.session('kernel-dispose-b')
    const environment = harness.environment(1, ['python'])
    await harness.kernelSet.acquire(a.session, 'python', environment, a.sessionScratch)
    await harness.kernelSet.acquire(b.session, 'python', environment, b.sessionScratch)
    const settled = await harness.kernelSet.disposeAll()
    expect(settled).toHaveLength(2)
    expect(settled.every(result => result.status === 'fulfilled')).toBe(true)
    expect(harness.ended).toHaveLength(2)
    expect(harness.ended.every(entry => entry.fact.reason === 'service-disposed')).toBe(true)
  })

  it('removes an uncommanded crash from the registry and reports reason crash', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-crash')
    const environment = harness.environment(1, ['python'])
    const { process: kernel } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    const crashRequest = await prepareRun(harness.root, 'run-crash', { action: 'crash' })
    await expect(kernel.execute(crashRequest)).rejects.toThrow(KernelExitedError)
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })
    expect(harness.ended[0]?.fact.reason).toBe('crash')
    const { process: fresh } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    expect(fresh).not.toBe(kernel)
    expect(harness.started).toHaveLength(2)
  })

  it('removes an uncommanded protocol violation from the registry and reports reason protocol', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-protocol')
    const environment = harness.environment(1, ['python'])
    const { process: kernel } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    const garbageRequest = await prepareRun(harness.root, 'run-garbage', { action: 'garbage' })
    await expect(kernel.execute(garbageRequest)).rejects.toThrow(KernelProtocolError)
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })
    expect(harness.ended[0]?.fact.reason).toBe('protocol')
  })

  it('quarantines a same-id successor session until the predecessor kernel tree is proven quiescent', async () => {
    const harness = await createHarness()
    const original = attachScienceSession(harness.ctx, 'kernel-quarantine')
    const originalScratch = await ensureSessionScratch(harness.dshHome, original.session)
    const environment = harness.environment(1, ['python'])
    await harness.kernelSet.acquire(original.session, 'python', environment, originalScratch)

    original.detach()
    harness.kernelSet.detach(original.session)
    const successor = attachScienceSession(harness.ctx, 'kernel-quarantine', original.session.events)
    await expect(harness.kernelSet.acquire(successor.session, 'python', environment, originalScratch))
      .rejects.toThrow(KernelSetQuarantinedError)

    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })
    const { process: kernel } = await harness.kernelSet.acquire(successor.session, 'python', environment, originalScratch)
    expect(kernel).toBeInstanceOf(KernelProcess)
    expect(harness.started).toHaveLength(2)
  })

  it('refuses a same-id successor entry that would clobber a predecessor entry racing to register its own kernel', async () => {
    const harness = await createHarness()
    const original = attachScienceSession(harness.ctx, 'kernel-conflict')
    const originalScratch = await ensureSessionScratch(harness.dshHome, original.session)
    original.detach()
    const successor = attachScienceSession(harness.ctx, 'kernel-conflict', original.session.events)
    const successorScratch = await ensureSessionScratch(harness.dshHome, successor.session)
    const environment = harness.environment(1, ['python'])
    // Neither acquire is awaited before the other starts: both spawns race
    // to register a live kernel for the same session id before either has
    // claimed `byId`, reproducing the predecessor's-spawn-window race
    // `KernelSetConflictError`'s own doc describes.
    const [firstResult, secondResult] = await Promise.allSettled([
      harness.kernelSet.acquire(original.session, 'python', environment, originalScratch),
      harness.kernelSet.acquire(successor.session, 'python', environment, successorScratch),
    ])
    const fulfilled = [firstResult, secondResult].filter(result => result.status === 'fulfilled')
    const rejected = [firstResult, secondResult].filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(KernelSetConflictError)
  })

  it('discards the losing kernel through EXIT/quiesce after a same-id byId conflict, never leaving it running unregistered', async () => {
    // trackedSpawn's own syncBusyRegistration call can itself be the one
    // that throws the conflict (a different entry already claimed byId):
    // spawnKernel's real subprocess spawn already started before that call
    // runs, so the losing kernel keeps spawning in the background regardless
    // of the throw, and KernelSet's own discipline still requires it to end
    // through the ordinary EXIT/quiesce path rather than being left running
    // outside its own teardown.
    const harness = await createHarness()
    const { subprocess: wrapped, exitWriteCount, spawnCount } = wrapTrackingKernelSpawns(harness.ctx.subprocess)
    const kernelSet = new KernelSet({
      subprocess: wrapped,
      sandbox: harness.ctx.sandbox,
      assetsRoot: ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: () => {},
      onKernelEnded: () => {},
    })
    const original = attachScienceSession(harness.ctx, 'kernel-conflict-discard')
    const originalScratch = await ensureSessionScratch(harness.dshHome, original.session)
    original.detach()
    const successor = attachScienceSession(harness.ctx, 'kernel-conflict-discard', original.session.events)
    const successorScratch = await ensureSessionScratch(harness.dshHome, successor.session)
    const environment = harness.environment(1, ['python'])
    const [firstResult, secondResult] = await Promise.allSettled([
      kernelSet.acquire(original.session, 'python', environment, originalScratch),
      kernelSet.acquire(successor.session, 'python', environment, successorScratch),
    ])
    const fulfilled = [firstResult, secondResult].filter(
      (result): result is PromiseFulfilledResult<AcquiredKernel> => result.status === 'fulfilled',
    )
    const rejected = [firstResult, secondResult].filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(KernelSetConflictError)

    // The loser's own spawnKernel attempt is not cancelled by the
    // conflict throw: its real subprocess spawn still happens.
    await vi.waitFor(() => { expect(spawnCount()).toBe(2) })
    // Exactly one of the two spawned kernels — the loser, discarded through
    // discardUnregisteredKernel — ever receives EXIT; the winner stays live
    // and untouched by this whole race.
    await vi.waitFor(() => { expect(exitWriteCount()).toBe(1) })

    const winner = fulfilled[0]
    if (winner === undefined) throw new Error('unreachable: length asserted above')
    const request = await prepareRun(harness.root, 'run-after-conflict', { status: 'ok' })
    await expect(winner.value.process.execute(request)).resolves.toMatchObject({ status: 'ok' })

    const settled = await kernelSet.disposeAll()
    expect(settled.every(result => result.status === 'fulfilled')).toBe(true)
  })

  it('withholds onKernelEnded and same-id quarantine release until eventual quiescence is proven (straggler child)', async () => {
    const harness = await createHarness()
    const { subprocess: wrapped, proveQuiescence } = wrapWithUnprovenQuiescence(harness.ctx.subprocess)
    const started: Recorded<ScienceKernelStartedFact>[] = []
    const ended: Recorded<ScienceKernelEndedFact>[] = []
    const kernelSet = new KernelSet({
      subprocess: wrapped,
      sandbox: harness.ctx.sandbox,
      assetsRoot: ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: (session, fact) => { started.push({ session, fact }) },
      onKernelEnded: (session, fact) => { ended.push({ session, fact }) },
    })
    const original = attachScienceSession(harness.ctx, 'kernel-straggler')
    const originalScratch = await ensureSessionScratch(harness.dshHome, original.session)
    const environment = harness.environment(1, ['python'])
    await kernelSet.acquire(original.session, 'python', environment, originalScratch)

    original.detach()
    kernelSet.detach(original.session)
    // end()'s bounded escalation settles quickly here (the wrapped handle's
    // terminate() throws), but eventualQuiescence has not been proven yet:
    // pre-fix code releases quarantine and fires onKernelEnded regardless,
    // so both checks below would already observe the released/notified
    // state at this point.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(ended).toHaveLength(0)
    const successor = attachScienceSession(harness.ctx, 'kernel-straggler', original.session.events)
    await expect(kernelSet.acquire(successor.session, 'python', environment, originalScratch))
      .rejects.toThrow(KernelSetQuarantinedError)

    proveQuiescence()
    await vi.waitFor(() => { expect(ended).toHaveLength(1) })
    expect(ended[0]?.fact.reason).toBe('session-end')

    const { process: kernel } = await kernelSet.acquire(successor.session, 'python', environment, originalScratch)
    expect(kernel).toBeInstanceOf(KernelProcess)
    expect(started).toHaveLength(2)
  })

  it('drains an in-flight teardown for the same (session, language) before a concurrent acquire proceeds', async () => {
    const harness = await createHarness()
    const { subprocess: wrapped, proveQuiescence } = wrapWithUnprovenQuiescence(harness.ctx.subprocess)
    const kernelSet = new KernelSet({
      subprocess: wrapped,
      sandbox: harness.ctx.sandbox,
      assetsRoot: ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: () => {},
      onKernelEnded: () => {},
    })
    const { session, sessionScratch } = await harness.session('kernel-drain-await')
    const environment = harness.environment(1, ['python'])
    const { process: first } = await kernelSet.acquire(session, 'python', environment, sessionScratch)

    // retireForEscalation synchronously starts teardown (entry.ending is
    // populated before this call returns), which stays pending until
    // proveQuiescence(): a concurrent acquire for the same (session,
    // language) must await it via drain() before deciding reuse/rebind/spawn.
    void kernelSet.retireForEscalation(session, 'python')
    const reacquiring = kernelSet.acquire(session, 'python', environment, sessionScratch)
    let resolved = false
    void reacquiring.then(() => { resolved = true })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(resolved).toBe(false)

    proveQuiescence()
    const { process: second } = await reacquiring
    expect(second).not.toBe(first)
  })

  it('ends the fresh kernel and fails acquire when onKernelStarted throws, leaving nothing registered', async () => {
    const harness = await createHarness()
    const startedCalls: Session[] = []
    const ended: Recorded<ScienceKernelEndedFact>[] = []
    const startError = new Error('kernel-set.spec.ts: injected onKernelStarted failure')
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      // Throws only on the first call: the second (retry) call must reach
      // onKernelStarted and succeed normally for this test's "the failed
      // attempt left nothing registered" assertion to mean anything.
      onKernelStarted: (session) => {
        startedCalls.push(session)
        if (startedCalls.length === 1) throw startError
      },
      onKernelEnded: (session, fact) => { ended.push({ session, fact }) },
    })
    const { session, sessionScratch } = await harness.session('kernel-started-throws')
    const environment = harness.environment(1, ['python'])
    await expect(kernelSet.acquire(session, 'python', environment, sessionScratch)).rejects.toThrow(startError)
    expect(startedCalls).toHaveLength(1)
    // No `started` fact ever committed, so no `exited` one is owed either.
    expect(ended).toHaveLength(0)
    // The failed attempt left nothing registered: a retry spawns cleanly.
    const { process: kernel } = await kernelSet.acquire(session, 'python', environment, sessionScratch)
    expect(kernel).toBeInstanceOf(KernelProcess)
    expect(startedCalls).toHaveLength(2)
  })

  it('aggregates a vetoed onKernelStarted with a subsequent teardown failure while discarding the unregistered kernel', async () => {
    const startError = new Error('kernel-set.spec.ts: injected onKernelStarted failure (discard aggregate)')
    let plannedDirectory: string | undefined
    const harness = await createHarness()
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: (_session, fact) => {
        // Also make the fresh kernel's own discard-time teardown fail: its
        // response FIFO cannot be unlinked once the containing directory
        // loses write access, so discardUnregisteredKernel's own
        // process.end() call rejects too.
        plannedDirectory = planKernelScratch(sessionScratch, fact.language, fact.kernelEpoch).directory
        chmodSync(plannedDirectory, 0o500)
        throw startError
      },
      onKernelEnded: () => {},
    })
    const { session, sessionScratch } = await harness.session('kernel-discard-aggregate')
    const environment = harness.environment(1, ['python'])
    try {
      await expect(kernelSet.acquire(session, 'python', environment, sessionScratch)).rejects.toThrow(AggregateError)
    } finally {
      if (plannedDirectory !== undefined) chmodSync(plannedDirectory, 0o700)
    }
  })

  it('lets a retry spawn cleanly against a production-shaped epoch allocator after onKernelStarted throws', async () => {
    const harness = await createHarness()
    // Production-shaped, unlike `createEpochAllocator`'s monotonic counter
    // (which never rewinds and so cannot reproduce this bug): derives the
    // next epoch from a recorded fact list the throwing onKernelStarted
    // below never appends to on its first (failing) call — exactly
    // `nextKernelEpoch`'s own shape (`index.ts`), which reads the durable
    // projection and therefore never records a failed attempt either.
    const facts: ScienceKernelStartedFact[] = []
    const startError = new Error('kernel-set.spec.ts: injected onKernelStarted failure')
    let calls = 0
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: () => (facts.at(-1)?.kernelEpoch ?? 0) + 1,
      onKernelStarted: (_session, fact) => {
        calls += 1
        if (calls === 1) throw startError
        facts.push(fact)
      },
      onKernelEnded: () => {},
    })
    const { session, sessionScratch } = await harness.session('kernel-epoch-watermark-retry')
    const environment = harness.environment(1, ['python'])
    await expect(kernelSet.acquire(session, 'python', environment, sessionScratch)).rejects.toThrow(startError)
    // Pre-fix: `entry.epochSeen` already advanced to 1 from the failed
    // attempt (committed before `onKernelStarted` even ran), so this
    // retry's allocator — still correctly deriving 1, since no fact ever
    // committed — is misclassified as a regression against a watermark no
    // fact in the log actually justifies.
    const { process: kernel } = await kernelSet.acquire(session, 'python', environment, sessionScratch)
    expect(kernel).toBeInstanceOf(KernelProcess)
    expect(facts).toHaveLength(1)
    expect(facts[0]?.kernelEpoch).toBe(1)
  })

  it('does not reject the caller when onKernelEnded throws, and registry bookkeeping still completes', async () => {
    const harness = await createHarness()
    const started: Recorded<ScienceKernelStartedFact>[] = []
    const endedCalls: Session[] = []
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: (session, fact) => { started.push({ session, fact }) },
      onKernelEnded: (session) => {
        endedCalls.push(session)
        throw new Error('kernel-set.spec.ts: injected onKernelEnded failure')
      },
    })
    const { session, sessionScratch } = await harness.session('kernel-ended-throws')
    const { process: first } = await kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    // acquire's environment-rebound path awaits endKernel() -> teardown()
    // inline: pre-fix, a throwing onKernelEnded rejects that await and
    // fails this SECOND acquire even though the old kernel tore down
    // successfully and a fresh one should have spawned.
    const { process: second } = await kernelSet.acquire(session, 'python', harness.environment(2, ['python']), sessionScratch)
    expect(second).not.toBe(first)
    expect(endedCalls).toHaveLength(1)
    expect(started).toHaveLength(2)
    // Quarantine bookkeeping completed despite the throw: a further acquire
    // for the same (session, language) sees no leftover conflict.
    const { process: third } = await kernelSet.acquire(session, 'python', harness.environment(2, ['python']), sessionScratch)
    expect(third).toBe(second)
  })

  it('completes registry cleanup even when the teardown itself rejects', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-teardown-rejects')
    const environment = harness.environment(1, ['python'])
    const { process: kernel, epoch } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    const planned = planKernelScratch(sessionScratch, 'python', epoch)
    // Removing the response FIFO during teardown needs write access on its
    // PARENT directory: chmodding it after READY makes end()'s own unlink
    // fail, which propagates out of teardown() and rejects endKernel's
    // returned settlement.
    chmodSync(planned.directory, 0o500)
    try {
      await expect(harness.kernelSet.retireForEscalation(session, 'python')).rejects.toThrow()
    } finally {
      chmodSync(planned.directory, 0o700)
    }
    // Registry cleanup still completed despite the rejection: a fresh
    // acquire for the same (session, language) sees no leftover ending state.
    const { process: fresh } = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    expect(fresh).not.toBe(kernel)
  })

  it('passes onKernelStarted/onKernelEnded exactly the durable kernel-state facts', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-facts')
    const environment = harness.environment(1, ['python'])
    const before = Date.now()
    await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    expect(harness.started).toHaveLength(1)
    const startedEntry = harness.started[0]
    if (startedEntry === undefined) throw new Error('unreachable: length asserted above')
    expect(startedEntry.session).toBe(session)
    expect(startedEntry.fact).toMatchObject({
      language: 'python',
      kernelEpoch: 1,
      environmentRevision: 1,
      environmentFingerprint: 'fake-binding-python',
    })
    expect(startedEntry.fact.startedAt).toBeGreaterThanOrEqual(before)
    expect(Object.keys(startedEntry.fact).sort()).toEqual(
      ['environmentFingerprint', 'environmentRevision', 'kernelEpoch', 'language', 'startedAt'],
    )

    harness.kernelSet.detach(session)
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })
    const endedEntry = harness.ended[0]
    if (endedEntry === undefined) throw new Error('unreachable: length asserted above')
    expect(endedEntry.session).toBe(session)
    expect(endedEntry.fact).toMatchObject({
      language: 'python',
      kernelEpoch: 1,
      environmentRevision: 1,
      environmentFingerprint: 'fake-binding-python',
      startedAt: startedEntry.fact.startedAt,
      reason: 'session-end',
    })
    expect(endedEntry.fact.endedAt).toBeGreaterThanOrEqual(startedEntry.fact.startedAt)
    expect(Object.keys(endedEntry.fact).sort()).toEqual(
      ['endedAt', 'environmentFingerprint', 'environmentRevision', 'kernelEpoch', 'language', 'reason', 'startedAt'],
    )
  })

  it('captures startedAt after the READY handshake completes, not at spawn request', async () => {
    const started: Recorded<ScienceKernelStartedFact>[] = []
    const harness = await createHarness()
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: DELAYED_READY_ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: (session, fact) => { started.push({ session, fact }) },
      onKernelEnded: () => {},
    })
    const { session, sessionScratch } = await harness.session('kernel-started-at-ready')
    const beforeSpawn = Date.now()
    await kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    expect(started).toHaveLength(1)
    // The delayed-ready fixture withholds READY for 300ms after spawn
    // (`kernel-set-assets-delayed-ready/kernel_python.py`'s READY_DELAY_MS):
    // a spawn-request-time capture would read close to `beforeSpawn` instead.
    expect(started[0]?.fact.startedAt).toBeGreaterThanOrEqual(beforeSpawn + 300)
  })

  it('pairs every started kernel with exactly one ended notification, one reason each', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-pairing')
    const environmentA = harness.environment(1, ['python', 'r'])
    await harness.kernelSet.acquire(session, 'python', environmentA, sessionScratch)
    await harness.kernelSet.acquire(session, 'r', environmentA, sessionScratch)
    const environmentB = harness.environment(2, ['python', 'r'])
    await harness.kernelSet.acquire(session, 'python', environmentB, sessionScratch)
    await vi.waitFor(() => { expect(harness.ended).toHaveLength(1) })

    const settled = await harness.kernelSet.disposeAll()
    expect(settled.every(result => result.status === 'fulfilled')).toBe(true)
    expect(harness.started).toHaveLength(3)
    expect(harness.ended).toHaveLength(3)
    const startedEpochs = harness.started.map(entry => entry.fact.kernelEpoch).sort((a, b) => a - b)
    const endedEpochs = harness.ended.map(entry => entry.fact.kernelEpoch).sort((a, b) => a - b)
    expect(endedEpochs).toEqual(startedEpochs)
    expect(harness.ended.map(entry => entry.fact.reason).sort()).toEqual(
      ['environment-rebound', 'service-disposed', 'service-disposed'],
    )
  })

  it('returns the acquired kernel\'s own epoch, matching the started fact, on both a fresh spawn and a reuse', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-acquired-epoch')
    const environment = harness.environment(1, ['python'])
    const fresh = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    expect(fresh.epoch).toBe(1)
    expect(harness.started[0]?.fact.kernelEpoch).toBe(1)
    const reused = await harness.kernelSet.acquire(session, 'python', environment, sessionScratch)
    expect(reused.epoch).toBe(1)
    expect(reused.process).toBe(fresh.process)
  })

  it('retires the exact live kernel with reason run-escalation, and is a no-op with no live kernel', async () => {
    const harness = await createHarness()
    const { session, sessionScratch } = await harness.session('kernel-retire-escalation')
    await expect(harness.kernelSet.retireForEscalation(session, 'python')).resolves.toBeUndefined()
    expect(harness.ended).toHaveLength(0)
    const { process: kernel } = await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    await harness.kernelSet.retireForEscalation(session, 'python')
    expect(harness.ended).toHaveLength(1)
    expect(harness.ended[0]?.fact.reason).toBe('run-escalation')
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'commanded' })
    const fresh = await harness.kernelSet.acquire(session, 'python', harness.environment(1, ['python']), sessionScratch)
    expect(fresh.process).not.toBe(kernel)
  })

  it('retires a kernel that finishes spawning after detach already fired (the spawn-vs-teardown race)', async () => {
    const started: Recorded<ScienceKernelStartedFact>[] = []
    const ended: Recorded<ScienceKernelEndedFact>[] = []
    const harness = await createHarness()
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: DELAYED_READY_ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: (session, fact) => { started.push({ session, fact }) },
      onKernelEnded: (session, fact) => { ended.push({ session, fact }) },
    })
    const original = attachScienceSession(harness.ctx, 'kernel-spawn-detach-race')
    const originalScratch = await ensureSessionScratch(harness.dshHome, original.session)
    const environment = harness.environment(1, ['python'])
    const acquiring = kernelSet.acquire(original.session, 'python', environment, originalScratch)

    // The delayed-ready driver has not yet sent READY: this spawn is still
    // in flight (post-subprocess-spawn, pre-registration) when detach fires.
    original.detach()
    kernelSet.detach(original.session)
    expect(started).toHaveLength(0)
    expect(ended).toHaveLength(0)

    const kernel = await acquiring
    expect(kernel.process).toBeInstanceOf(KernelProcess)
    expect(started).toHaveLength(1)
    // The fresh kernel registered only after detach already fired: it must
    // still be retired, not left live and unquarantined.
    await vi.waitFor(() => { expect(ended).toHaveLength(1) })
    expect(ended[0]?.fact.reason).toBe('session-end')
    await expect(kernel.process.exited).resolves.toMatchObject({ cause: 'commanded' })

    const successor = attachScienceSession(harness.ctx, 'kernel-spawn-detach-race', original.session.events)
    const successorKernel = await kernelSet.acquire(successor.session, 'python', environment, originalScratch)
    expect(successorKernel.process).toBeInstanceOf(KernelProcess)
  })

  it('does not touch a pending acquisition belonging to a different session when detach fires for one of two concurrent spawns', async () => {
    const started: Recorded<ScienceKernelStartedFact>[] = []
    const ended: Recorded<ScienceKernelEndedFact>[] = []
    const harness = await createHarness()
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: DELAYED_READY_ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: (session, fact) => { started.push({ session, fact }) },
      onKernelEnded: (session, fact) => { ended.push({ session, fact }) },
    })
    const alpha = attachScienceSession(harness.ctx, 'kernel-detach-scope-a')
    const alphaScratch = await ensureSessionScratch(harness.dshHome, alpha.session)
    const beta = attachScienceSession(harness.ctx, 'kernel-detach-scope-b')
    const betaScratch = await ensureSessionScratch(harness.dshHome, beta.session)
    const environment = harness.environment(1, ['python'])
    const acquiringAlpha = kernelSet.acquire(alpha.session, 'python', environment, alphaScratch)
    const acquiringBeta = kernelSet.acquire(beta.session, 'python', environment, betaScratch)

    // Both spawns are still in flight (delayed READY); detach only alpha.
    // Its pending record's own entry matches (retired below); beta's does
    // not, so detach's loop must skip it (kernel-set.ts's own `continue`).
    alpha.detach()
    kernelSet.detach(alpha.session)

    const [alphaKernel, betaKernel] = await Promise.all([acquiringAlpha, acquiringBeta])
    expect(alphaKernel.process).toBeInstanceOf(KernelProcess)
    expect(betaKernel.process).toBeInstanceOf(KernelProcess)
    await vi.waitFor(() => { expect(ended.filter(entry => entry.session === alpha.session)).toHaveLength(1) })
    expect(ended.find(entry => entry.session === alpha.session)?.fact.reason).toBe('session-end')
    // beta's kernel is untouched: still live, no end notification for it.
    expect(ended.some(entry => entry.session === beta.session)).toBe(false)
    const betaReused = await kernelSet.acquire(beta.session, 'python', environment, betaScratch)
    expect(betaReused.process).toBe(betaKernel.process)
  })

  it('is a no-op via endIfStillLive when a pending spawn fails (never registers) after detach already fired', async () => {
    const started: Recorded<ScienceKernelStartedFact>[] = []
    const ended: Recorded<ScienceKernelEndedFact>[] = []
    const harness = await createHarness()
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: NO_READY_ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 200,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: (session, fact) => { started.push({ session, fact }) },
      onKernelEnded: (session, fact) => { ended.push({ session, fact }) },
    })
    const original = attachScienceSession(harness.ctx, 'kernel-spawn-fail-detach-race')
    const originalScratch = await ensureSessionScratch(harness.dshHome, original.session)
    const environment = harness.environment(1, ['python'])
    const acquiring = kernelSet.acquire(original.session, 'python', environment, originalScratch)

    // The no-ready driver never sends READY: this spawn is still in flight
    // when detach fires, and will reject on its own (READY timeout) without
    // ever registering a live kernel — endIfStillLive's own live===undefined
    // no-op path, distinct from the sibling test's "live and must be ended" case.
    original.detach()
    kernelSet.detach(original.session)
    await expect(acquiring).rejects.toThrow(KernelProtocolError)
    expect(started).toHaveLength(0)
    expect(ended).toHaveLength(0)
  })

  it('awaits an in-flight spawn before disposeAll settles, and retires whatever it registers', async () => {
    const started: Recorded<ScienceKernelStartedFact>[] = []
    const ended: Recorded<ScienceKernelEndedFact>[] = []
    const harness = await createHarness()
    const kernelSet = new KernelSet({
      subprocess: harness.ctx.subprocess,
      sandbox: harness.ctx.sandbox,
      assetsRoot: DELAYED_READY_ASSETS_ROOT,
      kernelIdleTimeoutMs: 1_800_000,
      kernelStartTimeoutMs: 5_000,
      nextEpoch: createEpochAllocator().fn,
      onKernelStarted: (session, fact) => { started.push({ session, fact }) },
      onKernelEnded: (session, fact) => { ended.push({ session, fact }) },
    })
    const { session, sessionScratch } = await harness.session('kernel-dispose-during-spawn')
    const environment = harness.environment(1, ['python'])
    const acquiring = kernelSet.acquire(session, 'python', environment, sessionScratch)

    const settled = kernelSet.disposeAll()
    await acquiring
    expect(started).toHaveLength(1)
    await expect(settled).resolves.toSatisfy((results: PromiseSettledResult<unknown>[]) =>
      results.every(result => result.status === 'fulfilled'))
    expect(ended).toHaveLength(1)
    expect(ended[0]?.fact.reason).toBe('service-disposed')
  })
})
