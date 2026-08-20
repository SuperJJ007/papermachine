/**
 * One confined persistent Science kernel subprocess speaking the kernel wire
 * protocol (`stdin` RUN/EXIT request frames, response-FIFO READY/DONE frames): spawn
 * sequence, execute-serialization, cooperative interrupt passthrough, and
 * teardown. Session-scoped lifecycle is out of scope here: this module knows
 * nothing about session events, kernel epochs, idle timers, or durable end
 * reasons beyond the generic diagnostic string `end()` accepts.
 * @module @deepseek-ai/dsh-science-runtime/kernel-process
 */

import { constants as fsConstants, createReadStream } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ScienceInterpreterAvailableBinding, ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import {
  confineInterpreterArgv,
  DESCENDANT_GRACE_MS,
  interpreterArgv,
  interpreterPathEnv,
  localeEnvironment,
  MAX_OUTPUT_BYTES,
  quiesce,
} from './execution.ts'
import type { Quiescence } from './execution.ts'
import { createKernelScratch, planKernelScratch } from './scratch.ts'
import type { ScienceSessionScratch } from './scratch.ts'
import { ScienceRuntimeError } from './types.ts'

/**
 * Fatal kernel-driver protocol violation: an unparseable frame, an
 * unexpected response-FIFO EOF while the kernel process was still alive, or
 * a READY handshake timeout.
 */
export class KernelProtocolError extends Error {
  override name = 'KernelProtocolError'
}

/** The kernel process exited before a request in flight ever received its matching DONE frame. */
export class KernelExitedError extends Error {
  override name = 'KernelExitedError'
}

/** Services `KernelProcess` needs to spawn and confine one kernel. */
export interface KernelProcessServices {
  readonly subprocess: SubprocessRuntime
  readonly sandbox: SandboxProvider
  readonly session: Session
  readonly sessionScratch: ScienceSessionScratch
}

/** Construction inputs for one confined persistent kernel process. */
export interface KernelProcessOptions {
  /** Shared subprocess, sandbox, exact Session, and private scratch services. */
  readonly services: KernelProcessServices
  /** The requested language's available binding, selecting the interpreter executable and prefix. */
  readonly binding: ScienceInterpreterAvailableBinding
  /** Absolute on-disk path of the shipped driver script for `binding.language` (see `kernel-assets.ts`). */
  readonly driverPath: string
  /** Caller-assigned disambiguator for this language's kernel instance under the Session's `kernels/` scratch tree. */
  readonly index: number
  /** Spawn-to-READY deadline in milliseconds. */
  readonly kernelStartTimeoutMs: number
  /**
   * Caller's own operation cancellation, fused with `kernelStartTimeoutMs`
   * to bound only the READY wait: without it, the caller's
   * `timeoutMs`/`cancel()` bounds the RUN/DONE exchange but not spawn,
   * which could otherwise outlive the whole operation by up to
   * `kernelStartTimeoutMs`. Never wired into the spawned process itself —
   * this kernel is meant to outlive the one run whose operation this signal
   * scopes, so it must stop mattering once READY arrives, not stay
   * live for the process's whole lifetime. Absent only for a caller with no
   * operation-scoped signal of its own.
   */
  readonly signal?: AbortSignal | undefined
}

/** One RUN request: exact host-minted paths, never shell-interpreted or escaped. */
export interface KernelExecuteRequest {
  /** Run identity echoed back unchanged on the matching DONE frame. */
  readonly runId: ScienceRunId
  /** Exact source file path already flushed into the run's private scratch directory. */
  readonly sourcePath: string
  /** Working directory the driver `chdir`s into for the run. */
  readonly cwd: string
  /** Per-run stdout capture file path. */
  readonly stdoutPath: string
  /** Per-run stderr capture file path. */
  readonly stderrPath: string
  /** Per-run artifact directory the driver publishes as `SCIENCE_ARTIFACT_DIR`. */
  readonly artifactDir: string
}

/** Terminal run status the kernel wire protocol carries on a DONE frame. */
export type KernelDoneStatus = 'ok' | 'error' | 'interrupted'

