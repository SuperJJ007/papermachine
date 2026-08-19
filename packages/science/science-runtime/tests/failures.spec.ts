/**
 * Pre-publication source validation and terminal-commit failure behavior.
 * The deleted one-shot spawn path's fine-grained runner/denial/spawn-failure
 * classification (SANDBOX_RUNNER_FAILED, SANDBOX_DENIED, SPAWN_FAILED for a
 * run's own terminal) no longer applies: a kernel run's only failure codes
 * are TIMEOUT/CANCELLED/EXECUTION_FAILED/KERNEL_DIED (D10), and a kernel
 * spawn failure is a pre-publication KERNEL_START_FAILED rejection
 * (`run.spec.ts` covers that path) rather than a run terminal.
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import {
  authorizePythonRun,
  createFakePythonPrefix,
  createKernelRuntimeHarness,
  createScienceSession,
  kernelAction,
} from './harness.ts'
import { sessionScratchKey } from '../src/scratch.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Build an applied fake environment ready to publish one kernel-run source. */
async function ready(id: string) {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-failures-'))
  roots.push(root)
  const prefix = createFakePythonPrefix(root)
  const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
  contexts.push(harness.ctx)
  const session = createScienceSession(harness.ctx, id)
  await harness.runtime.bindEnvironment({
    session,
    profileId: ScienceEnvironmentProfileId('fake'),
    signal: new AbortController().signal,
  })
  return { ...harness, root, session }
}

describe('ScienceRuntime post-start failure classification', () => {
  it('rejects done as TERMINAL_COMMIT_FAILED when a live Session cannot commit its terminal fact', async () => {
    const harness = await ready('science-terminal-commit')
    const stop = harness.ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [, event] = args as [unknown, { readonly type?: string }]
      if (event?.type === 'science/run-finished') throw new Error('injected terminal append failure')
    }, { global: true })
    try {
      const handle = await harness.runtime.startRun({
        session: harness.session,
        language: 'python',
        code: kernelAction({ status: 'ok' }),
        ...authorizePythonRun(harness.session, 'science-terminal-commit-call'),
        signal: new AbortController().signal,
      })
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
  ])('rejects %s source before scratch creation, kernel acquisition, or start', async (_label, code) => {
    const harness = await ready(`science-invalid-source-${_label}`)
    const beforeStarted = harness.session.events.filter(event => event.type === 'science/run-started').length
    const runs = join(harness.root, 'dsh-home', 'science', 'v1', 'sessions', sessionScratchKey(harness.session), 'runs')
    await expect(harness.runtime.startRun({
      session: harness.session,
      language: 'python',
      code,
      ...authorizePythonRun(harness.session, `science-invalid-source-${_label}-call`),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(harness.session.events.filter(event => event.type === 'science/run-started')).toHaveLength(beforeStarted)
    expect(harness.session.events.some(event => event.type === 'science/kernel-state')).toBe(false)
    expect(readdirSync(runs)).toEqual([])
  })

  it('rolls back only a new run directory when its start fact is vetoed before spawn', async () => {
    const harness = await ready('science-start-veto')
    const runs = join(harness.root, 'dsh-home', 'science', 'v1', 'sessions', sessionScratchKey(harness.session), 'runs')
    const stop = harness.ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [, event] = args as [unknown, { readonly type?: string }]
      if (event?.type === 'science/run-started') throw new Error('injected start append failure')
    }, { global: true })
    try {
      await expect(harness.runtime.startRun({
        session: harness.session,
        language: 'python',
        code: kernelAction({ status: 'ok' }),
        ...authorizePythonRun(harness.session, 'science-start-veto-call'),
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
    } finally {
      stop()
    }
    expect(readdirSync(runs)).toEqual([])
    // The kernel-started fact already committed before run-started's own
    // veto (D4 commit ordering) and is not rolled back: the kernel it names
    // stays live for a retry to reuse.
    expect(harness.session.events.filter(event => event.type === 'science/kernel-state')).toHaveLength(1)
  })
})
