/**
 * One confined persistent Science kernel subprocess speaking the kernel wire
 * protocol (`stdin` RUN/CHART_EXTRACT/CHART_APPLY/EXIT request frames, response-FIFO READY/DONE/CHART frames): spawn
 * sequence, execute-serialization, cooperative interrupt passthrough, and
 * teardown. An owned forwarding process reads the FIFO; Host reads its
 * stdout pipe without retaining a filesystem worker. Session-scoped lifecycle is out of scope here: this module knows
 * nothing about session events, kernel epochs, idle timers, or durable end
 * reasons beyond the generic diagnostic string `end()` accepts.
 * @module @deepseek-ai/dsh-science-runtime/kernel-process
 */

import { unlink } from 'node:fs/promises'
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
import type { ScienceKernelScratch, ScienceSessionScratch } from './scratch.ts'
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
  /** Per-run materialized-input directory the driver publishes as `SCIENCE_INPUT_DIR`. */
  readonly inputDir: string
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

/** One private-file chart extraction request following a completed run. */
export interface KernelChartExtractRequest {
  /** Run whose registered figures may be extracted. */
  readonly runId: ScienceRunId
  /** Host-written request JSON path. */
  readonly requestPath: string
  /** Kernel-written result JSON path. */
  readonly resultPath: string
  /** Bound for the complete CHART_EXTRACT/CHART exchange. */
  readonly timeoutMs: number
}

/** One private-file chart operation request. */
export interface KernelChartApplyRequest extends KernelChartExtractRequest {
  /** Operation cancellation; abort faults the outstanding exchange and terminates the kernel. */
  readonly signal?: AbortSignal
}

/** Parsed CHART response for one extraction request. */
export interface KernelChartFrame {
  /** Run identity from the matching request. */
  readonly runId: ScienceRunId
  /** Kernel-side extraction status. */
  readonly status: 'ok' | 'error'
  /** Stable exception/condition class on error; empty on success. */
  readonly detail: string
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
  readonly kind: 'execute'
  readonly runId: ScienceRunId
  readonly resolve: (frame: KernelDoneFrame) => void
  readonly reject: (error: Error) => void
}

interface PendingChart {
  readonly kind: 'chart'
  readonly runId: ScienceRunId
  readonly resolve: (frame: KernelChartFrame) => void
  readonly reject: (error: Error) => void
}

type PendingRequest = PendingExecute | PendingChart

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

/** Forward FIFO bytes over a subprocess pipe without blocking Host filesystem workers. */
async function startResponseReader(subprocess: SubprocessRuntime, cwd: string, fifoPath: string): Promise<SubprocessHandle> {
  const cat = await subprocess.resolveExecutable('cat')
  return subprocess.spawn({
    argv: [cat, fifoPath],
    cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 4_096 } },
    graceMs: DESCENDANT_GRACE_MS,
    environmentBase: 'empty',
  })
}

/** Stop a reader that may still be blocked opening its FIFO, retaining the provider's quiescence observation. */
async function stopResponseReader(reader: SubprocessHandle): Promise<Quiescence> {
  try {
    reader.terminate()
  } catch {
    // A failed termination request leaves quiesce responsible for retry and exit observation.
  }
  return quiesce(reader)
}

/**
 * Full teardown for a kernel that failed anywhere between response-FIFO
 * creation and a successful READY handshake: quiesce the
 * subprocess when one was spawned, destroy the host's pipe reader, then
 * remove the FIFO file.
 * @param handle - the spawned subprocess handle, or `undefined` when spawn itself never ran.
 * @param fifoPath - absolute path of the response FIFO.
 * @param reader - the FIFO forwarding subprocess, if spawned.
 */
