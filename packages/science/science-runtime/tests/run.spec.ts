/** Focused durable run ordering, clean-environment, drift, and cancellation coverage. */

import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ScienceRuntimeError } from '../src/index.ts'
import { confineRun, planRun, settleRun, startCandidate } from '../src/execution.ts'
import { OperationControl } from '../src/lifecycle.ts'
import { createRunScratch, ensureSessionScratch } from '../src/scratch.ts'
import {
  authorizeRun,
  authorizePythonRun,
  attachScienceSession,
  createControlledRuntimeHarness,
  createFastRuntimeHarness,
  createFakeRPrefix,
  createFakePythonPrefix,
  createScienceSession,
  rejectSessionAppend,
} from './harness.ts'

const rollbackFault = vi.hoisted(() => ({ unpublished: false, session: false }))

vi.mock('../src/scratch.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/scratch.ts')>()
  return {
    ...original,
    removeUnpublishedRunScratch: async (...args: Parameters<typeof original.removeUnpublishedRunScratch>) => {
      if (rollbackFault.unpublished) throw new Error('injected unpublished rollback failure')
      return original.removeUnpublishedRunScratch(...args)
    },
    rollbackSessionScratch: async (...args: Parameters<typeof original.rollbackSessionScratch>) => {
      if (rollbackFault.session) throw new Error('injected Session scratch rollback failure')
      return original.rollbackSessionScratch(...args)
    },
  }
})

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  rollbackFault.unpublished = false
  rollbackFault.session = false
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Bind the fake Python profile through the public Runtime operation. */
async function bindFakePython(
  runtime: Awaited<ReturnType<typeof createFastRuntimeHarness>>['runtime'],
  session: ReturnType<typeof createScienceSession>,
): Promise<void> {
  await runtime.bindEnvironment({
    session,
    profileId: ScienceEnvironmentProfileId('fake'),
    signal: new AbortController().signal,
  })
}

