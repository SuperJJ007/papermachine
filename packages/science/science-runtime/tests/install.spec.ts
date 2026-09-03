/** Focused coverage for micromamba install argv, confinement, scratch, and subprocess classification. */

import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
import { OperationControl } from '../src/lifecycle.ts'
import {
  assertValidPackageSpecs,
  confineInstallArgv,
  createInstallScratch,
  installArgv,
  installEnvironment,
  MAX_INSTALL_PACKAGES,
  MAX_PACKAGE_SPEC_LENGTH,
  planInstallScratch,
  removeInstallScratch,
  runMicromambaInstall,
  staticMicromamba,
} from '../src/install.ts'
import { ScienceRuntimeError } from '../src/types.ts'
import { ControlledSubprocess, DirectSandbox } from './harness.ts'

const staticFsFault = vi.hoisted(() => ({ realpath: '', lstat: '', lstatNonObject: '' }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    realpath: async (path: Parameters<typeof original.realpath>[0], options?: Parameters<typeof original.realpath>[1]) => {
      if (path === staticFsFault.realpath) throw Object.assign(new Error('injected realpath failure'), { code: 'EACCES' })
      return original.realpath(path, options as never)
    },
    lstat: async (path: Parameters<typeof original.lstat>[0], options?: Parameters<typeof original.lstat>[1]) => {
      if (path === staticFsFault.lstat) throw Object.assign(new Error('injected lstat failure'), { code: 'EACCES' })
      if (path === staticFsFault.lstatNonObject) throw 'injected non-object lstat failure'
      return original.lstat(path, options as never)
    },
  }
})

const roots: string[] = []
afterEach(() => {
  staticFsFault.realpath = ''
  staticFsFault.lstat = ''
  staticFsFault.lstatNonObject = ''
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'science-install-'))
  roots.push(root)
  return root
}

describe('assertValidPackageSpecs', () => {
  it('accepts one or more well-formed unique specs', () => {
    expect(() => { assertValidPackageSpecs(['numpy', 'numpy=1.26', 'r-dplyr>=1.1,<2']) }).not.toThrow()
  })

  it('rejects an empty list', () => {
    expect(() => { assertValidPackageSpecs([]) }).toThrow(/at least one package spec/)
  })

  it('rejects more than the fixed maximum', () => {
    const packages = Array.from({ length: MAX_INSTALL_PACKAGES + 1 }, (_v, i) => `pkg${String(i)}`)
    expect(() => { assertValidPackageSpecs(packages) }).toThrow(/at most/)
  })

  it('rejects duplicate specs', () => {
    expect(() => { assertValidPackageSpecs(['numpy', 'numpy']) }).toThrow(/unique/)
  })

  it('rejects a spec that is too long', () => {
    expect(() => { assertValidPackageSpecs(['a'.repeat(MAX_PACKAGE_SPEC_LENGTH + 1)]) }).toThrow(/is invalid/)
  })

  it('rejects a spec starting with a dash (flag-injection risk) or other disallowed characters', () => {
    expect(() => { assertValidPackageSpecs(['--force-reinstall']) }).toThrow(/is invalid/)
    expect(() => { assertValidPackageSpecs(['num py']) }).toThrow(/is invalid/)
    expect(() => { assertValidPackageSpecs(['num;py']) }).toThrow(/is invalid/)
  })

  it('throws ScienceRuntimeError with code INVALID_REQUEST', () => {
    try {
      assertValidPackageSpecs([])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ScienceRuntimeError)
      expect((error as ScienceRuntimeError).code).toBe('INVALID_REQUEST')
    }
  })
})

describe('installArgv', () => {
  it('builds a fixed, non-interactive, single-channel argv with the trailing packages', () => {
    expect(installArgv('/opt/micromamba', '/opt/prefix', ['numpy', 'pandas'], 'https://conda.anaconda.org/conda-forge')).toEqual([
      '/opt/micromamba', 'install', '--yes', '--no-rc',
      '--prefix', '/opt/prefix',
      '--override-channels', '--channel', 'https://conda.anaconda.org/conda-forge',
      'numpy', 'pandas',
    ])
  })

  it('never merges more than the one requested channel URL into the argv', () => {
    const argv = installArgv('/opt/micromamba', '/opt/prefix', ['numpy'], 'https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge')
    expect(argv.filter(token => token === '--channel')).toHaveLength(1)
  })
})

