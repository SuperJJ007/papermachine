/** Exact-Session quarantine, detachment, and provider-disposal behavior. */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import { ScienceRuntimeError } from '../src/index.ts'
import { LeaseRegistry, OperationControl } from '../src/lifecycle.ts'
import {
  attachScienceSession,
  authorizePythonRun,
  createControlledRuntimeHarness,
  createFakePythonPrefix,
  rejectSessionAppend,
} from './harness.ts'

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

/** Bind the controlled fake prefix through the public operation. */
async function bindFakePython(
  runtime: Awaited<ReturnType<typeof createControlledRuntimeHarness>>['runtime'],
  session: ReturnType<typeof attachScienceSession>['session'],
): Promise<void> {
  await runtime.bindEnvironment({
    session,
    profileId: ScienceEnvironmentProfileId('fake'),
    signal: new AbortController().signal,
  })
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

  it('quarantines a same-ID successor until a non-quiescent old tree is later proven dead', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-quarantine-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const original = attachScienceSession(ctx, 'science-same-id')
    await bindFakePython(runtime, original.session)
    const oldRun = subprocess.queueRun('deferred')
    const oldHandle = await runtime.startRun({
      session: original.session,
      language: 'python',
      code: 'long-running old lifecycle',
      ...authorizePythonRun(original.session),
      signal: new AbortController().signal,
    })

    original.detach()
    await expect(oldHandle.done).rejects.toMatchObject({ code: 'QUIESCENCE_UNPROVEN' })
    expect(oldRun.terminations).toBeGreaterThan(0)
    const successor = attachScienceSession(ctx, 'science-same-id', original.session.events)
    const successorAuthorization = authorizePythonRun(successor.session, 'science-same-id-successor')
    const retry = () => runtime.startRun({
      session: successor.session,
      language: 'python',
      code: 'must not touch shared scratch while quarantined',
      ...successorAuthorization,
      signal: new AbortController().signal,
    })

    await expect(retry()).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
    oldRun.proveQuiescence()
    const successorRun = subprocess.queueRun('immediate')
    let successorHandle: Awaited<ReturnType<typeof retry>> | undefined
    await vi.waitFor(async () => {
      try {
        successorHandle = await retry()
      } catch (error) {
        expect(error).toMatchObject({ code: 'RUNTIME_BUSY' })
        throw error
      }
    }, { timeout: 500, interval: 10 })
    if (successorHandle === undefined) throw new Error('same-ID successor did not leave quarantine')
    successorHandle.cancel()
    await expect(successorHandle.done).resolves.toMatchObject({
      terminal: { runId: successorHandle.runId, status: 'cancelled', failureCode: 'CANCELLED' },
    })
    expect(successorRun.terminations).toBe(1)
  })

  it('commits the terminal fact and releases a live Session only after eventual quiescence', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-eventual-terminal-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = attachScienceSession(harness.ctx, 'science-eventual-terminal')
    await bindFakePython(harness.runtime, session.session)
    const run = harness.subprocess.queueRun('deferred')
    const handle = await harness.runtime.startRun({
      session: session.session,
      language: 'python',
      code: 'eventual terminal publication',
      ...authorizePythonRun(session.session, 'science-eventual-terminal-call'),
      signal: new AbortController().signal,
    })
    run.complete({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toMatchObject({ code: 'QUIESCENCE_UNPROVEN' })
    await expect(harness.runtime.startRun({
      session: session.session,
      language: 'python',
      code: 'must remain quarantined before proof',
      ...authorizePythonRun(session.session, 'science-eventual-terminal-busy'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })

    run.proveQuiescence()
    await vi.waitFor(() => {
      expect(session.session.events.filter(event => event.type === 'science/run-finished')).toHaveLength(1)
    })
    const successorRun = harness.subprocess.queueRun('immediate')
    const successor = await harness.runtime.startRun({
      session: session.session,
      language: 'python',
      code: 'allowed after terminal publication',
      ...authorizePythonRun(session.session, 'science-eventual-terminal-successor'),
      signal: new AbortController().signal,
    })
    successor.cancel()
    await expect(successor.done).resolves.toMatchObject({ terminal: { status: 'cancelled' } })
    expect(successorRun.terminations).toBe(1)
  })

  it('retains the live Session quarantine when eventual terminal publication fails', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-eventual-commit-failure-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = attachScienceSession(harness.ctx, 'science-eventual-commit-failure')
    await bindFakePython(harness.runtime, session.session)
    const run = harness.subprocess.queueRun('deferred')
    const handle = await harness.runtime.startRun({
      session: session.session,
      language: 'python',
      code: 'eventual terminal commit failure',
      ...authorizePythonRun(session.session, 'science-eventual-commit-failure-call'),
      signal: new AbortController().signal,
    })
    run.complete({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toMatchObject({ code: 'QUIESCENCE_UNPROVEN' })
    const appendAttempted = Promise.withResolvers<undefined>()
    rejectSessionAppend(session.session, 'science/run-finished', new Error('injected eventual terminal rejection'), () => {
      appendAttempted.resolve(undefined)
    })
    run.proveQuiescence()
    await appendAttempted.promise
    await expect(harness.runtime.startRun({
      session: session.session,
      language: 'python',
      code: 'must remain quarantined after terminal rejection',
      ...authorizePythonRun(session.session, 'science-eventual-commit-failure-retry'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
    const internal = harness.runtime as unknown as {
      readonly leases: { readonly active: ReadonlySet<Parameters<LeaseRegistry['release']>[0]>; release(lease: Parameters<LeaseRegistry['release']>[0]): void }
    }
    const lease = [...internal.leases.active][0]
    if (lease === undefined) throw new Error('eventual terminal rejection unexpectedly released the Runtime lease')
    internal.leases.release(lease)
  })

  it('retains the Session quarantine when an eventual tree observation is false', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-false-quiescence-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = attachScienceSession(harness.ctx, 'science-false-quiescence')
    await bindFakePython(harness.runtime, session.session)
    const run = harness.subprocess.queueRun('immediate')
    const eventual = Promise.withResolvers<boolean>()
    ;(run.handle as { waitForExit(signal?: AbortSignal): Promise<boolean> }).waitForExit = async (signal) => {
      if (signal === undefined) return eventual.promise
      return false
    }
    const handle = await harness.runtime.startRun({
      session: session.session,
      language: 'python',
      code: 'false eventual quiescence',
      ...authorizePythonRun(session.session, 'science-false-quiescence-call'),
      signal: new AbortController().signal,
    })
    run.complete({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toMatchObject({ code: 'QUIESCENCE_UNPROVEN' })
    eventual.resolve(false)
    await vi.waitFor(async () => {
      await expect(harness.runtime.startRun({
        session: session.session,
        language: 'python',
        code: 'must remain quarantined',
        ...authorizePythonRun(session.session, 'science-false-quiescence-retry'),
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
    })
    const internal = harness.runtime as unknown as {
      readonly leases: { readonly active: ReadonlySet<Parameters<LeaseRegistry['release']>[0]>; release(lease: Parameters<LeaseRegistry['release']>[0]): void }
    }
    const lease = [...internal.leases.active][0]
    if (lease === undefined) throw new Error('false quiescence unexpectedly released the Runtime lease')
    internal.leases.release(lease)
  })

  it('retains the Session quarantine when an eventual tree observation rejects', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-rejected-quiescence-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = attachScienceSession(harness.ctx, 'science-rejected-quiescence')
    await bindFakePython(harness.runtime, session.session)
    const run = harness.subprocess.queueRun('immediate')
    const eventual = Promise.withResolvers<boolean>()
    ;(run.handle as { waitForExit(signal?: AbortSignal): Promise<boolean> }).waitForExit = async (signal) => {
      if (signal === undefined) return eventual.promise
      return false
    }
    const handle = await harness.runtime.startRun({
      session: session.session,
      language: 'python',
      code: 'rejected eventual quiescence',
      ...authorizePythonRun(session.session, 'science-rejected-quiescence-call'),
      signal: new AbortController().signal,
    })
    run.complete({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toMatchObject({ code: 'QUIESCENCE_UNPROVEN' })
    eventual.reject(new Error('provider could not prove eventual quiescence'))
    await vi.waitFor(async () => {
      await expect(harness.runtime.startRun({
        session: session.session,
        language: 'python',
        code: 'must remain quarantined after proof rejection',
        ...authorizePythonRun(session.session, 'science-rejected-quiescence-retry'),
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
    })
    const internal = harness.runtime as unknown as {
      readonly leases: { readonly active: ReadonlySet<Parameters<LeaseRegistry['release']>[0]>; release(lease: Parameters<LeaseRegistry['release']>[0]): void }
    }
    const lease = [...internal.leases.active][0]
    if (lease === undefined) throw new Error('rejected quiescence unexpectedly released the Runtime lease')
    internal.leases.release(lease)
  })

  it('cleans an unexpectedly detached exact Session but never appends to its old log', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-detach-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const attached = attachScienceSession(ctx, 'science-detached')
    await bindFakePython(runtime, attached.session)
    subprocess.queueRun('immediate')
    const handle = await runtime.startRun({
      session: attached.session,
      language: 'python',
      code: 'detached while running',
      ...authorizePythonRun(attached.session),
      signal: new AbortController().signal,
    })

    attached.detach()
    await expect(handle.done).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
    expect(attached.session.events.some(event => event.type === 'science/run-finished')).toBe(false)
  })

  it('reports terminal preparation and append failures as detached when the exact Session disappears', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-detach-preparation-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const attached = attachScienceSession(harness.ctx, 'science-detached-preparation')
    await bindFakePython(harness.runtime, attached.session)
    const run = harness.subprocess.queueRun('immediate')
    run.omitStdout()
    const handle = await harness.runtime.startRun({
      session: attached.session,
      language: 'python',
      code: 'detach before output preparation',
      ...authorizePythonRun(attached.session, 'science-detached-preparation'),
      signal: new AbortController().signal,
    })
    attached.detach()
    run.complete({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
    const appendRoot = mkdtempSync(join(process.cwd(), '.science-runtime-detach-append-'))
    roots.push(appendRoot)
    const appendPrefix = createFakePythonPrefix(appendRoot)
    const appendHarness = await createControlledRuntimeHarness(appendRoot, { fake: { pythonPrefix: appendPrefix } })
    contexts.push(appendHarness.ctx)
    const appendSession = attachScienceSession(appendHarness.ctx, 'science-detached-append')
    await bindFakePython(appendHarness.runtime, appendSession.session)
    const appendRun = appendHarness.subprocess.queueRun('immediate')
    rejectSessionAppend(
      appendSession.session,
      'science/run-finished',
      new Error('terminal append rejects after detachment'),
      appendSession.detach,
    )
    const appendHandle = await appendHarness.runtime.startRun({
      session: appendSession.session, language: 'python', code: 'print(1)',
      ...authorizePythonRun(appendSession.session, 'science-detached-append'), signal: new AbortController().signal,
    })
    appendRun.complete({ exitCode: 0, signal: null })
    await expect(appendHandle.done).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
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

  it('cancels and quiesces a live run, then removes its service registration on fiber disposal', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-dispose-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, runtimeFiber, subprocess } = harness
    const session = attachScienceSession(ctx, 'science-runtime-dispose')
    await bindFakePython(runtime, session.session)
    const run = subprocess.queueRun('immediate')
    const handle = await runtime.startRun({
      session: session.session,
      language: 'python',
      code: 'dispose while running',
      ...authorizePythonRun(session.session),
      signal: new AbortController().signal,
    })

    await runtimeFiber.dispose()
    await expect(handle.done).resolves.toMatchObject({
      terminal: { runId: handle.runId, status: 'cancelled', failureCode: 'CANCELLED' },
    })
    expect(run.terminations).toBeGreaterThan(0)
    expect(ctx.scienceRuntime).toBeUndefined()
    await expect(runtime.bindEnvironment({
      session: session.session,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' } satisfies Partial<ScienceRuntimeError>)
  })
})
