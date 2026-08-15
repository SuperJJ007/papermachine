/** Post-publication runner, denial, spawn, and terminal-commit failure behavior. */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import {
  authorizePythonRun,
  createControlledRuntimeHarness,
  createFakePythonPrefix,
  createScienceSession,
} from './harness.ts'
import { sessionScratchKey } from '../src/scratch.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Build an applied fake environment ready to publish one controlled Python run. */
async function ready(id: string) {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-failures-'))
  roots.push(root)
  const prefix = createFakePythonPrefix(root)
  const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
  contexts.push(harness.ctx)
  const session = createScienceSession(harness.ctx, id)
  await harness.runtime.bindEnvironment({
    session,
    profileId: ScienceEnvironmentProfileId('fake'),
    signal: new AbortController().signal,
  })
  return { ...harness, root, session }
}

/** Start a controlled Python source after all test-only failure facts are selected. */
async function startReadyRun(readyHarness: Awaited<ReturnType<typeof ready>>, callId: string) {
  return readyHarness.runtime.startRun({
    session: readyHarness.session,
    language: 'python',
    code: 'controlled failure source',
    ...authorizePythonRun(readyHarness.session, callId),
    signal: new AbortController().signal,
  })
}

describe('ScienceRuntime post-start failure classification', () => {
  it('classifies matching fatal runner evidence before an otherwise matching sandbox denial', async () => {
    const harness = await ready('science-runner-priority')
    harness.sandbox.denialSignatures = ['permission denied']
    harness.sandbox.runnerFailureRules = [{ fatalSignatures: ['runner could not initialize'] }]
    const run = harness.subprocess.queueRun('immediate', {
      stderr: 'runner could not initialize: permission denied\n',
    })
    const handle = await startReadyRun(harness, 'science-runner-priority-call')
    run.complete({ exitCode: 125, signal: null })

    await expect(handle.done).resolves.toMatchObject({
      terminal: {
        runId: handle.runId,
        status: 'failed',
        exitCode: 125,
        failureCode: 'SANDBOX_RUNNER_FAILED',
      },
    })
  })

  it('classifies only the selected sandbox denial dialect as SANDBOX_DENIED', async () => {
    const harness = await ready('science-sandbox-denial')
    harness.sandbox.denialSignatures = ['seatbelt denied write']
    const run = harness.subprocess.queueRun('immediate', { stderr: 'Seatbelt denied write /prefix\n' })
    const handle = await startReadyRun(harness, 'science-sandbox-denial-call')
    run.complete({ exitCode: 1, signal: null })

    await expect(handle.done).resolves.toMatchObject({
      terminal: { runId: handle.runId, status: 'failed', failureCode: 'SANDBOX_DENIED' },
    })
  })

  it('settles both runner-spawn and ordinary spawn throws as matching terminal values', async () => {
    const runner = await ready('science-runner-spawn')
    runner.sandbox.argvPrefix = ['science-test-runner']
    runner.subprocess.spawnFailure = Object.assign(new Error('runner unavailable'), {
      code: 'ENOENT', path: 'science-test-runner', syscall: 'spawn science-test-runner',
    })
    const runnerHandle = await startReadyRun(runner, 'science-runner-spawn-call')
    await expect(runnerHandle.done).resolves.toMatchObject({
      terminal: { runId: runnerHandle.runId, status: 'failed', failureCode: 'SANDBOX_RUNNER_FAILED' },
    })

    const ordinary = await ready('science-ordinary-spawn')
    ordinary.subprocess.spawnFailure = Object.assign(new Error('interpreter spawn failed'), {
      code: 'EIO', path: 'unrelated-program', syscall: 'spawn unrelated-program',
    })
    const ordinaryHandle = await startReadyRun(ordinary, 'science-ordinary-spawn-call')
    await expect(ordinaryHandle.done).resolves.toMatchObject({
      terminal: { runId: ordinaryHandle.runId, status: 'failed', failureCode: 'SPAWN_FAILED' },
    })
    expect(ordinary.session.events.map(event => event.type).slice(-2)).toEqual([
      'science/run-started',
      'science/run-finished',
    ])
  })

  it('rejects done as TERMINAL_COMMIT_FAILED when a live Session cannot commit its terminal fact', async () => {
    const harness = await ready('science-terminal-commit')
    const run = harness.subprocess.queueRun('immediate')
    const stop = harness.ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [, event] = args as [unknown, { readonly type?: string }]
      if (event?.type === 'science/run-finished') throw new Error('injected terminal append failure')
    }, { global: true })
    try {
      const handle = await startReadyRun(harness, 'science-terminal-commit-call')
      run.complete({ exitCode: 0, signal: null })
      await expect(handle.done).rejects.toMatchObject({ code: 'TERMINAL_COMMIT_FAILED' })
      expect(harness.session.events.some(event => event.type === 'science/run-finished')).toBe(false)
    } finally {
      stop()
    }
  })

  it.each([
    ['empty', ''],
    ['NUL', 'print("x")\0'],
    ['lone surrogate', '\uD800'],
    ['oversized UTF-8', 'x'.repeat(262_145)],
  ])('rejects %s source before re-observation, scratch creation, start, or spawn', async (_label, code) => {
    const harness = await ready(`science-invalid-source-${_label}`)
    const beforeSpecs = harness.subprocess.specs.length
    const beforeStarted = harness.session.events.filter(event => event.type === 'science/run-started').length
    const runs = join(harness.root, 'dsh-home', 'science', 'v1', 'sessions', sessionScratchKey(harness.session), 'runs')
    await expect(harness.runtime.startRun({
      session: harness.session,
      language: 'python',
      code,
      ...authorizePythonRun(harness.session, `science-invalid-source-${_label}-call`),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(harness.subprocess.specs).toHaveLength(beforeSpecs)
    expect(harness.session.events.filter(event => event.type === 'science/run-started')).toHaveLength(beforeStarted)
    expect(readdirSync(runs)).toEqual([])
  })

  it('rolls back only a new run directory when its start fact is vetoed before spawn', async () => {
    const harness = await ready('science-start-veto')
    const beforeSourceSpawns = harness.subprocess.specs.filter(spec => spec.argv.includes('-u')).length
    const runs = join(harness.root, 'dsh-home', 'science', 'v1', 'sessions', sessionScratchKey(harness.session), 'runs')
    const stop = harness.ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [, event] = args as [unknown, { readonly type?: string }]
      if (event?.type === 'science/run-started') throw new Error('injected start append failure')
    }, { global: true })
    try {
      await expect(startReadyRun(harness, 'science-start-veto-call')).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
    } finally {
      stop()
    }
    expect(harness.subprocess.specs.filter(spec => spec.argv.includes('-u'))).toHaveLength(beforeSourceSpawns)
    expect(readdirSync(runs)).toEqual([])
  })
})