async function cleanupOnStartFailure(
  handle: SubprocessHandle | undefined,
  fifoPath: string,
  reader: SubprocessHandle | undefined,
): Promise<void> {
  if (handle !== undefined) {
    const result = await quiesce(handle)
    if (!result.quiescent) await result.eventualQuiescence
  }
  if (reader !== undefined) {
    const result = await stopResponseReader(reader)
    if (!result.quiescent) await result.eventualQuiescence
    reader.stdout?.destroy()
  }
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
 * Carries the kernel-scoped user-install base
 * ({@link ScienceKernelScratch.userLibrary}) as `PYTHONUSERBASE` (Python) or
 * `R_LIBS_USER` (R): the writable target an inline `pip install`/
 * `install.packages()` falls back to under sandbox confinement, and the
 * location the dropped `-I` flag ({@link interpreterArgv}) lets Python's
 * `sys.path` see again within the same kernel.
 */
function kernelEnvironment(
  binding: ScienceInterpreterAvailableBinding,
  sessionScratch: ScienceSessionScratch,
  kernelScratch: ScienceKernelScratch,
): NodeJS.ProcessEnv {
  return {
    HOME: sessionScratch.home,
    TMPDIR: kernelScratch.tmp,
    PATH: interpreterPathEnv(binding.canonicalPrefix),
    SCIENCE_STATE_DIR: sessionScratch.state,
    ...(binding.language === 'python'
      ? { PYTHONUSERBASE: kernelScratch.userLibrary }
      : { R_LIBS_USER: kernelScratch.userLibrary }),
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
  private pending: PendingRequest | undefined
  private protocolFault: KernelProtocolError | undefined
  private commandedReason: string | undefined
  private exitSettled = false
  private endPromise: Promise<Quiescence> | undefined
  private lineBuffer = ''

  private constructor(
    private readonly handle: SubprocessHandle,
    private readonly fifoPath: string,
    private readonly reader: SubprocessHandle,
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
    void reader.done.catch((error: unknown) => { this.onFifoError(error) })
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
    let reader: SubprocessHandle | undefined
    let handle: SubprocessHandle | undefined
    try {
      // The helper owns blocking FIFO open/read; Host observes its ordinary
      // subprocess pipe, including EOF on macOS and Linux.
      reader = await startResponseReader(services.subprocess, kernelScratch.directory, fifoPath)
      const readStream = reader.stdout
      if (readStream === undefined) throw new Error('science-runtime: FIFO reader was not spawned with a stdout pipe')
      readStream.setEncoding('utf8')
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
        env: kernelEnvironment(binding, services.sessionScratch, kernelScratch),
      })
      const kernel = new KernelProcess(handle, fifoPath, reader, readStream)
      await kernel.awaitReady(kernelStartTimeoutMs, signal)
      return kernel
    } catch (error) {
      await cleanupOnStartFailure(handle, fifoPath, reader)
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
      throw new Error('science-runtime: KernelProcess.execute called while another request is still pending')
    }
    if (this.protocolFault !== undefined) return Promise.reject(this.protocolFault)
    if (this.exitSettled) return Promise.reject(new KernelExitedError('science-runtime: kernel process has already exited'))
    assertNoFrameDelimiters(request.runId, 'RUN runId')
    assertNoFrameDelimiters(request.sourcePath, 'RUN sourcePath')
    assertNoFrameDelimiters(request.cwd, 'RUN cwd')
    assertNoFrameDelimiters(request.stdoutPath, 'RUN stdoutPath')
    assertNoFrameDelimiters(request.stderrPath, 'RUN stderrPath')
    assertNoFrameDelimiters(request.artifactDir, 'RUN artifactDir')
    assertNoFrameDelimiters(request.inputDir, 'RUN inputDir')
    const frame = [
      'RUN', request.runId, request.sourcePath, request.cwd, request.stdoutPath, request.stderrPath,
      request.artifactDir, request.inputDir,
    ].join('\t')
    const resolvers = Promise.withResolvers<KernelDoneFrame>()
    this.pending = { kind: 'execute', runId: request.runId, resolve: resolvers.resolve, reject: resolvers.reject }
    try {
      this.stdin.write(`${frame}\n`)
    } catch (error) {
      this.pending = undefined
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return resolvers.promise
  }

  /**
   * Write one CHART_EXTRACT frame and await its matching CHART response.
   * A timeout is a protocol fault: the unresponsive kernel is terminated and
   * the owning KernelSet must retire it before reuse.
   * @param request - run id, private request/result paths, and extraction deadline.
   * @returns the matching CHART response.
   */
  extractCharts(request: KernelChartExtractRequest): Promise<KernelChartFrame> {
    if (this.pending !== undefined) {
      throw new Error('science-runtime: KernelProcess.extractCharts called while another request is still pending')
    }
    if (this.protocolFault !== undefined) return Promise.reject(this.protocolFault)
    if (this.exitSettled) return Promise.reject(new KernelExitedError('science-runtime: kernel process has already exited'))
    assertNoFrameDelimiters(request.runId, 'CHART_EXTRACT runId')
    assertNoFrameDelimiters(request.requestPath, 'CHART_EXTRACT requestPath')
    assertNoFrameDelimiters(request.resultPath, 'CHART_EXTRACT resultPath')
    const resolvers = Promise.withResolvers<KernelChartFrame>()
    this.pending = { kind: 'chart', runId: request.runId, resolve: resolvers.resolve, reject: resolvers.reject }
    let timeout: NodeJS.Timeout | undefined
    try {
      this.stdin.write(`CHART_EXTRACT\t${request.runId}\t${request.requestPath}\t${request.resultPath}\n`)
      timeout = setTimeout(() => {
        this.failProtocol(new KernelProtocolError(
          `science-runtime: kernel did not finish chart extraction within ${String(request.timeoutMs)}ms`,
        ))
      }, request.timeoutMs)
    } catch (error) {
      this.pending = undefined
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return resolvers.promise.finally(() => { clearTimeout(timeout) })
  }

  /**
   * Write one CHART_APPLY frame and await its matching CHART response.
   * A timeout or cancellation faults and terminates the process; its owner
   * must quiesce it before releasing its resources.
   * The caller owns both paths inside run scratch; the result PNG may be an
   * ephemeral preview and is never published merely by this protocol exchange.
   * @param request - source run id, private request/result paths, deadline, and cancellation.
   * @returns the matching CHART response.
   */
  applyChart(request: KernelChartApplyRequest): Promise<KernelChartFrame> {
    if (this.pending !== undefined) {
      throw new Error('science-runtime: KernelProcess.applyChart called while another request is still pending')
    }
    if (this.protocolFault !== undefined) return Promise.reject(this.protocolFault)
    if (this.exitSettled) return Promise.reject(new KernelExitedError('science-runtime: kernel process has already exited'))
    assertNoFrameDelimiters(request.runId, 'CHART_APPLY runId')
    assertNoFrameDelimiters(request.requestPath, 'CHART_APPLY requestPath')
    assertNoFrameDelimiters(request.resultPath, 'CHART_APPLY resultPath')
    const resolvers = Promise.withResolvers<KernelChartFrame>()
    this.pending = { kind: 'chart', runId: request.runId, resolve: resolvers.resolve, reject: resolvers.reject }
    const bound = deadline(request.signal, request.timeoutMs, 'CHART_APPLY_TIMEOUT')
    const abort = (): void => {
      this.failProtocol(new KernelProtocolError('science-runtime: chart application was cancelled or timed out'))
    }
    bound.signal.addEventListener('abort', abort, { once: true })
    try {
      this.stdin.write(`CHART_APPLY\t${request.runId}\t${request.requestPath}\t${request.resultPath}\n`)
      if (bound.signal.aborted) abort()
    } catch (error) {
      this.pending = undefined
      resolvers.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return resolvers.promise.finally(() => {
      bound.signal.removeEventListener('abort', abort)
      bound[Symbol.dispose]()
    })
  }

  /** Deliver a cooperative SIGINT request to the kernel process; a pure {@link SubprocessHandle.interrupt} passthrough. */
  interrupt(): void {
    this.handle.interrupt()
  }

  /**
   * Best-effort EXIT frame, then quiesce the interpreter and its FIFO
   * forwarder, then stream/file cleanup. Idempotent: a second call awaits the same teardown.
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
    const readerQuiescence = await stopResponseReader(this.reader)
    this.readStream.destroy()
    await unlinkFifo(this.fifoPath)
    if (quiescence.quiescent && readerQuiescence.quiescent) {
      return { quiescent: true, forced: quiescence.forced || readerQuiescence.forced }
    }
    return {
      quiescent: false,
      forced: true,
      eventualQuiescence: Promise.all([quiescence, readerQuiescence].map(result =>
        result.quiescent ? Promise.resolve(true) : result.eventualQuiescence)).then(results => results.every(Boolean)),
    }
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
    if (bound.signal.aborted) onTimeout()
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
    if (tag !== 'READY' || protocolVersion !== '2' || pid === undefined || extra !== undefined) {
      this.failProtocol(new KernelProtocolError(`science-runtime: kernel sent an unexpected line before READY: ${JSON.stringify(line)}`))
      return
    }
    this.phase = 'ready'
    this.readyWaiter.resolve()
  }

  private handleRunLine(line: string): void {
    const fields = line.split('\t')
    const pending = this.pending
    if (pending?.kind === 'chart') {
      const [tag, runId, status, detail, extra] = fields
      if (tag !== 'CHART' || runId === undefined || (status !== 'ok' && status !== 'error')
        || detail === undefined || extra !== undefined || runId !== pending.runId) {
        this.failProtocol(new KernelProtocolError(`science-runtime: kernel sent an unexpected frame: ${JSON.stringify(line)}`))
        return
      }
      this.pending = undefined
      pending.resolve({ runId: pending.runId, status, detail })
      return
    }
    const [tag, runId, status, detail, flags, extra] = fields
    if (
      tag !== 'DONE' || runId === undefined || status === undefined || detail === undefined || flags === undefined
      || extra !== undefined || !isDoneStatus(status) || pending?.kind !== 'execute' || runId !== pending.runId
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
      `science-runtime: kernel process exited (${cause}) before ${pending.kind === 'execute' ? 'RUN' : 'CHART_EXTRACT'} ${pending.runId} completed`,
    ))
  }
}