describe('install scratch', () => {
  it('plans, creates, and removes a unique tree rooted under the target prefix', async () => {
    const root = makeRoot()
    const scratch = planInstallScratch(root)
    expect(scratch.directory.startsWith(join(root, '.dsh-science-install'))).toBe(true)
    expect(scratch.home).toBe(join(scratch.directory, 'home'))
    expect(scratch.tmp).toBe(join(scratch.directory, 'tmp'))
    await createInstallScratch(scratch)
    expect(existsSync(scratch.home)).toBe(true)
    expect(existsSync(scratch.tmp)).toBe(true)
    await removeInstallScratch(scratch)
    expect(existsSync(scratch.directory)).toBe(false)
  })

  it('planning twice for the same prefix never collides', () => {
    const root = makeRoot()
    expect(planInstallScratch(root).directory).not.toBe(planInstallScratch(root).directory)
  })

  it('removal is safe even when creation never happened', async () => {
    const root = makeRoot()
    await expect(removeInstallScratch(planInstallScratch(root))).resolves.toBeUndefined()
  })
})

describe('installEnvironment', () => {
  it('isolates HOME/TMPDIR to the install scratch and roots MAMBA_ROOT_PREFIX at the target prefix', () => {
    const root = makeRoot()
    const scratch = planInstallScratch(root)
    const env = installEnvironment(root, scratch)
    expect(env.HOME).toBe(scratch.home)
    expect(env.TMPDIR).toBe(scratch.tmp)
    expect(env.MAMBA_ROOT_PREFIX).toBe(root)
    expect(env.PATH).toContain(root)
    expect(env.LANG).toBeDefined()
  })
})

function makeExecutable(root: string, name = 'fake-micromamba'): string {
  const executable = join(root, name)
  writeFileSync(executable, '#!/bin/sh\nexit 0\n')
  chmodSync(executable, 0o755)
  return executable
}

describe('staticMicromamba', () => {
  it('resolves a configured regular executable path', async () => {
    const root = makeRoot()
    const executable = makeExecutable(root)
    await expect(staticMicromamba(executable)).resolves.toBe(realpathSync(executable))
  })

  it('rejects an absent path as INSTALLER_UNAVAILABLE', async () => {
    const root = makeRoot()
    await expect(staticMicromamba(join(root, 'missing'))).rejects.toMatchObject({ code: 'INSTALLER_UNAVAILABLE' })
  })

  it('resolves through a symlink to its realpath target', async () => {
    const root = makeRoot()
    const executable = makeExecutable(root)
    const link = join(root, 'link-to-micromamba')
    symlinkSync(executable, link)
    await expect(staticMicromamba(link)).resolves.toBe(realpathSync(executable))
  })

  it('rejects a non-executable regular file on POSIX', async () => {
    if (process.platform === 'win32') return
    const root = makeRoot()
    const notExecutable = join(root, 'not-executable')
    writeFileSync(notExecutable, '#!/bin/sh\nexit 0\n')
    chmodSync(notExecutable, 0o600)
    await expect(staticMicromamba(notExecutable)).rejects.toMatchObject({ code: 'INSTALLER_UNAVAILABLE' })
  })

  it('rejects a directory as not a regular executable', async () => {
    const root = makeRoot()
    await expect(staticMicromamba(root)).rejects.toMatchObject({ code: 'INSTALLER_UNAVAILABLE' })
  })

  it('propagates a non-missing-path realpath failure unchanged', async () => {
    const root = makeRoot()
    const executable = makeExecutable(root)
    staticFsFault.realpath = executable
    await expect(staticMicromamba(executable)).rejects.toThrow(/injected realpath failure/)
  })

  it('propagates a non-missing-path lstat failure unchanged', async () => {
    const root = makeRoot()
    const executable = makeExecutable(root)
    staticFsFault.lstat = realpathSync(executable)
    await expect(staticMicromamba(executable)).rejects.toThrow(/injected lstat failure/)
  })

  it('propagates a non-object rejection unchanged (not classified as a missing path)', async () => {
    const root = makeRoot()
    const executable = makeExecutable(root)
    staticFsFault.lstatNonObject = realpathSync(executable)
    await expect(staticMicromamba(executable)).rejects.toBe('injected non-object lstat failure')
  })
})

