/**
 * Exact-Session quarantine, detachment, and provider-disposal behavior.
 * Every scenario that used to depend on the deleted one-shot process's
 * "eventual quiescence" settlement (a subprocess tree whose exit needed a
 * separate, retained observation) no longer applies: a kernel run's own
 * terminal is decided by the RUN/DONE protocol exchange, never by proving a
 * process tree dead (`KernelSet`/`kernel-set.spec.ts` owns that concern for
 * the kernel process itself, independent of any one run).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ScienceRuntimeError } from '../src/index.ts'
import type ScienceRuntime from '../src/index.ts'
import { LeaseRegistry, OperationControl } from '../src/lifecycle.ts'
import {
  attachScienceSession,
  authorizePythonRun,
  createControlledRuntimeHarness,
  createFakePythonPrefix,
  createKernelRuntimeHarness,
  kernelAction,
  rejectSessionAppend,
} from './harness.ts'

// Every case here spawns a real kernel subprocess through
// LocalSubprocessRuntime; under full-suite concurrency, spawn and pipe I/O
// contend for the OS scheduler and the default 5s timeout is not enough.
vi.setConfig({ testTimeout: 30_000 })

const timeoutFault = vi.hoisted(() => ({ delayMs: 0 }))

vi.mock('../src/environment.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/environment.ts')>()
  return {
    ...original,
    observeProfile: async (...args: Parameters<typeof original.observeProfile>) => {
      if (timeoutFault.delayMs > 0) await new Promise<void>((resolve) => { setTimeout(resolve, timeoutFault.delayMs) })
      return original.observeProfile(...args)
    },
  }
})

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  timeoutFault.delayMs = 0
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Bind the fake Python profile through the public operation. */
async function bindFakePython(
  runtime: ScienceRuntime,
  session: ReturnType<typeof attachScienceSession>['session'],
): Promise<void> {
  await runtime.bindEnvironment({
    session,
    profileId: ScienceEnvironmentProfileId('fake'),
    signal: new AbortController().signal,
  })
}

/** Assemble a kernel-capable harness with a bound fake Python profile attached to a manually detachable Session. */
async function readyKernelHarness(id: string): Promise<{
  readonly ctx: Context
  readonly runtime: Awaited<ReturnType<typeof createKernelRuntimeHarness>>['runtime']
  readonly runtimeFiber: Awaited<ReturnType<typeof createKernelRuntimeHarness>>['runtimeFiber']
  readonly attached: ReturnType<typeof attachScienceSession>
}> {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-lifecycle-'))
  roots.push(root)
  const prefix = createFakePythonPrefix(root)
  const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
  contexts.push(harness.ctx)
  const attached = attachScienceSession(harness.ctx, id)
  await bindFakePython(harness.runtime, attached.session)
  return { ctx: harness.ctx, runtime: harness.runtime, runtimeFiber: harness.runtimeFiber, attached }
}