describe('ScienceRuntime.startRun', () => {
  it('rejects malformed source and a writable-prefix or partial confinement before any source process starts', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-direct-preflight-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-direct-preflight')
    await bindFakePython(harness.runtime, session)
    const environment = replayScience(session.events)?.environment
    if (environment === null || environment === undefined) throw new Error('missing applied environment')
    expect(() => planRun(environment, 'python', '')).toThrow(/non-empty/)
    expect(() => planRun(environment, 'python', 'x\0')).toThrow(/U\+0000/)
    expect(() => planRun(environment, 'r', 'x'.repeat(262_145))).toThrow(/exceeds/)
    const { python: _python, ...withoutPython } = environment
    expect(() => planRun(withoutPython, 'python', 'print(1)')).toThrow(/not available/)
    const scratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    const plan = planRun(environment, 'python', 'print(1)')
    const control = new OperationControl(new AbortController().signal, 1_000)
    try {
      expect(() => confineRun({ subprocess: harness.subprocess, sandbox: harness.sandbox, session, sessionScratch: { ...scratch, root: prefix }, control }, plan, join(scratch.runs, 'code.py')))
        .toThrow(/overlaps/)
      vi.spyOn(harness.sandbox, 'confine').mockImplementationOnce(() => {
        throw new SandboxUnavailableError('workspace-write')
      })
      expect(() => confineRun({ subprocess: harness.subprocess, sandbox: harness.sandbox, session, sessionScratch: scratch, control }, plan, join(scratch.runs, 'code.py')))
        .toThrow(expect.objectContaining({ code: 'CONFINEMENT_UNAVAILABLE' }))
      const unexpected = new Error('unexpected confinement failure')
      vi.spyOn(harness.sandbox, 'confine').mockImplementationOnce(() => {
        throw unexpected
      })
      expect(() => confineRun({ subprocess: harness.subprocess, sandbox: harness.sandbox, session, sessionScratch: scratch, control }, plan, join(scratch.runs, 'code.py')))
        .toThrow(unexpected)
      harness.sandbox.enforcement = 'partial'
      expect(() => confineRun({ subprocess: harness.subprocess, sandbox: harness.sandbox, session, sessionScratch: scratch, control }, plan, join(scratch.runs, 'code.py')))
        .toThrow(/full sandbox enforcement/)
    } finally {
      control.dispose()
    }
  })

  it('fails a malformed subprocess provider after publication without manufacturing output', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-malformed-provider-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-malformed-provider')
    await bindFakePython(harness.runtime, session)

    const missingOutput = harness.subprocess.queueRun('immediate')
    missingOutput.omitStdout()
    const missingOutputHandle = await harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session, 'science-missing-output'), signal: new AbortController().signal,
    })
    missingOutput.complete({ exitCode: 0, signal: null })
    await expect(missingOutputHandle.done).rejects.toMatchObject({ code: 'TERMINAL_COMMIT_FAILED' })

    const successor = createScienceSession(harness.ctx, 'science-no-outcome')
    await bindFakePython(harness.runtime, successor)
    const noOutcome = harness.subprocess.queueRun('immediate')
    noOutcome.resolveMalformedOutcome()
    const noOutcomeHandle = await harness.runtime.startRun({
      session: successor, language: 'python', code: 'print(2)', ...authorizePythonRun(successor, 'science-no-outcome'), signal: new AbortController().signal,
    })
    await expect(noOutcomeHandle.done).resolves.toMatchObject({ terminal: { status: 'failed', failureCode: 'SPAWN_FAILED' } })
  })

  it('settles pre-start cancellation and a rejected managed completion through the direct execution seam', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-direct-settlement-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-direct-settlement')
    await bindFakePython(harness.runtime, session)
    const environment = replayScience(session.events)?.environment
    if (environment === null || environment === undefined) throw new Error('missing applied environment')
    const scratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    const plan = planRun(environment, 'python', 'print(1)')
    const run = await createRunScratch(scratch, plan.runId, 'python', plan.sourceBytes)
    const authorization = authorizePythonRun(session, 'science-direct-settlement')
    const started = startCandidate(plan, run, 'python', environment, authorization.toolCallId, authorization.requestHeaderSeq)
    const cancellation = new AbortController()
    const cancelledControl = new OperationControl(cancellation.signal, 1_000)
    cancellation.abort()
    try {
      await expect(settleRun({
        subprocess: harness.subprocess,
        sandbox: harness.sandbox,
        session,
        sessionScratch: scratch,
        control: cancelledControl,
      }, started, plan, run, {
        argv: [plan.binding.executable], denialSignatures: [], runnerFailureRules: [],
      })).resolves.toMatchObject({
        result: { terminal: { status: 'cancelled', failureCode: 'CANCELLED' } },
      })
    } finally {
      cancelledControl.dispose()
    }

    const rejected = harness.subprocess.queueRun('immediate')
    rejected.rejectCompletion(new Error('managed completion rejection'))
    const rejectedControl = new OperationControl(new AbortController().signal, 1_000)
    try {
      const settled = settleRun({
        subprocess: harness.subprocess,
        sandbox: harness.sandbox,
        session,
        sessionScratch: scratch,
        control: rejectedControl,
      }, started, plan, run, {
        argv: [plan.binding.executable], denialSignatures: [], runnerFailureRules: [],
      })
      await expect(settled).resolves.toMatchObject({
        result: { terminal: { status: 'failed', failureCode: 'SPAWN_FAILED' } },
      })
    } finally {
      rejectedControl.dispose()
    }
  })

  it('contains a synchronous provider termination failure raised by cancellation', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-abort-termination-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-abort-termination')
    await bindFakePython(harness.runtime, session)
    const environment = replayScience(session.events)?.environment
    if (environment === null || environment === undefined) throw new Error('missing applied environment')
    const scratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    const plan = planRun(environment, 'python', 'print(1)')
    const runScratch = await createRunScratch(scratch, plan.runId, 'python', plan.sourceBytes)
    const authorization = authorizePythonRun(session, 'science-abort-termination')
    const started = startCandidate(plan, runScratch, 'python', environment, authorization.toolCallId, authorization.requestHeaderSeq)
    const run = harness.subprocess.queueRun('immediate')
    let terminationAttempts = 0
    ;(run.handle as { terminate(): void }).terminate = () => {
      terminationAttempts += 1
      throw new Error('provider terminate failed')
    }
    const cancellation = new AbortController()
    const control = new OperationControl(cancellation.signal, 1_000)
    try {
      const settled = settleRun({
        subprocess: harness.subprocess,
        sandbox: harness.sandbox,
        session,
        sessionScratch: scratch,
        control,
      }, started, plan, runScratch, {
        argv: [plan.binding.executable], denialSignatures: [], runnerFailureRules: [],
      })
      cancellation.abort()
      run.complete({ exitCode: 0, signal: null })
      await expect(settled).resolves.toMatchObject({
        result: { terminal: { status: 'cancelled', failureCode: 'CANCELLED' } },
      })
      expect(terminationAttempts).toBe(1)
    } finally {
      control.dispose()
    }
  })


  it('constructs the Windows PATH through the direct execution seam without treating a Darwin binding as a Windows observation', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-windows-execution-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-windows-execution')
    await bindFakePython(harness.runtime, session)
    const environment = replayScience(session.events)?.environment
    if (environment === null || environment === undefined) throw new Error('missing applied environment')
    const scratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    const plan = planRun(environment, 'python', 'print(1)')
    const run = await createRunScratch(scratch, plan.runId, 'python', plan.sourceBytes)
    const control = new OperationControl(new AbortController().signal, 1_000)
    const authorization = authorizePythonRun(session, 'science-windows-execution')
    const started = startCandidate(plan, run, 'python', environment, authorization.toolCallId, authorization.requestHeaderSeq)
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    if (original === undefined) throw new Error('process.platform descriptor is unavailable')
    Object.defineProperty(process, 'platform', { ...original, value: 'win32' })
    try {
      const confined = confineRun({
        subprocess: harness.subprocess,
        sandbox: harness.sandbox,
        session,
        sessionScratch: scratch,
        control,
      }, plan, run.source)
      const controlled = harness.subprocess.queueRun('immediate')
      const settled = settleRun({
        subprocess: harness.subprocess,
        sandbox: harness.sandbox,
        session,
        sessionScratch: scratch,
        control,
      }, started, plan, run, confined)
      controlled.complete({ exitCode: 0, signal: null })
      await expect(settled).resolves.toMatchObject({ quiescent: true, result: { terminal: { status: 'success' } } })
      expect(harness.subprocess.specs.at(-1)?.env?.PATH).toBe(join(prefix, 'Scripts'))
    } finally {
      Object.defineProperty(process, 'platform', original)
      control.dispose()
    }
  })
  it('rejects a detached or non-Science Session before external work', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-session-guards-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const plain = harness.ctx.sessions.create(SessionId('science-plain-session'))
    await expect(harness.runtime.bindEnvironment({
      session: plain, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
    const attached = attachScienceSession(harness.ctx, 'science-detached-session')
    attached.detach()
    await expect(harness.runtime.bindEnvironment({
      session: attached.session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
    expect(harness.subprocess.specs).toEqual([])
  })

  it('requires an applied language binding and full run confinement before it publishes a start', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-guards-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-guards')
    const request = {
      session,
      language: 'python' as const,
      code: 'print(1)',
      ...authorizePythonRun(session, 'science-run-guard-call'),
      signal: new AbortController().signal,
    }
    await expect(harness.runtime.startRun(request)).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
    await bindFakePython(harness.runtime, session)
    rmSync(join(root, 'dsh-home', 'science'), { recursive: true, force: true })
    harness.sandbox.enforcement = 'partial'
    await expect(harness.runtime.startRun(request)).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
    expect(existsSync(join(root, 'dsh-home', 'science'))).toBe(false)
  })

  it('aggregates unpublished rollback failure after a pre-publication append rejection without spawning', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-unpublished-rollback-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-unpublished-rollback')
    await bindFakePython(harness.runtime, session)
    rejectSessionAppend(session, 'science/run-started', new Error('injected start append failure'))
    rollbackFault.unpublished = true
    await expect(harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session, 'science-unpublished-rollback'), signal: new AbortController().signal,
    })).rejects.toThrow(/unpublished run rollback failed/)
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
    expect(harness.subprocess.specs.filter(spec => spec.argv.includes('-u'))).toEqual([])
  })

  it('aggregates pre-publication drift with Session scratch rollback failure before creating a run', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-session-rollback-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-session-rollback')
    await bindFakePython(harness.runtime, session)
    writeFileSync(join(prefix, 'conda-meta', 'history'), 'changed before run\n')
    rollbackFault.session = true
    await expect(harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session, 'science-session-rollback'), signal: new AbortController().signal,
    })).rejects.toThrow(/pre-publication Session scratch rollback failed/)
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('classifies signalled, cleanup, runner, and denial outcomes without exposing program text in durable facts', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-outcomes-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-outcomes')
    await bindFakePython(harness.runtime, session)
    const signalled = harness.subprocess.queueRun('immediate')
    const signalledHandle = await harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session, 'science-signalled'), signal: new AbortController().signal,
    })
    signalled.complete({ exitCode: null, signal: 'SIGTERM' })
    await expect(signalledHandle.done).resolves.toMatchObject({
      terminal: { status: 'failed', failureCode: 'PROCESS_SIGNALLED', signal: 'SIGTERM' },
    })

    const nextSession = createScienceSession(harness.ctx, 'science-run-forced')
    await bindFakePython(harness.runtime, nextSession)
    const forced = harness.subprocess.queueRun('immediate')
    let forcedWaits = 0
    ;(forced.handle as { waitForExit(signal?: AbortSignal): Promise<boolean> }).waitForExit = async () => {
      forcedWaits += 1
      return forcedWaits > 1
    }
    const forcedHandle = await harness.runtime.startRun({
      session: nextSession, language: 'python', code: 'print(2)', ...authorizePythonRun(nextSession, 'science-forced'), signal: new AbortController().signal,
    })
    forced.complete({ exitCode: 0, signal: null })
    await expect(forcedHandle.done).resolves.toMatchObject({
      terminal: { status: 'failed', failureCode: 'DESCENDANT_CLEANUP_REQUIRED' },
    })
    const runnerRoot = mkdtempSync(join(process.cwd(), '.science-runtime-runner-denial-'))
    roots.push(runnerRoot)
    const runnerPrefix = createFakePythonPrefix(runnerRoot)
    const runnerHarness = await createControlledRuntimeHarness(runnerRoot, { fake: { pythonPrefix: runnerPrefix } })
    contexts.push(runnerHarness.ctx)
    runnerHarness.sandbox.denialSignatures = ['denied']
    runnerHarness.sandbox.runnerFailureRules = [{ allowedExitCodes: [127], fatalSignatures: ['runner failed'] }]
    const runnerSession = createScienceSession(runnerHarness.ctx, 'science-runner-failure')
    await bindFakePython(runnerHarness.runtime, runnerSession)
    const runner = runnerHarness.subprocess.queueRun('immediate', { stderr: 'runner failed: denied\n' })
    const runnerHandle = await runnerHarness.runtime.startRun({
      session: runnerSession, language: 'python', code: 'print(1)', ...authorizePythonRun(runnerSession, 'science-runner-failure'), signal: new AbortController().signal,
    })
    runner.complete({ exitCode: 127, signal: null })
    await expect(runnerHandle.done).resolves.toMatchObject({ terminal: { failureCode: 'SANDBOX_RUNNER_FAILED' } })

    const deniedSession = createScienceSession(runnerHarness.ctx, 'science-denied')
    await bindFakePython(runnerHarness.runtime, deniedSession)
    const denied = runnerHarness.subprocess.queueRun('immediate', { stderr: 'write denied\n' })
    const deniedHandle = await runnerHarness.runtime.startRun({
      session: deniedSession, language: 'python', code: 'print(2)', ...authorizePythonRun(deniedSession, 'science-denied'), signal: new AbortController().signal,
    })
    denied.complete({ exitCode: 1, signal: null })
    await expect(deniedHandle.done).resolves.toMatchObject({ terminal: { failureCode: 'SANDBOX_DENIED' } })
  })
  it('turns a post-publication spawn throw into the matching durable terminal fact', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-spawn-failure-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-spawn-failure')
    await bindFakePython(harness.runtime, session)
    harness.subprocess.spawnFailure = new Error('fake direct spawn failed')
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session, 'science-spawn-failure'), signal: new AbortController().signal,
    })
    await expect(handle.done).resolves.toMatchObject({
      terminal: { status: 'failed', failureCode: 'SPAWN_FAILED' },
      stdout: { bytes: 0 }, stderr: { bytes: 0 },
    })
    expect(session.events.slice(-2).map(event => event.type)).toEqual(['science/run-started', 'science/run-finished'])
  })
  it('commits start before direct source spawn, then commits the matching terminal with bounded operational output', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const session = createScienceSession(ctx, 'science-run-success')
    await bindFakePython(runtime, session)
    const authorization = authorizePythonRun(session)
    let eventsAtSpawn: string[] | undefined
    subprocess.onSpawn = (spec) => {
      if (spec.argv.includes('-u')) eventsAtSpawn = session.events.map(event => event.type)
    }

    const handle = await runtime.startRun({
      session,
      language: 'python',
      code: 'print("not interpreted by the fake prefix")',
      ...authorization,
      signal: new AbortController().signal,
    })
    const result = await handle.done
    const runSpec = subprocess.specs.at(-1)
    const started = session.events.find(event => event.type === 'science/run-started')

    expect(eventsAtSpawn?.at(-1)).toBe('science/run-started')
    expect(runSpec).toMatchObject({
      argv: [join(prefix, 'bin', 'python'), '-I', '-B', '-u', '-X', 'utf8', expect.any(String)],
      environmentBase: 'empty',
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64_000 },
        stderr: { maxBytes: 64_000 },
      },
    })
    expect(Object.keys(runSpec?.env ?? {}).sort()).toEqual([
      'HOME', 'LANG', 'LC_ALL', 'PATH', 'SCIENCE_ARTIFACT_DIR', 'SCIENCE_STATE_DIR', 'TMPDIR', 'TZ',
    ])
    expect(result).toMatchObject({
      terminal: { runId: handle.runId, status: 'success', stdoutBytes: 16, stderrBytes: 0 },
      stdout: { text: 'fake run output\n', bytes: 16, truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
    })
    expect(started?.data.run).toMatchObject({
      runId: handle.runId,
      runDirectoryRef: `runs/${String(handle.runId)}/`,
      status: 'running',
    })
    expect(JSON.stringify(started?.data.run)).not.toContain(join(root, 'dsh-home'))
    expect(session.events.map(event => event.type).slice(-2)).toEqual([
      'science/run-started',
      'science/run-finished',
    ])
    const cold = Session.create(SessionId('science-run-success-cold'), session.events)
    expect(replayScience(cold.events)).toEqual(replayScience(session.events))
  })

  it('executes direct Rscript argv under the accepted R binding', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-r-run-'))
    roots.push(root)
    const prefix = createFakeRPrefix(root)
    const harness = await createFastRuntimeHarness(root, { r: { rPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const session = createScienceSession(ctx, 'science-run-r')
    await runtime.bindEnvironment({
      session,
      profileId: ScienceEnvironmentProfileId('r'),
      signal: new AbortController().signal,
    })
    const handle = await runtime.startRun({
      session,
      language: 'r',
      code: 'print("R path")',
      ...authorizeRun(session, 'r', 'science-runtime-r-call'),
      signal: new AbortController().signal,
    })

    await expect(handle.done).resolves.toMatchObject({
      terminal: { runId: handle.runId, status: 'success' },
      stdout: { text: 'fake R run output\n' },
    })
    expect(subprocess.specs.at(-1)?.argv).toEqual([
      join(prefix, 'bin', 'Rscript'), '--vanilla', '--encoding=UTF-8', expect.any(String),
    ])
    const driftSession = createScienceSession(ctx, 'science-run-r-drift')
    await runtime.bindEnvironment({
      session: driftSession, profileId: ScienceEnvironmentProfileId('r'), signal: new AbortController().signal,
    })
    writeFileSync(join(prefix, 'conda-meta', 'history'), 'changed R history\n')
    await expect(runtime.startRun({
      session: driftSession, language: 'r', code: 'print("drift")', ...authorizeRun(driftSession, 'r', 'science-runtime-r-drift-call'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
    const reobserved = replayScience(driftSession.events)?.environment
    expect(reobserved).toMatchObject({ status: 'drifted', r: { capability: 'available' } })
    expect(reobserved).not.toHaveProperty('python')
  })

  it('runs Python from a space-containing owned root with metacharacters only as direct source bytes', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science runtime-python-direct-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const session = createScienceSession(ctx, 'science-run-direct-space')
    await bindFakePython(runtime, session)
    const handle = await runtime.startRun({
      session,
      language: 'python',
      code: 'print("$() ; [] && unicode 运行")',
      ...authorizePythonRun(session, 'science-runtime-direct-space-call'),
      signal: new AbortController().signal,
    })

    await expect(handle.done).resolves.toMatchObject({ terminal: { status: 'success' } })
    const argv = subprocess.specs.at(-1)?.argv
    expect(argv).toEqual([
      join(prefix, 'bin', 'python'), '-I', '-B', '-u', '-X', 'utf8', expect.stringContaining('science runtime-python-direct-'),
    ])
  })

  it('preserves non-ASCII and retained-tail output without placing text in Science facts', async () => {
    const unicodeRoot = mkdtempSync(join(process.cwd(), '.science-runtime-unicode-output-'))
    roots.push(unicodeRoot)
    const unicodePrefix = createFakePythonPrefix(unicodeRoot)
    const unicodeHarness = await createFastRuntimeHarness(unicodeRoot, { fake: { pythonPrefix: unicodePrefix } })
    contexts.push(unicodeHarness.ctx)
    const unicodeSession = createScienceSession(unicodeHarness.ctx, 'science-run-unicode')
    await bindFakePython(unicodeHarness.runtime, unicodeSession)
    const unicodeRun = unicodeHarness.subprocess.queueRun('immediate', { stdout: '运行-✓\n' })
    const unicodeHandle = await unicodeHarness.runtime.startRun({
      session: unicodeSession,
      language: 'python',
      code: 'print("运行-✓")',
      ...authorizePythonRun(unicodeSession, 'science-runtime-unicode-call'),
      signal: new AbortController().signal,
    })
    unicodeRun.complete({ exitCode: 0, signal: null })
    const unicode = await unicodeHandle.done
    expect(unicode.stdout).toEqual({
      text: '运行-✓\n',
      bytes: Buffer.byteLength('运行-✓\n'),
      truncated: false,
    })
    expect(JSON.stringify(unicodeSession.events)).not.toContain('运行-✓')
    const largeRoot = mkdtempSync(join(process.cwd(), '.science-runtime-large-output-'))
    roots.push(largeRoot)
    const largePrefix = createFakePythonPrefix(largeRoot)
    const largeHarness = await createFastRuntimeHarness(largeRoot, { fake: { pythonPrefix: largePrefix } })
    contexts.push(largeHarness.ctx)
    const largeSession = createScienceSession(largeHarness.ctx, 'science-run-large')
    await bindFakePython(largeHarness.runtime, largeSession)
    const largeRun = largeHarness.subprocess.queueRun('immediate', {
      stdout: 'x'.repeat(64_000),
      stdoutBytes: 70_000,
      stdoutLossy: true,
    })
    const largeHandle = await largeHarness.runtime.startRun({
      session: largeSession,
      language: 'python',
      code: 'print("large output")',
      ...authorizePythonRun(largeSession, 'science-runtime-large-call'),
      signal: new AbortController().signal,
    })
    largeRun.complete({ exitCode: 0, signal: null })
    await expect(largeHandle.done).resolves.toMatchObject({
      terminal: { stdoutBytes: 70_000, stdoutTruncated: true },
      stdout: { bytes: 70_000, text: 'x'.repeat(64_000), truncated: true },
    })
  })

  it('holds one running Session reservation, then cancels the managed tree before appending its terminal value', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-cancel-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const session = createScienceSession(ctx, 'science-run-cancel')
    await bindFakePython(runtime, session)
    const authorization = authorizePythonRun(session)
    const running = subprocess.queueRun('immediate')
    const handle = await runtime.startRun({
      session,
      language: 'python',
      code: 'print("cancel me")',
      ...authorization,
      signal: new AbortController().signal,
    })
    await expect(runtime.startRun({
      session,
      language: 'python',
      code: 'print("concurrent")',
      ...authorization,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
    handle.cancel()
    await expect(handle.done).resolves.toMatchObject({
      terminal: { runId: handle.runId, status: 'cancelled', failureCode: 'CANCELLED' },
    })
    expect(session.events.map(event => event.type).slice(-1)).toEqual(['science/run-finished'])
    expect(running.terminations).toBe(1)
  })

  it('waits for managed-tree quiescence before committing an ordinary nonzero terminal', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-failure-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const session = createScienceSession(ctx, 'science-run-failure')
    await bindFakePython(runtime, session)
    const authorization = authorizePythonRun(session)
    const failed = subprocess.queueRun('immediate', { stderr: 'fake program failure\n' })
    let terminalObservedBeforeTreeExit: boolean | undefined
    failed.onFirstWait = () => {
      terminalObservedBeforeTreeExit = session.events.some(event => event.type === 'science/run-finished')
    }

    const handle = await runtime.startRun({
      session,
      language: 'python',
      code: 'print("fail")',
      ...authorization,
      signal: new AbortController().signal,
    })

    failed.complete({ exitCode: 23, signal: null })
    await expect(handle.done).resolves.toMatchObject({
      terminal: {
        runId: handle.runId,
        status: 'failed',
        exitCode: 23,
        failureCode: 'PROCESS_EXIT_NONZERO',
        stderrBytes: 21,
      },
      stderr: { text: 'fake program failure\n', bytes: 21, truncated: false },
    })
    expect(terminalObservedBeforeTreeExit).toBe(false)
    expect(session.events.at(-1)?.type).toBe('science/run-finished')
  })

  it('settles a published run as timed-out and commits its terminal after forced cleanup', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-timeout-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 500)
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const session = createScienceSession(ctx, 'science-run-timeout')
    await bindFakePython(runtime, session)
    const authorization = authorizePythonRun(session)
    const timedOut = subprocess.queueRun('immediate')
    const handle = await runtime.startRun({
      session,
      language: 'python',
      code: 'print("time out")',
      ...authorization,
      signal: new AbortController().signal,
    })

    await expect(handle.done).resolves.toMatchObject({
      terminal: { runId: handle.runId, status: 'timed-out', failureCode: 'TIMEOUT' },
    })
    expect(timedOut.terminations).toBe(1)
  })

  it('publishes an eventual terminal after the only terminate verb throws but a later observation proves exit', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-unproven-exit-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-unproven-exit')
    await bindFakePython(harness.runtime, session)
    const run = harness.subprocess.queueRun('immediate')
    let checks = 0
    ;(run.handle as { waitForExit(signal?: AbortSignal): Promise<boolean>; terminate(): void }).waitForExit = async () => {
      checks += 1
      if (checks === 1) throw new Error('bounded tree observation failed')
      return true
    }
    ;(run.handle as { terminate(): void }).terminate = () => { throw new Error('provider terminate failed') }
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session, 'science-unproven-exit'), signal: new AbortController().signal,
    })
    run.complete({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toMatchObject({ code: 'QUIESCENCE_UNPROVEN' })
    await vi.waitFor(() => {
      expect(session.events.filter(event => event.type === 'science/run-finished')).toHaveLength(1)
    })
    const retry = harness.subprocess.queueRun('immediate')
    const retryHandle = await harness.runtime.startRun({
      session, language: 'python', code: 'print(2)', ...authorizePythonRun(session, 'science-unproven-retry'), signal: new AbortController().signal,
    })
    retryHandle.cancel()
    await expect(retryHandle.done).resolves.toMatchObject({ terminal: { status: 'cancelled' } })
    expect(retry.terminations).toBe(1)
  })

  it('records one drift revision and refuses to spawn when the accepted prefix history changes', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-drift-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, subprocess } = harness
    const session = createScienceSession(ctx, 'science-run-drift')
    await bindFakePython(runtime, session)
    writeFileSync(join(prefix, 'conda-meta', 'history'), 'changed after bind\n')
    const authorization = authorizePythonRun(session)
    const before = subprocess.specs.length

    const error = await runtime.startRun({
      session,
      language: 'python',
      code: 'print("must not spawn")',
      ...authorization,
      signal: new AbortController().signal,
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ScienceRuntimeError)
    expect(error).toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
    expect(subprocess.specs).toHaveLength(before + 2)
    expect(session.events.filter(event => event.type === 'science/environment-bound').map(event => event.data.environment.status))
      .toEqual(['applied', 'drifted'])
    expect(session.events.some(event => event.type === 'science/run-started')).toBe(false)
  })

  it('records an invalid re-observation and rejects terminal publication failures after quiescence', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-invalid-reobserve-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-invalid-reobserve')
    await bindFakePython(harness.runtime, session)
    writeFileSync(join(prefix, 'conda-meta', 'history'), 'changed\n')
    // Removing the executable converts the re-observation into an invalid
    // environment revision rather than merely a fingerprint drift.
    unlinkSync(join(prefix, 'bin', 'python'))
    await expect(harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session, 'science-invalid-reobserve'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
    expect(replayScience(session.events)?.environment).toMatchObject({ status: 'invalid' })
    expect(replayScience(session.events)?.environment?.failureReason).toMatch(/no longer usable/)

    createFakePythonPrefix(root)
    const terminalSession = createScienceSession(harness.ctx, 'science-terminal-append-failure')
    await bindFakePython(harness.runtime, terminalSession)
    const run = harness.subprocess.queueRun('immediate')
    rejectSessionAppend(terminalSession, 'science/run-finished', new Error('injected terminal append rejection'))
    const handle = await harness.runtime.startRun({
      session: terminalSession, language: 'python', code: 'print(2)', ...authorizePythonRun(terminalSession, 'science-terminal-append-failure'), signal: new AbortController().signal,
    })
    run.complete({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toMatchObject({ code: 'TERMINAL_COMMIT_FAILED' })
  })
})