/** Parsed DONE frame for one completed RUN. */
export interface KernelDoneFrame {
  /** Run identity from the matching RUN request. */
  readonly runId: ScienceRunId
  /** Terminal status the DONE frame carried. */
  readonly status: KernelDoneStatus
  /** Exception/condition class name on `error`; empty otherwise. */
  readonly detail: string
  /** Whether the wire protocol's `capture-degraded` flag token was present; other tokens are ignored (forward-tolerant). */
  readonly captureDegraded: boolean
}

/** How this kernel process's own subprocess lifetime ended. */
export type KernelExitCause =
  /** `end()` sent EXIT (or attempted to) and awaited quiesce. */
  | 'commanded'
  /** This `KernelProcess` detected a protocol violation and force-terminated the process itself. */
  | 'protocol'
  /** The process exited on its own, with no `end()` in progress and no detected protocol violation. */
  | 'crash'

/** Terminal fact for one kernel process's own subprocess lifetime. */
export interface KernelExitFact {
  /** Exit code; null when the process died from a signal. */
  readonly exitCode: number | null
  /** Terminating signal; null on normal exit. */
  readonly signal: NodeJS.Signals | null
  /** Classification the owner uses to pick a durable end reason. */
  readonly cause: KernelExitCause
}

interface PendingExecute {
  readonly runId: ScienceRunId
  readonly resolve: (frame: KernelDoneFrame) => void
  readonly reject: (error: Error) => void
}

/** Reject a host-minted field that must never carry frame delimiters. */
function assertNoFrameDelimiters(value: string, label: string): void {
  if (value.includes('\t') || value.includes('\n')) {
    throw new Error(`science-runtime: kernel ${label} must not contain a tab or newline`)
  }
}

/** Whether an unknown error carries the POSIX `ENOENT` code. */
function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { readonly code?: unknown }).code === 'ENOENT'
}

/** Remove the response FIFO, tolerating an already-absent path. */
async function unlinkFifo(fifoPath: string): Promise<void> {
  try {
    await unlink(fifoPath)
  } catch (error) {
    if (!isEnoent(error)) throw error
  }
}

/**
 * Force-complete a response FIFO's blocking read-side `open()` when it may
 * still be stuck in the libuv threadpool because no writer ever connected —
 * a confine/spawn failure, or a driver that never reached its own
 * open-for-write before the READY deadline. Opening the write
 * end non-blockingly rendezvous with a still-pending blocking read-open and
 * lets it return; closing that transient writer immediately afterward
 * leaves no writer behind. Best-effort and always safe to call: when the
 * read side already opened successfully this is a harmless no-op class
 * (POSIX tolerates a second writer opening and closing), and every failure
 * here (the path already gone, `ENXIO` from a benign ordering race) is
 * swallowed because the caller's own destroy/unlink cleanup is what
 * actually matters.
 * @param fifoPath - absolute path of the response FIFO.
 */
async function releaseBlockedFifoOpen(fifoPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(fifoPath, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK)
  } catch {
    return
  }
  try {
    await handle.close()
  } catch {
    // A transient unblocking writer's own close is best-effort.
  }
}

/**
 * Full teardown for a kernel that failed anywhere between response-FIFO
 * creation and a successful READY handshake: quiesce the
 * subprocess when one was spawned, destroy the host's read stream, release
 * a still-blocked read-side open so its libuv threadpool worker is freed,
 * then remove the FIFO file.
 * @param handle - the spawned subprocess handle, or `undefined` when spawn itself never ran.
 * @param fifoPath - absolute path of the response FIFO.
 * @param readStream - the host's response-FIFO read stream.
 */
async function cleanupOnStartFailure(
  handle: SubprocessHandle | undefined,
  fifoPath: string,
  readStream: Readable,
): Promise<void> {
  readStream.destroy()
  await releaseBlockedFifoOpen(fifoPath)
  if (handle !== undefined) await quiesce(handle)
  await unlinkFifo(fifoPath)
}

