/**
 * `startRun`'s per-run shared-prefix drift detection (#15): another
 * session's `installPackages` call mutates the same shared Conda prefix
 * this session already bound, without ever touching this session's own
 * `science/environment-bound` history. These cases drive a real kernel
 * through `createKernelRuntimeHarness` and mutate `conda-meta/history` on
 * disk directly — the same file `prefixHistoryDigest` reads — rather than
 * manually appending a durable revision the way `run.spec.ts`'s own rebind
 * test does, so the detection itself is under test, not only its
 * downstream kernel-restart machinery.
 */

import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  authorizePythonRun,
  authorizeRun,
  createFakePythonPrefix,
  createFakeRPrefix,
  createKernelRuntimeHarness,
  createScienceSession,
  kernelAction,
} from './harness.ts'

// Every case here spawns a real kernel subprocess through
// LocalSubprocessRuntime, and a drift hit also spawns a real re-observation
// probe; under full-suite concurrency, spawn and pipe I/O contend for the OS
// scheduler and the default 5s timeout is not enough.
vi.setConfig({ testTimeout: 30_000 })

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Assemble one root, fake Python prefix, kernel-capable harness, and bound Science session. */
async function readyPythonHarness(id: string): Promise<{
  readonly prefix: string
  readonly runtime: Awaited<ReturnType<typeof createKernelRuntimeHarness>>['runtime']
  readonly session: Session
}> {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-drift-'))
  roots.push(root)
  const prefix = createFakePythonPrefix(root)
  const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 30_000)
  contexts.push(harness.ctx)
  const session = createScienceSession(harness.ctx, id)
  await harness.runtime.bindEnvironment({
    session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
  })
  return { prefix, runtime: harness.runtime, session }
}

/** Assemble one root, fake R prefix, kernel-capable harness, and bound Science session. */
async function readyRHarness(id: string): Promise<{
  readonly prefix: string
  readonly runtime: Awaited<ReturnType<typeof createKernelRuntimeHarness>>['runtime']
  readonly session: Session
}> {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-drift-r-'))
  roots.push(root)
  const prefix = createFakeRPrefix(root)
  const harness = await createKernelRuntimeHarness(root, { fake: { rPrefix: prefix } }, 30_000)
  contexts.push(harness.ctx)
  const session = createScienceSession(harness.ctx, id)
  await harness.runtime.bindEnvironment({
    session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
  })
  return { prefix, runtime: harness.runtime, session }
}