describe('confineInstallArgv', () => {
  const contexts: Context[] = []
  afterEach(async () => {
    await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  })

  async function mountSandbox<T extends DirectSandbox>(ctor: new (ctx: Context) => T): Promise<T> {
    const ctx = new Context()
    await ctx.plugin(ctor)
    contexts.push(ctx)
    return ctx.sandbox as T
  }

  it('confines under a workspace-write policy rooted at the prefix itself', async () => {
    const sandbox = await mountSandbox(DirectSandbox)
    const session = { id: SessionId('confine-test') }
    const confined = confineInstallArgv(sandbox, session as never, '/opt/prefix', ['/opt/micromamba', 'install'])
    expect(confined.argv).toEqual(['/opt/micromamba', 'install'])
    expect(sandbox.policies).toEqual([{ mode: 'workspace-write', workspaceRoot: '/opt/prefix', sessionId: session.id }])
  })

  it('maps SandboxUnavailableError to CONFINEMENT_UNAVAILABLE', async () => {
    class UnavailableSandbox extends DirectSandbox {
      override confine(): ConfinedArgv {
        throw new SandboxUnavailableError('workspace-write', 'no sandbox available')
      }
    }
    const sandbox = await mountSandbox(UnavailableSandbox)
    const session = { id: SessionId('confine-test-2') }
    expect(() => confineInstallArgv(sandbox, session as never, '/opt/prefix', ['x'])).toThrow(
      expect.objectContaining({ code: 'CONFINEMENT_UNAVAILABLE' }),
    )
  })

  it('propagates a non-SandboxUnavailableError confinement failure unchanged', async () => {
    class BrokenSandbox extends DirectSandbox {
      override confine(): ConfinedArgv {
        throw new Error('injected confinement failure')
      }
    }
    const sandbox = await mountSandbox(BrokenSandbox)
    const session = { id: SessionId('confine-test-3') }
    expect(() => confineInstallArgv(sandbox, session as never, '/opt/prefix', ['x'])).toThrow(/injected confinement failure/)
  })

  it('rejects less-than-full enforcement as CONFINEMENT_UNAVAILABLE', async () => {
    const sandbox = await mountSandbox(DirectSandbox)
    sandbox.enforcement = 'partial'
    const session = { id: SessionId('confine-test-4') }
    expect(() => confineInstallArgv(sandbox, session as never, '/opt/prefix', ['x'])).toThrow(
      expect.objectContaining({ code: 'CONFINEMENT_UNAVAILABLE' }),
    )
  })

  it('never asserts the prefix stays outside the writable root, the deliberate divergence from run/probe confinement', async () => {
    // Unlike execution.ts's confineWithFullEnforcement, granting the prefix
    // itself as workspaceRoot must succeed rather than throw.
    const sandbox = await mountSandbox(DirectSandbox)
    const session = { id: SessionId('confine-test-5') }
    expect(() => confineInstallArgv(sandbox, session as never, '/opt/prefix', ['x'])).not.toThrow()
  })
})

