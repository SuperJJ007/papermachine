/**
 * `KernelProcess` against a fake kernel-wire-protocol driver (`fixtures/fake-kernel-driver.mjs`),
 * driven through the real `dsh-subprocess-local` and `dsh-sandbox-local`
 * providers the way `loader-composition.spec.ts` composes them.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceInterpreterAvailableBinding, ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import {
  KernelExitedError,
  KernelProcess,
  KernelProtocolError,
} from '../src/kernel-process.ts'
import type { KernelExecuteRequest, KernelProcessServices } from '../src/kernel-process.ts'
import { createKernelScratch, ensureSessionScratch, planKernelScratch } from '../src/scratch.ts'
import type { ScienceSessionScratch } from '../src/scratch.ts'
import { ScienceRuntimeError } from '../src/types.ts'
import { TEST_KERNEL_START_TIMEOUT_MS, createFakeSandboxRunner } from './harness.ts'

// Every case here spawns a real kernel subprocess through
// LocalSubprocessRuntime; under full-suite concurrency, spawn and pipe I/O
// contend for the OS scheduler and the default 5s timeout is not enough.
vi.setConfig({ testTimeout: 30_000 })

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const DRIVER_PATH = join(FIXTURES, 'fake-kernel-driver.mjs')
const NO_READY_DRIVER_PATH = join(FIXTURES, 'fake-kernel-driver-no-ready.mjs')
const BAD_READY_DRIVER_PATH = join(FIXTURES, 'fake-kernel-driver-bad-ready.mjs')

/** Every real response-FIFO read stream this file's KernelProcess.start() calls have created, for a focused test to command directly. */
const capturedReadStreams: Readable[] = []

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    createReadStream: (...args: Parameters<typeof original.createReadStream>) => {
      const stream = original.createReadStream(...args)
      capturedReadStreams.push(stream)
      return stream
    },
  }
})

/**
 * Wraps the real local subprocess provider so the kernel's own confined spawn
 * (identified by `stdio.stdin === 'pipe'`, unique among this harness's spawns
 * to `KernelProcess`'s own spawn — `mkfifo` uses `stdin: 'ignore'`) reports a
 * faulted stdin instead of the real one: either entirely absent (`'missing'`,
 * covering the constructor's own defensive guard) or present but whose
 * `write` always throws the test's currently configured `writeError`
 * (`'throws'`, covering `execute()`'s own write-failure guard). Everything
 * else — including EXIT during teardown, which reads the same faulted stdin
 * and swallows its own failure — still runs against the real process.
 */
class KernelStdinFaultSubprocess extends LocalSubprocessRuntime {
  fault: 'missing' | 'throws' | undefined
  writeError: unknown

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    if (spec.stdio.stdin !== 'pipe' || this.fault === undefined) return handle
    if (this.fault === 'missing') return { ...handle, stdin: undefined }
    const fakeStdin = {
      write: (): void => {
        if (this.writeError !== undefined) throw this.writeError
      },
    } as unknown as Writable
    return { ...handle, stdin: fakeStdin }
  }
}

/**
 * Records the exact confined argv and child environment for the kernel's own
 * spawn (identified the same way as {@link KernelStdinFaultSubprocess}:
 * `stdio.stdin === 'pipe'`, unique to `KernelProcess`'s spawn among this
 * harness's spawns), without altering the real spawn.
 */
class CapturingSubprocess extends LocalSubprocessRuntime {
  captured: SubprocessSpawnSpec | undefined

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (spec.stdio.stdin === 'pipe') this.captured = spec
    return super.spawn(spec)
  }
}

/**
 * Overrides the mkfifo spawn's own settled outcome to a nonzero exit with no
 * collected stderr stream, reaching createResponseFifo's defensive `?? ''` fallback.
 */
class NoStderrMkfifoSubprocess extends LocalSubprocessRuntime {
  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    if (!spec.argv[0]?.endsWith('mkfifo')) return handle
    return { ...handle, done: handle.done.then(() => ({ exitCode: 1, signal: null })), collected: {} }
  }
}

/**
 * Makes the kernel's own confined spawn's `done` promise reject once the
 * real process actually exits, reaching the constructor's rejection handler.
 */
