/** Focused coverage for execution.ts's standalone helpers not otherwise exercised through the run pipeline. */

import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SandboxProvider, { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { confineInterpreterArgv, confineWithEnforcement, interpreterArgv, quiesce, readCaptureTail } from '../src/execution.ts'
import type { ScienceSessionScratch } from '../src/scratch.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('interpreterArgv', () => {
  it('drops isolated mode for a Python kernel so PYTHONUSERBASE-scoped inline installs are importable', () => {
    expect(interpreterArgv('python', '/prefix/bin/python', '/driver.py', '/resp.fifo'))
      .toEqual(['/prefix/bin/python', '-B', '-u', '-X', 'utf8', '/driver.py', '/resp.fifo'])
  })

  it('leaves the R kernel flag set unaffected', () => {
    expect(interpreterArgv('r', '/prefix/bin/Rscript', '/driver.R', '/resp.fifo'))
      .toEqual(['/prefix/bin/Rscript', '--vanilla', '--encoding=UTF-8', '/driver.R', '/resp.fifo'])
  })
})

/** Test-selected enforcement or unavailability, reporting the caller's policy so a test can assert its writable root. */
class FakeSandbox extends SandboxProvider {
  enforcement: 'full' | 'partial' = 'full'
  unavailable = false

  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    if (this.unavailable) throw new SandboxUnavailableError('workspace-write')
    return { argv: [...argv], enforcement: this.enforcement, denialSignatures: [], runnerFailureRules: [] }
  }
}

describe('confineWithEnforcement', () => {
  async function fakeSandbox(): Promise<{ readonly ctx: Context; readonly sandbox: FakeSandbox }> {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(FakeSandbox)
    return { ctx, sandbox: ctx.sandbox as FakeSandbox }
  }

  const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: '/workspace', sessionId: SessionId('test-session') }

  it('accepts a full report against a full minimum', async () => {
    const { sandbox } = await fakeSandbox()
    expect(confineWithEnforcement(sandbox, '/opt/conda-env', policy, ['python'], 'full'))
      .toMatchObject({ enforcement: 'full' })
  })

  it('rejects a partial report against a full minimum, naming both levels', async () => {
    const { sandbox } = await fakeSandbox()
    sandbox.enforcement = 'partial'
    expect(() => confineWithEnforcement(sandbox, '/opt/conda-env', policy, ['python'], 'full'))
      .toThrow(/Science requires at least full sandbox enforcement; the sandbox reported partial/)
  })

  it('accepts a partial report against a partial minimum', async () => {
    const { sandbox } = await fakeSandbox()
    sandbox.enforcement = 'partial'
    expect(confineWithEnforcement(sandbox, '/opt/conda-env', policy, ['python'], 'partial'))
      .toMatchObject({ enforcement: 'partial' })
  })

  it('accepts a full report against a partial minimum', async () => {
    const { sandbox } = await fakeSandbox()
    expect(confineWithEnforcement(sandbox, '/opt/conda-env', policy, ['python'], 'partial'))
      .toMatchObject({ enforcement: 'full' })
  })

  it('rejects an unavailable sandbox regardless of the configured minimum', async () => {
    const { sandbox } = await fakeSandbox()
    sandbox.unavailable = true
    expect(() => confineWithEnforcement(sandbox, '/opt/conda-env', policy, ['python'], 'partial'))
      .toThrow(/Science requires an available sandbox/)
  })
})

describe('confineInterpreterArgv', () => {
  const fakeSession = { id: SessionId('test-session') } as unknown as Session
  const fakeScratch = { root: '/workspace' } as unknown as ScienceSessionScratch

  it('defaults to a full minimum for a caller that does not pass one', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(FakeSandbox)
    const sandbox = ctx.sandbox as FakeSandbox
    sandbox.enforcement = 'partial'
    expect(() => confineInterpreterArgv(fakeSession, fakeScratch, sandbox, '/opt/conda-env', ['python']))
      .toThrow(/Science requires at least full sandbox enforcement; the sandbox reported partial/)
  })

  it('accepts a caller-passed minimum below full', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(FakeSandbox)
    const sandbox = ctx.sandbox as FakeSandbox
    sandbox.enforcement = 'partial'
    expect(confineInterpreterArgv(fakeSession, fakeScratch, sandbox, '/opt/conda-env', ['python'], 'partial'))
      .toMatchObject({ enforcement: 'partial' })
  })
})

describe('readCaptureTail', () => {
  it('reads an existing empty file the same way as a missing one', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-execution-tail-'))
    roots.push(root)
    const path = join(root, 'stdout.txt')
    closeSync(openSync(path, 'w'))
    await expect(readCaptureTail(path)).resolves.toEqual({ text: '', bytes: 0, truncated: false })
    await expect(readCaptureTail(join(root, 'never-written.txt'))).resolves.toEqual({ text: '', bytes: 0, truncated: false })
  })

  it('reads a short existing file whole, untruncated', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-execution-tail-short-'))
    roots.push(root)
    const path = join(root, 'stdout.txt')
    const fd = openSync(path, 'w')
    writeSync(fd, 'hello')
    closeSync(fd)
    await expect(readCaptureTail(path)).resolves.toEqual({ text: 'hello', bytes: 5, truncated: false })
  })
})

describe('quiesce', () => {
  it('waits again after a forced termination and proves quiescence within the second grace window', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn({
      argv: [process.execPath, '-e', 'setInterval(() => {}, 1_000)'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
      graceMs: 3_000,
      environmentBase: 'empty',
    })
    // The process never exits on its own within the first grace window, so
    // the first waitForExit(grace) proves false; terminate() then sends
    // SIGTERM, which this plain Node process has installed no handler
    // against, so the second waitForExit(forced) proves quiescence quickly.
    await expect(quiesce(handle)).resolves.toEqual({ quiescent: true, forced: true })
  }, 30_000)

  it('returns eventual quiescence unproven when the tree survives both bounded grace windows', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn({
      argv: [process.execPath, '-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)"],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
      graceMs: 3_000,
      environmentBase: 'empty',
    })
    // This process ignores SIGTERM, so terminate() cannot prove quiescence
    // within the second grace window either; the caller keeps quarantine
    // active on the returned eventualQuiescence instead.
    const result = await quiesce(handle)
    expect(result).toMatchObject({ quiescent: false, forced: true })
    if (result.quiescent) throw new Error('unreachable: asserted above')
    // SIGTERM alone never reaps this process: prove eventualQuiescence
    // resolves once something unblockable (SIGKILL) finally does, rather
    // than hanging the test forever on a tree only this test owns.
    try {
      process.kill(-handle.pid, 'SIGKILL')
    } catch {
      process.kill(handle.pid, 'SIGKILL')
    }
    await expect(result.eventualQuiescence).resolves.toBe(true)
  }, 30_000)
})
