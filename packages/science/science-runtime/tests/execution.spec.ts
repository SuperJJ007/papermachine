/** Focused coverage for execution.ts's standalone helpers not otherwise exercised through the run pipeline. */

import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SandboxProvider, { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { confineInterpreterArgv, confineWithEnforcement, interpreterArgv, interpreterPathEnv, localeEnvironment, quiesce, readCaptureTail } from '../src/execution.ts'
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
    return { env: {}, argv: [...argv], enforcement: this.enforcement, denialSignatures: [], runnerFailureRules: [] }
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

  it('rejects a partial-reporting sandbox when the caller passes a full minimum', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(FakeSandbox)
    const sandbox = ctx.sandbox as FakeSandbox
    sandbox.enforcement = 'partial'
    expect(() => confineInterpreterArgv(fakeSession, fakeScratch, sandbox, '/opt/conda-env', ['python'], 'full'))
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

describe('interpreterPathEnv', () => {
  it('joins the prefix bin with the fixed POSIX suffix on darwin/linux', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    try {
      expect(interpreterPathEnv('/prefix')).toBe(`${join('/prefix', 'bin')}:/usr/bin:/bin`)
    } finally {
      platform.mockRestore()
    }
  })

  it('builds the full ordered Conda subdirectory PATH conda activate itself uses on win32', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(interpreterPathEnv('C:\\Users\\dsh\\conda\\envs\\general')).toBe([
        'C:\\Users\\dsh\\conda\\envs\\general',
        'C:\\Users\\dsh\\conda\\envs\\general\\Library\\mingw-w64\\bin',
        'C:\\Users\\dsh\\conda\\envs\\general\\Library\\usr\\bin',
        'C:\\Users\\dsh\\conda\\envs\\general\\Library\\bin',
        'C:\\Users\\dsh\\conda\\envs\\general\\Scripts',
        'C:\\Users\\dsh\\conda\\envs\\general\\bin',
      ].join(';'))
    } finally {
      platform.mockRestore()
    }
  })
})

describe('localeEnvironment', () => {
  it('uses en_US.UTF-8 on win32, not the POSIX C.UTF-8 other non-Darwin platforms get', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(localeEnvironment()).toEqual({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TZ: 'UTC' })
    } finally {
      platform.mockRestore()
    }
  })

  it('uses the POSIX C.UTF-8 on linux', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    try {
      expect(localeEnvironment()).toEqual({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' })
    } finally {
      platform.mockRestore()
    }
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
  it('retains eventual exit evidence when neither bounded observation proves cleanup', async () => {
    const proof = Promise.withResolvers<boolean>()
    const terminate = vi.fn()
    const waitForExit = vi.fn((signal?: AbortSignal) => signal === undefined ? proof.promise : Promise.resolve(false))
    // The provider intentionally withholds tree-exit evidence after the termination request.
    const result = await quiesce({ terminate, waitForExit } as unknown as SubprocessHandle)
    expect(result.quiescent).toBe(false)
    expect(terminate).toHaveBeenCalledOnce()
    if (result.quiescent) throw new Error('cleanup was reported without exit evidence')
    proof.resolve(true)
    await expect(result.eventualQuiescence).resolves.toBe(true)
    expect(waitForExit).toHaveBeenCalledTimes(3)
  })

  it('waits again after a forced termination and proves quiescence within the second grace window', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn({
      environmentBase: 'scrubbed-parent' as const,
      argv: [process.execPath, '-e', 'setInterval(() => {}, 1_000)'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
      graceMs: 3_000,
    })
    // The process never exits on its own within the first grace window, so
    // the first waitForExit(grace) proves false; terminate() then sends
    // SIGTERM, which this plain Node process has installed no handler
    // against, so the second waitForExit(forced) proves quiescence quickly.
    await expect(quiesce(handle)).resolves.toEqual({ quiescent: true, forced: true })
  }, 30_000)

  // Windows delivers no real signals: child_process's 'SIGTERM'/'SIGKILL'
  // both compile to an unconditional TerminateProcess regardless of any
  // handler the child installed, so a process that "ignores SIGTERM" on
  // POSIX cannot be modeled there — it always dies within the first grace
  // window instead of surviving into the escalation path this test proves.
  it.skipIf(process.platform === 'win32')('returns eventual quiescence unproven when the tree survives both bounded grace windows', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    // The child reports its own pid over stdout because SubprocessHandle no
    // longer exposes one (upstream keeps target identity provider-private);
    // this test still needs it to force a final SIGKILL from outside the seam.
    const handle = ctx.subprocess.spawn({
      environmentBase: 'scrubbed-parent' as const,
      argv: [process.execPath, '-e', "process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid)); setInterval(() => {}, 1_000)"],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
      graceMs: 3_000,
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
    const pid = Number(handle.collected.stdout!.readFrom(0).text)
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('child did not report a valid process id')
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      process.kill(pid, 'SIGKILL')
    }
    await expect(result.eventualQuiescence).resolves.toBe(true)
  }, 30_000)
})