class RejectedDoneSubprocess extends LocalSubprocessRuntime {
  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    if (spec.stdio.stdin !== 'pipe') return handle
    return { ...handle, done: handle.done.then(() => { throw new Error('kernel-process.spec.ts: injected done rejection') }) }
  }
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  capturedReadStreams.length = 0
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
async function createHarness(
  id: string,
  options: {
    /** Temp-dir prefix; a space in it reaches the R-kernel TMPDIR-space guard. */
    readonly rootPrefix?: string
    /** Subprocess plugin class; a fault-injecting subclass reaches KernelProcess's own defensive guards. */
    readonly subprocess?: typeof LocalSubprocessRuntime
  } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(process.cwd(), options.rootPrefix ?? '.science-runtime-kernel-process-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(options.subprocess ?? LocalSubprocessRuntime)
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
    kernelStartTimeoutMs: overrides.kernelStartTimeoutMs ?? TEST_KERNEL_START_TIMEOUT_MS,
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
    inputDir: join(dir, 'inputs'),
  }
}

describe('KernelProcess', () => {
  it('completes the READY handshake', async () => {
    const harness = await createHarness('kernel-handshake')
    const kernel = await startKernel(harness, 'python')
    expect(kernel).toBeInstanceOf(KernelProcess)
    await kernel.end('test-teardown')
  })

  it('spawns a Python kernel without isolated mode and with a kernel-scoped PYTHONUSERBASE', async () => {
    const harness = await createHarness('kernel-python-userbase', { subprocess: CapturingSubprocess })
    const kernel = await startKernel(harness, 'python', { index: 3 })
    const capturing = harness.services.subprocess as CapturingSubprocess
    const spec = capturing.captured
    if (spec === undefined) throw new Error('kernel spawn was never captured')
    expect(spec.argv).not.toContain('-I')
    expect(spec.argv).toEqual(expect.arrayContaining(['-B', '-u', '-X', 'utf8']))
    const kernelDirectory = join(harness.services.sessionScratch.kernels, 'python-3')
    const expectedUserBase = join(kernelDirectory, 'pyuser')
    expect(spec.env?.PYTHONUSERBASE).toBe(expectedUserBase)
    expect(spec.env?.R_LIBS_USER).toBeUndefined()
    expect(existsSync(expectedUserBase)).toBe(true)
    await kernel.end('test-teardown')
  })

  it('spawns an R kernel with a kernel-scoped R_LIBS_USER and no PYTHONUSERBASE', async () => {
    const harness = await createHarness('kernel-r-libs-user', { subprocess: CapturingSubprocess })
    const kernel = await startKernel(harness, 'r', { index: 2 })
    const capturing = harness.services.subprocess as CapturingSubprocess
    const spec = capturing.captured
    if (spec === undefined) throw new Error('kernel spawn was never captured')
    const kernelDirectory = join(harness.services.sessionScratch.kernels, 'r-2')
    const expectedLibsUser = join(kernelDirectory, 'rlibs')
    expect(spec.env?.R_LIBS_USER).toBe(expectedLibsUser)
    expect(spec.env?.PYTHONUSERBASE).toBeUndefined()
    expect(existsSync(expectedLibsUser)).toBe(true)
    await kernel.end('test-teardown')
  })

  it('rejects with KernelProtocolError when READY does not arrive within the deadline', async () => {
    const harness = await createHarness('kernel-ready-timeout')
    await expect(startKernel(harness, 'python', { driverPath: NO_READY_DRIVER_PATH, kernelStartTimeoutMs: 200 }))
      .rejects.toThrow(KernelProtocolError)
  })

  it('a run of READY-timeout failures (no-ready driver) leaks no libuv threadpool worker', async () => {
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

  it('a confine failure before spawn releases the FIFO so a same-index retry does not hit mkfifo: File exists', async () => {
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
      kernelStartTimeoutMs: TEST_KERNEL_START_TIMEOUT_MS,
    })).rejects.toThrow(ScienceRuntimeError)
    // Retry at the SAME index (the same response-FIFO path) with a valid
    // prefix: `mkfifo` must not fail with "File exists" against a FIFO the
    // failed attempt above left behind.
    const kernel = await startKernel(harness, 'python', { index: 0 })
    expect(kernel).toBeInstanceOf(KernelProcess)
    await kernel.end('test-teardown')
  })

  it('propagates a real mkfifo failure for the kernel response FIFO', async () => {
    const harness = await createHarness('kernel-mkfifo-failure')
    const planned = planKernelScratch(harness.services.sessionScratch, 'python', 0)
    // createKernelScratch is idempotent for an already-existing directory
    // (scratch.ts's createPrivateDirectory only verifies, never re-chmods,
    // an EEXIST hit), so pre-creating it here and chmodding it read-only
    // afterward still lets KernelProcess.start's own createKernelScratch
    // call succeed — only the later mkfifo spawn, which needs write access
    // to create a new directory entry, fails.
    await createKernelScratch(harness.services.sessionScratch, planned)
    chmodSync(planned.directory, 0o500)
    try {
      await expect(startKernel(harness, 'python', { index: 0 })).rejects.toThrow(/mkfifo failed/)
    } finally {
      chmodSync(planned.directory, 0o700)
    }
  })

  it('falls back to empty stderr text when mkfifo fails without a collected stderr stream', async () => {
    const harness = await createHarness('kernel-mkfifo-no-stderr', { subprocess: NoStderrMkfifoSubprocess })
    await expect(startKernel(harness, 'python')).rejects.toThrow(/mkfifo failed.*exitCode=1/)
  })

  it('settles exited with a null exitCode/signal when the subprocess seam\'s own done promise rejects', async () => {
    const harness = await createHarness('kernel-done-rejects', { subprocess: RejectedDoneSubprocess })
    const kernel = await startKernel(harness, 'python')
    await kernel.end('test-teardown')
    await expect(kernel.exited).resolves.toEqual({ exitCode: null, signal: null, cause: 'commanded' })
  })

  it('propagates a non-ENOENT unlink failure when end() cannot remove the response FIFO', async () => {
    const harness = await createHarness('kernel-unlink-failure')
    const kernel = await startKernel(harness, 'python')
    const planned = planKernelScratch(harness.services.sessionScratch, 'python', 0)
    // Removing a directory entry needs write access on its PARENT, not the
    // entry's own permissions — chmodding the kernel directory after READY
    // (the FIFO already exists and is already open) fails only the later
    // unlink end() performs during teardown.
    chmodSync(planned.directory, 0o500)
    try {
      await expect(kernel.end('test-teardown')).rejects.toThrow()
    } finally {
      chmodSync(planned.directory, 0o700)
    }
  })

  it('fails loud when the subprocess seam spawns without the requested stdin pipe', async () => {
    const harness = await createHarness('kernel-no-stdin', { subprocess: KernelStdinFaultSubprocess })
    const subprocess = harness.services.subprocess as KernelStdinFaultSubprocess
    subprocess.fault = 'missing'
    await expect(startKernel(harness, 'python')).rejects.toThrow(/stdin pipe/)
  }, 15_000)

  it('rejects one execute synchronously when the stdin write itself throws, preserving a real Error and wrapping a non-Error alike', async () => {
    const harness = await createHarness('kernel-stdin-write-failure', { subprocess: KernelStdinFaultSubprocess })
    const subprocess = harness.services.subprocess as KernelStdinFaultSubprocess
    subprocess.fault = 'throws'
    const kernel = await startKernel(harness, 'python')
    const writeError = new Error('injected stdin write failure')
    subprocess.writeError = writeError
    await expect(kernel.execute(await prepareRun(harness.root, 'run-write-error', { status: 'ok' })))
      .rejects.toBe(writeError)
    // The test scripts a provider whose write() throws a non-Error value.
    subprocess.writeError = 'injected non-error stdin write failure'
    await expect(kernel.execute(await prepareRun(harness.root, 'run-write-error-2', { status: 'ok' })))
      .rejects.toThrow('injected non-error stdin write failure')
    subprocess.writeError = undefined
    await kernel.end('test-teardown')
  }, 15_000)

  it('rejects an R kernel whose scratch TMPDIR would contain an ASCII space', async () => {
    const harness = await createHarness('kernel-r-space', { rootPrefix: '.science runtime-kernel-r-space-' })
    await expect(startKernel(harness, 'r')).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
  })

  it('treats a malformed line before READY as a fatal handshake failure', async () => {
    const harness = await createHarness('kernel-bad-ready')
    await expect(startKernel(harness, 'python', { driverPath: BAD_READY_DRIVER_PATH }))
      .rejects.toThrow(KernelProtocolError)
  })

  it('classifies a response-FIFO stream error by whether it carries a real Error, both ways from the same kernel', async () => {
    const harness = await createHarness('kernel-fifo-stream-error')
    const kernel = await startKernel(harness, 'python')
    const stream = capturedReadStreams.at(-1)
    if (stream === undefined) throw new Error('no response-FIFO read stream was captured')
    // Synchronous, back-to-back: exitSettled cannot yet be true for either
    // call (that requires the real process's own async exit to settle), so
    // both reach onFifoError's classification regardless of which one
    // failProtocol's own already-faulted guard later discards.
    stream.emit('error', new Error('injected real FIFO stream error'))
    stream.emit('error', 'injected non-Error FIFO stream failure')
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'protocol' })
  })

  it('ignores a response-FIFO stream error that arrives after the kernel already exited', async () => {
    const harness = await createHarness('kernel-fifo-error-after-exit')
    const kernel = await startKernel(harness, 'python')
    const stream = capturedReadStreams.at(-1)
    if (stream === undefined) throw new Error('no response-FIFO read stream was captured')
    await kernel.end('test-teardown')
    expect(() => { stream.emit('error', new Error('late FIFO error')) }).not.toThrow()
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'commanded' })
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

  it('forwards the RUN frame\'s own reserved inputDir distinctly from cwd and artifactDir', async () => {
    const harness = await createHarness('kernel-input-dir')
    const kernel = await startKernel(harness, 'python')
    const request = await prepareRun(harness.root, 'run-echo-request', { action: 'echo-request' })
    const result = await kernel.execute(request)
    expect(result.detail).toBe(`${request.cwd}|${request.artifactDir}|${request.inputDir}`)
    expect(request.inputDir).not.toBe(request.artifactDir)
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
        inputDir: '/nowhere/inputs',
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

  it('rejects a request field carrying a frame delimiter before writing anything', async () => {
    const harness = await createHarness('kernel-frame-delimiter')
    const kernel = await startKernel(harness, 'python')
    expect(() => {
      void kernel.execute({
        runId: ScienceRunId('run-delimiter'), sourcePath: '/run/action.json', cwd: '/run',
        stdoutPath: '/run/stdout.txt', stderrPath: 'bad\tpath', artifactDir: '/run/artifacts',
        inputDir: '/run/inputs',
      })
    }).toThrow(/must not contain a tab or newline/)
    // The rejected request never reached the driver: a normal run still works.
    await expect(kernel.execute(await prepareRun(harness.root, 'run-after-delimiter', { status: 'ok' })))
      .resolves.toMatchObject({ status: 'ok' })
    await kernel.end('test-teardown')
  })

  it('treats an unparseable frame as fatal, ignores a second one already-faulted, and rejects a later execute with the same fault', async () => {
    const harness = await createHarness('kernel-garbage')
    const kernel = await startKernel(harness, 'python')
    // double-garbage sends TWO unparseable lines for one RUN: the first sets
    // protocolFault (rejecting this execute); the second's onFrameLine call
    // must hit the already-faulted early return rather than double-fault.
    await expect(kernel.execute(await prepareRun(harness.root, 'run-garbage', { action: 'double-garbage' })))
      .rejects.toThrow(KernelProtocolError)
    await expect(kernel.exited).resolves.toMatchObject({ cause: 'protocol' })
    await expect(kernel.execute(await prepareRun(harness.root, 'run-after-garbage', { status: 'ok' })))
      .rejects.toThrow(KernelProtocolError)
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

  it('EXIT teardown removes the FIFO, settles exited with cause commanded, and rejects a later execute as already exited', async () => {
    const harness = await createHarness('kernel-exit-teardown')
    const kernel = await startKernel(harness, 'python')
    const planned = planKernelScratch(harness.services.sessionScratch, 'python', 0)
    const fifoPath = join(planned.directory, 'resp.fifo')
    expect(existsSync(fifoPath)).toBe(true)
    await kernel.end('normal-teardown')
    expect(existsSync(fifoPath)).toBe(false)
    await expect(kernel.exited).resolves.toEqual({ cause: 'commanded', exitCode: 0, signal: null })
    await expect(kernel.execute(await prepareRun(harness.root, 'run-after-exit', { status: 'ok' })))
      .rejects.toThrow(KernelExitedError)
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