describe('ScienceRuntime lifecycle ownership', () => {
  it('reports a deadline that expires before environment publication', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-prepublication-timeout-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 1)
    contexts.push(harness.ctx)
    const session = attachScienceSession(harness.ctx, 'science-prepublication-timeout')
    timeoutFault.delayMs = 10
    await expect(harness.runtime.bindEnvironment({
      session: session.session,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'OPERATION_TIMED_OUT' })
    expect(session.session.events.map(event => event.type)).toEqual(['science/mode-bound'])
  })

  it('keeps the first cancellation cause and releases exact and same-ID reservations only once', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-control-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = attachScienceSession(harness.ctx, 'science-control')
    const caller = new AbortController()
    const control = new OperationControl(caller.signal, 1_000)
    control.cancel()
    control.disposeService()
    control.detachSession()
    expect(control.cause).toBe('cancelled')
    expect(control.signal.aborted).toBe(true)
    control.dispose()

    const registry = new LeaseRegistry()
    const first = registry.reserve(session.session, new OperationControl(new AbortController().signal, 1_000))
    expect(() => registry.reserve(session.session, new OperationControl(new AbortController().signal, 1_000)))
      .toThrow(/already has work/)
    registry.detach(session.session)
    expect(first.control.cause).toBe('session-detached')
    const settling = registry.disposeAll()
    registry.release(first)
    registry.release(first)
    await expect(settling).resolves.toEqual([{ status: 'fulfilled', value: undefined }])
    const second = registry.reserve(session.session, new OperationControl(new AbortController().signal, 1_000))
    registry.detach(second.session)
    expect(second.control.cause).toBe('session-detached')
    registry.release(second)
  })

  it('resolves blocking() through the exact-Session map first and the same-ID quarantine map as a fallback', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-blocking-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = attachScienceSession(harness.ctx, 'science-blocking')
    const registry = new LeaseRegistry()
    expect(registry.blocking(session.session)).toBeUndefined()
    const lease = registry.reserve(session.session, new OperationControl(new AbortController().signal, 1_000))
    expect(registry.blocking(session.session)).toBe(lease)
    // A distinct exact Session object sharing the same id (e.g. a resumed
    // successor) is never in `exact`, so `blocking` must fall back to the
    // same-id quarantine map to find the lease still blocking it. `detach`
    // first: `prepare` refuses a second live registration for the same id.
    session.detach()
    const successor = harness.ctx.sessions.prepare(SessionId('science-blocking'), { seed: [...session.session.events] })
    expect(registry.blocking(successor)).toBe(lease)
    registry.release(lease)
    expect(registry.blocking(session.session)).toBeUndefined()
    expect(registry.blocking(successor)).toBeUndefined()
  })

  it('quarantines a same-ID successor until an in-flight run\'s lease settles', async () => {
    const { ctx, runtime, attached } = await readyKernelHarness('science-same-id')
    const running = await runtime.startRun({
      session: attached.session,
      language: 'python',
      code: kernelAction({ action: 'sleep', sleepMs: 60_000, trapSigint: true }),
      ...authorizePythonRun(attached.session),
      signal: new AbortController().signal,
    })

    attached.detach()
    await expect(running.done).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
    const successor = attachScienceSession(ctx, 'science-same-id', attached.session.events)
    const successorAuthorization = authorizePythonRun(successor.session, 'science-same-id-successor')
    await expect(runtime.startRun({
      session: successor.session,
      language: 'python',
      code: kernelAction({ status: 'ok' }),
      ...successorAuthorization,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
  })

  it('cleans an unexpectedly detached exact Session but never appends to its old log', async () => {
    const { runtime, attached } = await readyKernelHarness('science-detached')
    const handle = await runtime.startRun({
      session: attached.session,
      language: 'python',
      code: kernelAction({ action: 'sleep', sleepMs: 60_000, trapSigint: true }),
      ...authorizePythonRun(attached.session),
      signal: new AbortController().signal,
    })

    attached.detach()
    await expect(handle.done).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
    expect(attached.session.events.some(event => event.type === 'science/run-finished')).toBe(false)
  })

  it('reports terminal append failures as detached when the exact Session disappears at the same moment', async () => {
    const { runtime, attached } = await readyKernelHarness('science-detached-append')
    const handle = await runtime.startRun({
      session: attached.session,
      language: 'python',
      code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(attached.session, 'science-detached-append'),
      signal: new AbortController().signal,
    })
    rejectSessionAppend(
      attached.session,
      'science/run-finished',
      new Error('terminal append rejects after detachment'),
      attached.detach,
    )
    await expect(handle.done).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
  })

  it('rejects pre-publication work when the exact Session detaches during a probe', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-detach-bind-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const attached = attachScienceSession(harness.ctx, 'science-detach-bind')
    let detached = false
    harness.subprocess.onSpawn = () => {
      if (!detached) {
        detached = true
        attached.detach()
      }
    }
    await expect(harness.runtime.bindEnvironment({
      session: attached.session,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
  })

  it('cancels a live run and disposes its kernel, then removes its service registration on fiber disposal', async () => {
    const { ctx, runtime, runtimeFiber, attached } = await readyKernelHarness('science-runtime-dispose')
    const handle = await runtime.startRun({
      session: attached.session,
      language: 'python',
      code: kernelAction({ action: 'sleep', sleepMs: 60_000, trapSigint: true }),
      ...authorizePythonRun(attached.session),
      signal: new AbortController().signal,
    })

    await runtimeFiber.dispose()
    await expect(handle.done).resolves.toMatchObject({
      terminal: { runId: handle.runId, status: 'cancelled', failureCode: 'CANCELLED' },
    })
    expect(ctx.scienceRuntime).toBeUndefined()
    await expect(runtime.bindEnvironment({
      session: attached.session,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' } satisfies Partial<ScienceRuntimeError>)
  })
})