/**
 * Create the kernel's response FIFO host-side, unconfined: spawns the
 * platform `mkfifo` binary directly through the subprocess seam, never
 * through the sandbox — the FIFO must exist before the confined
 * kernel argv is spawned. Removes a stale FIFO left at the same path by an
 * earlier failed attempt first: `mkfifo` refuses an existing
 * path, and a retry after a start failure reuses the same kernel-epoch
 * scratch directory.
 * @param subprocess - subprocess runtime used unconfined for this one call.
 * @param cwd - existing directory to spawn `mkfifo` from (irrelevant beyond existing, since `fifoPath` is absolute).
 * @param fifoPath - absolute path at which to create the FIFO.
 * @throws when the FIFO path carries a frame delimiter, `mkfifo` cannot be resolved, or it exits non-zero.
 */
async function createResponseFifo(subprocess: SubprocessRuntime, cwd: string, fifoPath: string): Promise<void> {
  assertNoFrameDelimiters(fifoPath, 'response FIFO path')
  await unlinkFifo(fifoPath)
  const mkfifo = await subprocess.resolveExecutable('mkfifo')
  const handle = subprocess.spawn({
    argv: [mkfifo, fifoPath],
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
    graceMs: DESCENDANT_GRACE_MS,
    environmentBase: 'empty',
  })
  const outcome = await handle.done
  if (outcome.exitCode !== 0 || outcome.signal !== null) {
    const stderrText = handle.collected.stderr?.readFrom(0).text ?? ''
    throw new Error(
      'science-runtime: mkfifo failed for the kernel response FIFO '
      + `(exitCode=${String(outcome.exitCode)}, signal=${String(outcome.signal)}): ${stderrText}`,
    )
  }
}

/**
 * Exact empty-base child environment for a persistent kernel's baseline
 * spawn (per-run TMPDIR/SCIENCE_ARTIFACT_DIR are the driver's own job).
 */
function kernelEnvironment(
  binding: ScienceInterpreterAvailableBinding,
  sessionScratch: ScienceSessionScratch,
  tmp: string,
): NodeJS.ProcessEnv {
  return {
    HOME: sessionScratch.home,
    TMPDIR: tmp,
    PATH: interpreterPathEnv(binding.canonicalPrefix),
    SCIENCE_STATE_DIR: sessionScratch.state,
    ...localeEnvironment(),
  }
}

/** True kernel wire-protocol status literal. */
function isDoneStatus(value: string): value is KernelDoneStatus {
  return value === 'ok' || value === 'error' || value === 'interrupted'
}

/**
 * One confined, long-lived kernel subprocess. Executions are strictly
 * serialized: a second concurrent {@link execute} while one is outstanding is
 * a programming error. Construct only through {@link KernelProcess.start}; an
 * instance is unusable until the driver's READY handshake completes.
 */
export class KernelProcess {
  /** Resolves once, when this process's own subprocess lifetime ends, however it ends. */
  readonly exited: Promise<KernelExitFact>

  private readonly resolveExited: (fact: KernelExitFact) => void
  private readonly stdin: Writable
  private readonly readyWaiter: ReturnType<typeof Promise.withResolvers<void>>
  private phase: 'starting' | 'ready' = 'starting'
  private pending: PendingExecute | undefined
  private protocolFault: KernelProtocolError | undefined
  private commandedReason: string | undefined
  private exitSettled = false
  private endPromise: Promise<Quiescence> | undefined
  private lineBuffer = ''

  private constructor(
    private readonly handle: SubprocessHandle,
    private readonly fifoPath: string,
    private readonly readStream: Readable,
  ) {
    const stdin = handle.stdin
    if (stdin === undefined) throw new Error('science-runtime: kernel process was not spawned with a stdin pipe')
    this.stdin = stdin

    const exitResolvers = Promise.withResolvers<KernelExitFact>()
    this.exited = exitResolvers.promise
    this.resolveExited = exitResolvers.resolve
    this.readyWaiter = Promise.withResolvers<void>()

    readStream.on('data', (chunk: string) => { this.onFifoData(chunk) })
    readStream.on('end', () => { void this.onFifoEnd() })
    readStream.on('error', (error: unknown) => { this.onFifoError(error) })
    handle.done.then(
      (outcome) => { this.settleExit(outcome.exitCode, outcome.signal) },
      () => { this.settleExit(null, null) },
    )
  }

