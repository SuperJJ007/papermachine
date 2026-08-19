/**
 * `KernelProcess` against a fake D2-protocol driver (`fixtures/fake-kernel-driver.mjs`),
 * driven through the real `dsh-subprocess-local` and `dsh-sandbox-local`
 * providers the way `loader-composition.spec.ts` composes them.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceInterpreterAvailableBinding, ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import {
  KernelExitedError,
  KernelProcess,
  KernelProtocolError,
} from '../src/kernel-process.ts'
import type { KernelExecuteRequest, KernelProcessServices } from '../src/kernel-process.ts'
import { ensureSessionScratch, planKernelScratch } from '../src/scratch.ts'
import type { ScienceSessionScratch } from '../src/scratch.ts'
import { ScienceRuntimeError } from '../src/types.ts'
import { createFakeSandboxRunner } from './harness.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const DRIVER_PATH = join(FIXTURES, 'fake-kernel-driver.mjs')
const NO_READY_DRIVER_PATH = join(FIXTURES, 'fake-kernel-driver-no-ready.mjs')

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A fake "interpreter" executable: a shell wrapper that discards every
 * leading hardening flag `interpreterArgv` prepends and forwards only the
 * trailing driver-path/fifo-path pair to this Node process, absolute-pathed
 * so it works under the kernel spawn's fixed minimal PATH.
 */
function createFakeInterpreterPrefix(root: string, language: ScienceLanguage): string {
  const prefix = join(root, `fake-${language}-conda`)
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  const executable = join(prefix, 'bin', language === 'python' ? 'python' : 'Rscript')
  writeFileSync(executable, `#!/bin/sh\nwhile [ "$#" -gt 2 ]; do shift; done\nexec "${process.execPath}" "$1" "$2"\n`)
  chmodSync(executable, 0o755)
  return prefix
}

/** Fabricate an already-observed available binding; KernelProcess never re-validates it. */
function fakeBinding(language: ScienceLanguage, prefix: string): ScienceInterpreterAvailableBinding {
  return {
    language,
    configuredPrefix: prefix,
    canonicalPrefix: prefix,
    executable: join(prefix, 'bin', language === 'python' ? 'python' : 'Rscript'),
    executableIdentity: 'fake-identity',
    languageVersion: 'fake-1.0',
    condaHistorySha256: 'fake-history-sha',
    bindingFingerprint: `fake-binding-${language}`,
    packages: [],
    packagesSha256: 'fake-packages-sha',
    packagesTruncated: false,
    capability: 'available',
  }
}

interface Harness {
  readonly root: string
  readonly session: Session
  readonly services: KernelProcessServices
}

/** Assemble real Session, subprocess-local, and sandbox-local providers (no-policy fake runner) for one kernel. */
async function createHarness(id: string): Promise<Harness> {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-kernel-process-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  const runner = createFakeSandboxRunner(root)
  await ctx.plugin(LocalSandboxProvider, {
    runnerCommand: [runner],
    runnerFailureSignatures: ['science-runtime fake runner failure'],
  })
  const session = ctx.sessions.create(SessionId(id))
  const sessionScratch: ScienceSessionScratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
  return {
    root,
    session,
    services: { subprocess: ctx.subprocess, sandbox: ctx.sandbox, session, sessionScratch },
  }
}

/** Start a kernel against the fake driver with a generous default deadline. */
function startKernel(
  harness: Harness,
  language: ScienceLanguage,
  overrides: { readonly driverPath?: string; readonly index?: number; readonly kernelStartTimeoutMs?: number } = {},
): Promise<KernelProcess> {
  const prefix = createFakeInterpreterPrefix(harness.root, language)
  return KernelProcess.start({
    services: harness.services,
    binding: fakeBinding(language, prefix),
    driverPath: overrides.driverPath ?? DRIVER_PATH,
    index: overrides.index ?? 0,
    kernelStartTimeoutMs: overrides.kernelStartTimeoutMs ?? 5_000,
  })
}

/** Flush one RUN request's private scratch: a JSON action file the fake driver reads instead of real source. */
async function prepareRun(root: string, runId: string, action: Record<string, unknown>): Promise<KernelExecuteRequest> {
  const dir = join(root, 'kernel-runs', runId)
  const artifactDir = join(dir, 'artifacts')
  await mkdir(artifactDir, { recursive: true })
  const sourcePath = join(dir, 'action.json')
  await writeFile(sourcePath, JSON.stringify(action))
  return {
    runId: ScienceRunId(runId),
    sourcePath,
    cwd: dir,
    stdoutPath: join(dir, 'stdout.txt'),
    stderrPath: join(dir, 'stderr.txt'),
    artifactDir,
  }
}