const contexts: Context[] = []
afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('runMicromambaInstall', () => {
  async function harness(): Promise<{ readonly subprocess: ControlledSubprocess; readonly root: string }> {
    const root = makeRoot()
    const ctx = new Context()
    await ctx.plugin(ControlledSubprocess)
    contexts.push(ctx)
    return { subprocess: ctx.subprocess as ControlledSubprocess, root }
  }

  it('classifies a zero-exit settlement as success and captures bounded output', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('immediate', { stdout: 'installed numpy-1.26.4\n', stderr: '' })
    run.complete({ exitCode: 0, signal: null })
    const control = new OperationControl(new AbortController().signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    const outcome = await runMicromambaInstall(subprocess, confined, {}, root, control)
    expect(outcome).toEqual({
      status: 'success',
      stdout: { text: 'installed numpy-1.26.4\n', bytes: Buffer.byteLength('installed numpy-1.26.4\n'), truncated: false },
      stderr: { text: '', bytes: 0, truncated: false },
    })
    control.dispose()
  })

  it('classifies a non-zero exit as failed', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('immediate', { stdout: '', stderr: 'PackagesNotFoundError\n' })
    run.complete({ exitCode: 1, signal: null })
    const control = new OperationControl(new AbortController().signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    const outcome = await runMicromambaInstall(subprocess, confined, {}, root, control)
    expect(outcome.status).toBe('failed')
    expect(outcome.stderr.text).toBe('PackagesNotFoundError\n')
    control.dispose()
  })

  it('classifies a signal-terminated exit as failed', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('immediate')
    run.complete({ exitCode: null, signal: 'SIGKILL' })
    const control = new OperationControl(new AbortController().signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    const outcome = await runMicromambaInstall(subprocess, confined, {}, root, control)
    expect(outcome.status).toBe('failed')
    control.dispose()
  })

  it('classifies caller cancellation as cancelled', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('deferred')
    const controller = new AbortController()
    const control = new OperationControl(controller.signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    const pending = runMicromambaInstall(subprocess, confined, {}, root, control)
    controller.abort()
    // A real subprocess provider reacts to the fused signal by terminating
    // the tree, which is what eventually settles `done`/quiescence; this
    // fake requires that reaction to be driven explicitly.
    run.complete({ exitCode: null, signal: 'SIGTERM' })
    run.proveQuiescence()
    const outcome = await pending
    expect(outcome.status).toBe('cancelled')
    control.dispose()
  })

  it('classifies a timeout as timed-out', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('deferred')
    const control = new OperationControl(new AbortController().signal, 1)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    const pending = runMicromambaInstall(subprocess, confined, {}, root, control)
    await new Promise(resolve => setTimeout(resolve, 20))
    run.complete({ exitCode: null, signal: 'SIGTERM' })
    run.proveQuiescence()
    const outcome = await pending
    expect(outcome.status).toBe('timed-out')
    control.dispose()
  })

  it('classifies a zero-exit settlement that lands inside the deadline\'s SIGTERM grace as success, not timed-out', async () => {
    const { subprocess, root } = await harness()
    // 'immediate' mode pre-resolves whole-tree quiescence (matching a real
    // process whose termination is already fully observed) so this test can
    // isolate exactly one race: the deadline firing before the process's own
    // completion settles. 'deferred' mode's own quiescence answer never
    // resolves true from runMicromambaInstall's single, un-retried
    // `waitForExit()` call, which would make this success path unreachable
    // for a reason unrelated to what this test targets.
    const run = subprocess.queueRun('immediate', { stdout: 'installed numpy-1.26.4\n', stderr: '' })
    const control = new OperationControl(new AbortController().signal, 1)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    const pending = runMicromambaInstall(subprocess, confined, {}, root, control)
    await new Promise(resolve => setTimeout(resolve, 20))
    // control.cause has already latched 'timeout' by the time the process
    // finishes cleanly — the exact race runMicromambaInstall's own
    // exit-code-first classification exists to resolve.
    expect(control.cause).toBe('timeout')
    run.complete({ exitCode: 0, signal: null })
    const outcome = await pending
    expect(outcome.status).toBe('success')
    expect(outcome.stdout.text).toBe('installed numpy-1.26.4\n')
    control.dispose()
  })

  it('throws when the subprocess settles without whole-tree quiescence', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('deferred', { stdout: '', stderr: '' })
    run.complete({ exitCode: 0, signal: null })
    const control = new OperationControl(new AbortController().signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    await expect(runMicromambaInstall(subprocess, confined, {}, root, control)).rejects.toMatchObject({ code: 'QUIESCENCE_UNPROVEN' })
    control.dispose()
  })

  it('rethrows a rejected completion Error', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('immediate')
    run.rejectCompletion(new Error('injected completion failure'))
    const control = new OperationControl(new AbortController().signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    await expect(runMicromambaInstall(subprocess, confined, {}, root, control)).rejects.toThrow(/injected completion failure/)
    control.dispose()
  })

  it('wraps a rejected non-Error completion', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('immediate')
    run.rejectCompletion('non-error rejection')
    const control = new OperationControl(new AbortController().signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    await expect(runMicromambaInstall(subprocess, confined, {}, root, control)).rejects.toThrow(/without an Error object/)
    control.dispose()
  })

  it('throws when the subprocess resolves with a malformed non-outcome', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('immediate')
    run.resolveMalformedOutcome()
    const control = new OperationControl(new AbortController().signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    await expect(runMicromambaInstall(subprocess, confined, {}, root, control)).rejects.toThrow(/settled without a subprocess outcome/)
    control.dispose()
  })

  it('reports empty output when the provider omits a collected stream', async () => {
    const { subprocess, root } = await harness()
    const run = subprocess.queueRun('immediate', { stdout: 'x', stderr: '' })
    run.omitStdout()
    run.complete({ exitCode: 0, signal: null })
    const control = new OperationControl(new AbortController().signal, 10_000)
    const confined = { argv: ['/fake/micromamba', 'install'], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
    const outcome = await runMicromambaInstall(subprocess, confined, {}, root, control)
    expect(outcome.stdout).toEqual({ text: '', bytes: 0, truncated: false })
    control.dispose()
  })
})