  /**
   * Spawn one confined kernel and await its READY handshake.
   * @param options - services, binding, driver path, kernel index, start
   *   deadline, and the caller's own operation signal.
   * @returns a ready-to-use kernel process.
   * @throws {@link KernelProtocolError} on a READY timeout, `options.signal`
   *   aborting before READY, an unparseable frame before READY, or a
   *   process exit/rejection before READY.
   * @throws {@link ScienceRuntimeError} (`CONFINEMENT_UNAVAILABLE`) when the
   *   sandbox is unavailable, reports less than full enforcement, or the R
   *   kernel's TMPDIR would contain a space.
   */
  static async start(options: KernelProcessOptions): Promise<KernelProcess> {
    const { services, binding, driverPath, index, kernelStartTimeoutMs, signal } = options
    const kernelScratch = await createKernelScratch(
      services.sessionScratch,
      planKernelScratch(services.sessionScratch, binding.language, index),
    )
    if (binding.language === 'r' && kernelScratch.tmp.includes(' ')) {
      throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'R kernel TMPDIR cannot contain an ASCII space')
    }
    const fifoPath = join(kernelScratch.directory, 'resp.fifo')
    await createResponseFifo(services.subprocess, kernelScratch.directory, fifoPath)
    // Open the read side before spawning the kernel: the safer FIFO-ordering
    // default — no window where the kernel's own
    // open-for-write races an as-yet-nonexistent reader.
    const readStream = createReadStream(fifoPath, { encoding: 'utf8' })
    // Everything from here through a successful READY handshake shares one
    // failure path: a confine/spawn throw, or an awaitReady
    // rejection, must release the FIFO's read-side open and remove the FIFO
    // file the same way, whether or not a subprocess was ever spawned.
    let handle: SubprocessHandle | undefined
    try {
      const confined = confineInterpreterArgv(
        services.session,
        services.sessionScratch,
        services.sandbox,
        binding.canonicalPrefix,
        interpreterArgv(binding.language, binding.executable, driverPath, fifoPath),
      )
      // NOT given `signal`: that spec field stays wired to the spawned
      // handle for the process's whole lifetime (subprocess-local's own
      // spawn keeps its abort listener attached until exit), but this
      // kernel outlives the one run whose operation `signal` this is —
      // wiring it here would let any later run's own cancellation
      // force-kill an already-READY, unrelated persistent kernel. `signal`
      // only bounds the READY wait below; an abort during that wait is
      // handled entirely through `cleanupOnStartFailure`'s own `quiesce()`.
      handle = services.subprocess.spawn({
        argv: confined.argv,
        cwd: kernelScratch.directory,
        stdio: {
          stdin: 'pipe',
          stdout: { maxBytes: MAX_OUTPUT_BYTES },
          stderr: { maxBytes: MAX_OUTPUT_BYTES },
        },
        graceMs: DESCENDANT_GRACE_MS,
        environmentBase: 'empty',
        env: kernelEnvironment(binding, services.sessionScratch, kernelScratch.tmp),
      })
      const kernel = new KernelProcess(handle, fifoPath, readStream)
      await kernel.awaitReady(kernelStartTimeoutMs, signal)
      return kernel
    } catch (error) {
      await cleanupOnStartFailure(handle, fifoPath, readStream)
      throw error
    }
  }

  /**
   * Write one RUN frame and await its matching DONE frame.
   * @param request - exact host-minted run identity and paths.
   * @returns the parsed DONE frame.
   * @throws when a previous {@link execute} on this instance is still pending (programming error).
   */
  execute(request: KernelExecuteRequest): Promise<KernelDoneFrame> {
    if (this.pending !== undefined) {
      throw new Error('science-runtime: KernelProcess.execute called while a previous execute is still pending')
    }
    if (this.protocolFault !== undefined) return Promise.reject(this.protocolFault)
    if (this.exitSettled) return Promise.reject(new KernelExitedError('science-runtime: kernel process has already exited'))
    assertNoFrameDelimiters(request.runId, 'RUN runId')
    assertNoFrameDelimiters(request.sourcePath, 'RUN sourcePath')
    assertNoFrameDelimiters(request.cwd, 'RUN cwd')
    assertNoFrameDelimiters(request.stdoutPath, 'RUN stdoutPath')
    assertNoFrameDelimiters(request.stderrPath, 'RUN stderrPath')
    assertNoFrameDelimiters(request.artifactDir, 'RUN artifactDir')
    const frame = [
      'RUN', request.runId, request.sourcePath, request.cwd, request.stdoutPath, request.stderrPath, request.artifactDir,
    ].join('\t')
    const resolvers = Promise.withResolvers<KernelDoneFrame>()
    this.pending = { runId: request.runId, resolve: resolvers.resolve, reject: resolvers.reject }
    try {
      this.stdin.write(`${frame}\n`)
    } catch (error) {
      this.pending = undefined
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return resolvers.promise
  }

  /** Deliver a cooperative SIGINT request to the kernel process; a pure {@link SubprocessHandle.interrupt} passthrough. */
  interrupt(): void {
    this.handle.interrupt()
  }

  /**
   * Best-effort EXIT frame, then the seam's quiesce escalation, then FIFO
   * stream/file cleanup. Idempotent: a second call awaits the same teardown.
   * Returns the escalation's {@link Quiescence} verdict rather than
   * discarding it: a caller responsible for same-id
   * quarantine bookkeeping (`KernelSet.teardown`) must keep quarantine
   * active until a `{ quiescent: false }` result's `eventualQuiescence`
   * resolves — this method itself does not wait beyond the seam's own
   * bounded escalation.
   * @param reason - caller-owned diagnostic label; not durably interpreted here.
   * @returns the quiescence verdict once the seam's bounded escalation settles.
   */
  end(reason: string): Promise<Quiescence> {
    this.endPromise ??= this.performEnd(reason)
    return this.endPromise
  }

  private async performEnd(reason: string): Promise<Quiescence> {
    this.commandedReason = reason
    try {
      this.stdin.write('EXIT\n')
    } catch {
      // Best-effort: a closed or broken stdin means the kernel is already gone.
    }
    const quiescence = await quiesce(this.handle)
    this.readStream.destroy()
    await unlinkFifo(this.fifoPath)
    return quiescence
  }

  private awaitReady(timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
    // NOT `using`: this function returns before the deadline's own timer
    // fires or clears, so disposal must be tied to the returned promise
    // settling (below), not to this synchronous function body returning.
    // Fusing `signal` means an abort here can be the
    // caller's own cancellation, not only the READY deadline; `onTimeout`
    // fires either way since both cases mean READY is not coming.
    const bound = deadline(signal, timeoutMs, 'KERNEL_START_TIMEOUT')
    const onTimeout = (): void => {
      this.failProtocol(new KernelProtocolError(`science-runtime: kernel did not send READY within ${String(timeoutMs)}ms`))
    }
    bound.signal.addEventListener('abort', onTimeout, { once: true })
    // A process death before any line was parsed never reaches failProtocol
    // through onFrameLine, so also fail the handshake when exit settles first.
    void this.exited.then((fact) => {
      if (this.phase === 'starting') {
        this.failProtocol(new KernelProtocolError(
          `science-runtime: kernel process exited before sending READY (exitCode=${String(fact.exitCode)}, signal=${String(fact.signal)})`,
        ))
      }
    })
    return this.readyWaiter.promise.finally(() => {
      bound.signal.removeEventListener('abort', onTimeout)
      bound[Symbol.dispose]()
    })
  }

  private onFifoData(chunk: string): void {
    this.lineBuffer += chunk
    let newline: number
    while ((newline = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newline)
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      this.onFrameLine(line)
    }
  }

  private onFrameLine(line: string): void {
    if (this.exitSettled || this.protocolFault !== undefined) return
    if (this.phase === 'starting') {
      this.handleReadyLine(line)
      return
    }
    this.handleRunLine(line)
  }

  private handleReadyLine(line: string): void {
    const fields = line.split('\t')
    const [tag, protocolVersion, pid, extra] = fields
    if (tag !== 'READY' || protocolVersion !== '1' || pid === undefined || extra !== undefined) {
      this.failProtocol(new KernelProtocolError(`science-runtime: kernel sent an unexpected line before READY: ${JSON.stringify(line)}`))
      return
    }
    this.phase = 'ready'
    this.readyWaiter.resolve()
  }

  private handleRunLine(line: string): void {
    const fields = line.split('\t')
    const [tag, runId, status, detail, flags, extra] = fields
    const pending = this.pending
    if (
      tag !== 'DONE' || runId === undefined || status === undefined || detail === undefined || flags === undefined
      || extra !== undefined || !isDoneStatus(status) || pending === undefined || runId !== pending.runId
    ) {
      this.failProtocol(new KernelProtocolError(`science-runtime: kernel sent an unexpected frame: ${JSON.stringify(line)}`))
      return
    }
    this.pending = undefined
    pending.resolve({
      runId: pending.runId,
      status,
      detail,
      captureDegraded: flags.split(',').includes('capture-degraded'),
    })
  }

  private async onFifoEnd(): Promise<void> {
    if (this.exitSettled || this.commandedReason !== undefined) return
    // A crashing kernel closes its FIFO write end as an ordinary side effect
    // of process death; give the authoritative process-exit observation a
    // brief window to settle first so a genuine crash is not misreported as
    // a protocol violation (a driver that closes only the FIFO and stays
    // alive is the genuine violation this grace distinguishes). Reuses the
    // one fixed descendant-grace constant rather than a
    // second, unexplained one.
    let exited = false
    try {
      exited = await this.handle.waitForExit(AbortSignal.timeout(DESCENDANT_GRACE_MS))
    } catch {
      // A provider that cannot answer the bounded observation has not proven the tree dead (mirrors quiesce()).
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- handle.done can settle exit while this grace wait is awaited.
    if (this.exitSettled || exited) return
    this.failProtocol(new KernelProtocolError(
      'science-runtime: kernel response FIFO ended unexpectedly while the kernel process was still alive',
    ))
  }

  private onFifoError(error: unknown): void {
    if (this.exitSettled) return
    this.failProtocol(error instanceof Error
      ? new KernelProtocolError(`science-runtime: kernel response FIFO failed: ${error.message}`)
      : new KernelProtocolError('science-runtime: kernel response FIFO failed'))
  }

  private failProtocol(error: KernelProtocolError): void {
    if (this.protocolFault !== undefined) return
    this.protocolFault = error
    const pending = this.pending
    this.pending = undefined
    pending?.reject(error)
    if (this.phase === 'starting') this.readyWaiter.reject(error)
    try {
      this.handle.terminate()
    } catch {
      // handle.done settling remains authoritative for exit classification.
    }
  }

  private settleExit(exitCode: number | null, signal: NodeJS.Signals | null): void {
    // settleExit is registered as the sole .then() callback on `handle.done`
    // (the constructor), a real Promise that settles at most once, so this
    // guard can never observe exitSettled already true.
    /* v8 ignore next */
    if (this.exitSettled) return
    this.exitSettled = true
    const cause: KernelExitCause = this.protocolFault !== undefined
      ? 'protocol'
      : this.commandedReason !== undefined ? 'commanded' : 'crash'
    this.resolveExited({ exitCode, signal, cause })
    const pending = this.pending
    this.pending = undefined
    if (pending === undefined) return
    pending.reject(this.protocolFault ?? new KernelExitedError(
      `science-runtime: kernel process exited (${cause}) before RUN ${pending.runId} completed`,
    ))
  }
}
