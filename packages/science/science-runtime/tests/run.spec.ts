/** Focused kernel-run pipeline coverage: acquisition, D5 cancel/timeout, D10 classification, capture, and replay. */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { MAX_OUTPUT_BYTES } from '../src/execution.ts'
import { KernelSet } from '../src/kernel-set.ts'
import {
  authorizePythonRun,
  authorizeRun,
  createFakePythonPrefix,
  createFakeRPrefix,
  createKernelRuntimeHarness,
  createScienceSession,
  installTestKernelSet,
  KERNEL_ASSETS_DELAYED_READY_ROOT,
  KERNEL_ASSETS_NO_READY_ROOT,
  kernelAction,
} from './harness.ts'

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

  it('rejects a second concurrent run with RUNTIME_BUSY', async () => {
    const { runtime, session } = await readyPythonHarness('science-run-busy')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 5_000, trapSigint: true }),
      ...authorizePythonRun(session, 'science-run-busy-1'), signal: new AbortController().signal,
    })
    await expect(runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-run-busy-2'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
    first.cancel()
    await expect(first.done).resolves.toMatchObject({ terminal: { status: 'cancelled' } })
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
})

describe('ScienceRuntime.startRun kernel acquisition (D3/D4/D6)', () => {
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

  it('allocates kernelEpoch N+1 through the real durable-projection allocator for a session seeded with prior kernel facts (A3 finding 16)', async () => {
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

  it('bounds kernel spawn by the run\'s own cancellation, not only kernelStartTimeoutMs (A3 finding 11)', async () => {
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

  it('disarms the acquired kernel\'s idle timer immediately on acquisition, before run-started commits (A3 finding 5)', async () => {
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
})

describe('ScienceRuntime.startRun D10 terminal classification', () => {
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

  it('truncates a stdout tail exceeding MAX_OUTPUT_BYTES, retaining exactly the last MAX_OUTPUT_BYTES bytes (A3 finding 3)', async () => {
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

describe('ScienceRuntime.startRun D5 interrupt-first cancel/timeout', () => {
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

  it('settles a published run as timed-out through the same D5 interrupt-first path', async () => {
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
    // derives it interrupted (D4) rather than presenting a kernel a fresh
    // Host restart could never actually own.
    expect(live?.kernels).toMatchObject([{ state: 'started' }])
    const cold = Session.create(SessionId('science-run-cold-replay-cold'), session.events)
    const coldProjection = replayScience(cold.events)
    expect(coldProjection?.kernels).toMatchObject([{ state: 'interrupted', kernelEpoch: 1 }])
    expect(coldProjection?.runs).toEqual(live?.runs)
    expect(coldProjection?.environment).toEqual(live?.environment)
  })
})