describe('KernelProcess', () => {
  it('completes the READY handshake', async () => {
    const harness = await createHarness('kernel-handshake')
    const kernel = await startKernel(harness, 'python')
    expect(kernel).toBeInstanceOf(KernelProcess)
    await kernel.end('test-teardown')
  })

  it('rejects with KernelProtocolError when READY does not arrive within the deadline', async () => {
    const harness = await createHarness('kernel-ready-timeout')
    await expect(startKernel(harness, 'python', { driverPath: NO_READY_DRIVER_PATH, kernelStartTimeoutMs: 200 }))
      .rejects.toThrow(KernelProtocolError)
  })

  it('a run of READY-timeout failures (no-ready driver) leaks no libuv threadpool worker (A1 finding 2)', async () => {
    const harness = await createHarness('kernel-start-failure-threadpool')
    // One more than the default libuv threadpool size: every prior fs.*
    // call in this suite has already returned its worker, so this many
    // sequential failures is enough to exhaust every worker if (pre-fix)
    // each failed start's response-FIFO read-side open() blocks one
    // permanently — the no-ready driver never opens the FIFO's write end.
    const threadpoolSize = Number(process.env.UV_THREADPOOL_SIZE ?? 4)
    for (let attempt = 0; attempt < threadpoolSize + 1; attempt += 1) {
      await expect(startKernel(harness, 'python', {
        driverPath: NO_READY_DRIVER_PATH,
        kernelStartTimeoutMs: 200,
        index: attempt,
      })).rejects.toThrow(KernelProtocolError)
    }
    // No leaked worker: an ordinary fs call, which also needs a threadpool
    // worker, still completes promptly instead of queuing forever behind
    // permanently blocked opens.
    const probe = stat(harness.root).then(() => 'resolved' as const)
    const raced = await Promise.race([
      probe,
      new Promise<'timed-out'>(resolve => setTimeout(() => { resolve('timed-out') }, 2_000)),
    ])
    expect(raced).toBe('resolved')
  }, 30_000)

  it('a confine failure before spawn releases the FIFO so a same-index retry does not hit mkfifo: File exists (A1 finding 2)', async () => {
    const harness = await createHarness('kernel-start-failure-retry')
    // A prefix inside the confinement policy's own writable root fails
    // `assertPrefixReadOnly` inside `confineInterpreterArgv`, before
    // `services.subprocess.spawn` is ever called — no KernelProcess
    // instance, and no driver process, ever exists for this attempt.
    const overlappingPrefix = harness.services.sessionScratch.root
    await expect(KernelProcess.start({
      services: harness.services,
      binding: fakeBinding('python', overlappingPrefix),
      driverPath: DRIVER_PATH,
      index: 0,
      kernelStartTimeoutMs: 5_000,
    })).rejects.toThrow(ScienceRuntimeError)
    // Retry at the SAME index (the same response-FIFO path) with a valid
    // prefix: `mkfifo` must not fail with "File exists" against a FIFO the
    // failed attempt above left behind.
    const kernel = await startKernel(harness, 'python', { index: 0 })
    expect(kernel).toBeInstanceOf(KernelProcess)
    await kernel.end('test-teardown')
  })

  it('routes two sequential executes to their matching DONE frames', async () => {
    const harness = await createHarness('kernel-two-runs')
    const kernel = await startKernel(harness, 'python')
    const first = await kernel.execute(await prepareRun(harness.root, 'run-1', { status: 'ok', detail: '' }))
    expect(first).toEqual({ runId: ScienceRunId('run-1'), status: 'ok', detail: '', captureDegraded: false })
    const second = await kernel.execute(await prepareRun(harness.root, 'run-2', { status: 'error', detail: 'Boom' }))
    expect(second).toEqual({ runId: ScienceRunId('run-2'), status: 'error', detail: 'Boom', captureDegraded: false })
    await kernel.end('test-teardown')
  })

  it('parses the capture-degraded flag and ignores unknown flag tokens', async () => {
    const harness = await createHarness('kernel-flags')
    const kernel = await startKernel(harness, 'python')
    const degraded = await kernel.execute(await prepareRun(harness.root, 'run-degraded', { status: 'ok', flags: 'capture-degraded' }))
    expect(degraded.captureDegraded).toBe(true)
    const unknown = await kernel.execute(await prepareRun(harness.root, 'run-unknown-flag', { status: 'ok', flags: 'some-future-flag' }))
    expect(unknown.captureDegraded).toBe(false)
    const both = await kernel.execute(await prepareRun(harness.root, 'run-both-flags', { status: 'ok', flags: 'some-future-flag,capture-degraded' }))
    expect(both.captureDegraded).toBe(true)
    await kernel.end('test-teardown')
  })

  it('throws when a second execute is issued while one is still pending', async () => {
    const harness = await createHarness('kernel-concurrent-execute')
    const kernel = await startKernel(harness, 'python')
    const pending = kernel.execute(await prepareRun(harness.root, 'run-pending', {
      action: 'sleep', sleepMs: 5_000, trapSigint: true,
    }))
    expect(() => {
      void kernel.execute({
        runId: ScienceRunId('run-second'), sourcePath: '/nowhere', cwd: '/nowhere',
        stdoutPath: '/nowhere/out', stderrPath: '/nowhere/err', artifactDir: '/nowhere/artifacts',
      })
    }).toThrow(/still pending/)
    // Let the driver finish parsing RUN and register its SIGINT trap before
    // signalling, or the signal can arrive while Node's default (terminating)
    // SIGINT disposition is still in effect.
    await new Promise(resolve => setTimeout(resolve, 300))
    kernel.interrupt()
    await expect(pending).resolves.toMatchObject({ status: 'interrupted' })
    await kernel.end('test-teardown')
  })

  it('treats an unparseable frame as fatal and settles exited with cause protocol', async () => {
    const harness = await createHarness('kernel-garbage')
    const kernel = await startKernel(harness, 'python')
    await expect(kernel.execute(await prepareRun(harness.root, 'run-garbage', { action: 'garbage' })))
      .rejects.toThrow(KernelProtocolError)
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'protocol' })
  })

  it('treats an unexpected FIFO EOF while the kernel is still alive as fatal', async () => {
    const harness = await createHarness('kernel-fifo-eof')
    const kernel = await startKernel(harness, 'python')
    await expect(kernel.execute(await prepareRun(harness.root, 'run-close-fifo', { action: 'close-fifo' })))
      .rejects.toThrow(KernelProtocolError)
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'protocol' })
  }, 10_000)

  it('fails an in-flight execute distinctly when the kernel exits uncommanded', async () => {
    const harness = await createHarness('kernel-crash')
    const kernel = await startKernel(harness, 'python')
    await expect(kernel.execute(await prepareRun(harness.root, 'run-crash', { action: 'crash' })))
      .rejects.toThrow(KernelExitedError)
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'crash', exitCode: 1 })
  })

  it('interrupt() delivers SIGINT and the driver replies DONE interrupted', async () => {
    const harness = await createHarness('kernel-interrupt-trapped')
    const kernel = await startKernel(harness, 'python')
    const pending = kernel.execute(await prepareRun(harness.root, 'run-interrupt', {
      action: 'sleep', sleepMs: 10_000, trapSigint: true,
    }))
    await new Promise(resolve => setTimeout(resolve, 300))
    kernel.interrupt()
    await expect(pending).resolves.toMatchObject({ status: 'interrupted', detail: '' })
    await kernel.end('test-teardown')
  })

  it('end() escalation still quiesces when the driver ignores interrupt()', async () => {
    const harness = await createHarness('kernel-interrupt-ignored')
    const kernel = await startKernel(harness, 'python')
    const pending = kernel.execute(await prepareRun(harness.root, 'run-ignore-interrupt', {
      action: 'sleep', sleepMs: 60_000, trapSigint: false,
    }))
    // end()'s forced kill settles this rejection asynchronously, before the
    // `rejects` assertion below attaches; pre-attach a silencing handler so
    // it is never transiently unhandled.
    pending.catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 300))
    kernel.interrupt()
    await new Promise(resolve => setTimeout(resolve, 300))
    await kernel.end('run-escalation')
    await expect(pending).rejects.toThrow(KernelExitedError)
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'commanded' })
  }, 15_000)

  it('EXIT teardown removes the FIFO and settles exited with cause commanded', async () => {
    const harness = await createHarness('kernel-exit-teardown')
    const kernel = await startKernel(harness, 'python')
    const planned = planKernelScratch(harness.services.sessionScratch, 'python', 0)
    const fifoPath = join(planned.directory, 'resp.fifo')
    expect(existsSync(fifoPath)).toBe(true)
    await kernel.end('normal-teardown')
    expect(existsSync(fifoPath)).toBe(false)
    await expect(kernel.exited).resolves.toEqual({ cause: 'commanded', exitCode: 0, signal: null })
  })

  it('end() is idempotent: a second call awaits the same teardown', async () => {
    const harness = await createHarness('kernel-end-idempotent')
    const kernel = await startKernel(harness, 'python')
    await Promise.all([kernel.end('first'), kernel.end('second')])
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'commanded' })
  })

  it('works identically for the R language selection', async () => {
    const harness = await createHarness('kernel-r-language')
    const kernel = await startKernel(harness, 'r')
    const result = await kernel.execute(await prepareRun(harness.root, 'run-r', { status: 'ok', detail: '' }))
    expect(result).toEqual({ runId: ScienceRunId('run-r'), status: 'ok', detail: '', captureDegraded: false })
    await kernel.end('test-teardown')
  })
})