describe('ScienceRuntime.startRun prefix-drift detection', () => {
  it('re-observes and rebinds when the shared Python prefix drifts between runs, restarting the stale kernel', async () => {
    const { prefix, runtime, session } = await readyPythonHarness('science-drift-python-rebind')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-python-1'), signal: new AbortController().signal,
    })
    await first.done

    // Simulates another session's `installPackages` writing this same
    // shared prefix: a real conda transaction append, not a durable Session
    // event this session ever saw.
    writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-09-06 <==\n+lifelines-0.29.0\n')

    const second = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-python-2'), signal: new AbortController().signal,
    })
    await second.done

    const bound = session.events.filter(event => event.type === 'science/environment-bound')
    expect(bound).toHaveLength(2)
    expect(bound[1]?.data).toMatchObject({ environment: { revision: 2, status: 'applied' } })
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started[1]?.data).toMatchObject({ run: { environmentRevision: 2, kernelEpoch: 2 } })
    const kernelFacts = session.events.filter(event => event.type === 'science/kernel-state')
    expect(kernelFacts).toHaveLength(3)
    expect(kernelFacts[1]?.data).toMatchObject({ kernel: { state: 'exited', reason: 'environment-rebound', kernelEpoch: 1 } })
    expect(kernelFacts[2]?.data).toMatchObject({ kernel: { state: 'started', kernelEpoch: 2 } })
  })

  it('re-observes and rebinds when the shared R prefix drifts, proving selectBinding reaches the R half of the profile', async () => {
    const { prefix, runtime, session } = await readyRHarness('science-drift-r-rebind')
    const first = await runtime.startRun({
      session, language: 'r', code: kernelAction({ status: 'ok' }),
      ...authorizeRun(session, 'r', 'science-drift-r-1'), signal: new AbortController().signal,
    })
    await first.done

    writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-09-06 <==\n+lifelines-0.29.0\n')

    const second = await runtime.startRun({
      session, language: 'r', code: kernelAction({ status: 'ok' }),
      ...authorizeRun(session, 'r', 'science-drift-r-2'), signal: new AbortController().signal,
    })
    await second.done

    const bound = session.events.filter(event => event.type === 'science/environment-bound')
    expect(bound).toHaveLength(2)
    expect(bound[1]?.data).toMatchObject({ environment: { revision: 2, status: 'applied' } })
    const kernelFacts = session.events.filter(event => event.type === 'science/kernel-state')
    expect(kernelFacts[1]?.data).toMatchObject({ kernel: { state: 'exited', reason: 'environment-rebound', kernelEpoch: 1 } })
  })

  it('never re-observes or restarts the kernel when the prefix has not drifted', async () => {
    const { runtime, session } = await readyPythonHarness('science-drift-python-unchanged')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-unchanged-1'), signal: new AbortController().signal,
    })
    await first.done
    const second = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-unchanged-2'), signal: new AbortController().signal,
    })
    await second.done
    expect(session.events.filter(event => event.type === 'science/environment-bound')).toHaveLength(1)
    const started = session.events.filter(event => event.type === 'science/run-started')
    expect(started[0]?.data).toMatchObject({ run: { kernelEpoch: 1 } })
    expect(started[1]?.data).toMatchObject({ run: { kernelEpoch: 1 } })
    expect(session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(1)
  })

  it('rejects the run with ENVIRONMENT_NOT_READY and appends no revision when the drifted prefix is no longer usable', async () => {
    const { prefix, runtime, session } = await readyPythonHarness('science-drift-python-unusable')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-unusable-1'), signal: new AbortController().signal,
    })
    await first.done

    // Drift the digest (so the cheap check fires) and, separately, make the
    // re-observation itself fail: the interpreter this binding named is gone.
    writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-09-06 <==\n+lifelines-0.29.0\n')
    unlinkSync(process.platform === 'win32' ? join(prefix, 'python.exe') : join(prefix, 'bin', 'python'))

    await expect(runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-unusable-2'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })

    // B8 regression lock: an unusable re-observation must never append an
    // `invalid` revision — bindEnvironment refuses to rebind a session past
    // its first run, so one `invalid` append here would strand the session.
    expect(session.events.filter(event => event.type === 'science/environment-bound')).toHaveLength(1)
    expect(session.events.some(event => event.type === 'science/run-started' && event.data.run.environmentRevision === 2)).toBe(false)

    // The session is not stuck: restoring the prefix lets a later run through
    // on the same original revision, since the digest now matches again.
    writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-08-13 <==\n+python-3.13.5\n')
    createFakePythonPrefix(join(prefix, '..'))
    const recovered = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-unusable-3'), signal: new AbortController().signal,
    })
    await expect(recovered.done).resolves.toMatchObject({ terminal: { status: 'success' } })
    expect(session.events.filter(event => event.type === 'science/environment-bound')).toHaveLength(1)
  })

  it('treats an unreadable history (replaced with a directory) as drift routed through the same re-observe path, not an unclassified exception', async () => {
    const { prefix, runtime, session } = await readyPythonHarness('science-drift-python-history-directory')
    const first = await runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-history-dir-1'), signal: new AbortController().signal,
    })
    await first.done

    const historyPath = join(prefix, 'conda-meta', 'history')
    rmSync(historyPath)
    mkdirSync(historyPath)

    await expect(runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      ...authorizePythonRun(session, 'science-drift-history-dir-2'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
    expect(session.events.filter(event => event.type === 'science/environment-bound')).toHaveLength(1)
  })
})
