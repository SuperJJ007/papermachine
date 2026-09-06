/**
 * Cross-platform response channel for one persistent kernel process. The
 * fixed kernel wire protocol (`kernel-process.ts`'s READY/DONE/CHART frames)
 * travels over a POSIX FIFO on darwin/linux ({@link createFifoTransport}: the
 * same `mkfifo` + owned `cat` forwarder subprocess this Runtime has always
 * used) and a loopback TCP connection on win32 ({@link LoopbackTcpTransport}:
 * no `mkfifo`/`SIGINT` exist there, and a Host-created named pipe is not
 * guaranteed writable by the ACL-sandboxed kernel token — see this package's
 * README). Both implementations expose the same {@link KernelResponseTransport}
 * shape so `KernelProcess`'s frame parser and state machine stay transport-agnostic:
 * a readable byte stream plus a `faulted` signal for a carrier fault the
 * stream's own `'end'`/`'error'` events do not otherwise surface.
 * @module @deepseek-ai/dsh-science-runtime/kernel-transport
 */

import { randomBytes } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import type { Readable } from 'node:stream'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { DESCENDANT_GRACE_MS, quiesce } from './execution.ts'
import type { Quiescence } from './execution.ts'

/**
 * Reject a host-minted field that must never carry frame delimiters. Shared
 * with `kernel-process.ts`'s own wire-protocol fields.
 * @param value - the exact field value to check.
 * @param label - the field's name, embedded verbatim in the thrown message.
 * @throws {Error} when `value` contains a tab or newline.
 */
export function assertNoFrameDelimiters(value: string, label: string): void {
  if (value.includes('\t') || value.includes('\n')) {
    throw new Error(`science-runtime: kernel ${label} must not contain a tab or newline`)
  }
}

/** Selects which transport a fresh kernel's response channel uses. */
export type KernelTransportKind = 'fifo' | 'tcp'

/**
 * Default transport selection for a fresh kernel: loopback TCP on win32
 * (no `mkfifo`/`SIGINT`), the POSIX FIFO everywhere else. A test may inject
 * `'tcp'` on a POSIX host to exercise the loopback path without mocking
 * `process.platform` globally.
 * @param platform - host platform to decide from; defaults to the running process's own.
 * @returns the transport kind a fresh kernel on that platform must use.
 */
export function selectKernelTransportKind(platform: NodeJS.Platform = process.platform): KernelTransportKind {
  return platform === 'win32' ? 'tcp' : 'fifo'
}

/**
 * One kernel's response channel: opened before the kernel process spawns
 * (so its address is ready to embed in the driver's argv) and torn down with
 * it. The FIFO transport's byte stream is available immediately
 * ({@link connect} resolves without waiting); the TCP transport's stream
 * exists only once the kernel actually connects and proves it holds this
 * channel's token, so its {@link connect} genuinely waits and must be bounded.
 */
export interface KernelResponseTransport {
  /** Positional driver argv value addressing this channel (absolute FIFO path, or `tcp:127.0.0.1:<port>:<token>`). */
  readonly endpointArg: string
  /**
   * Rejects only on a carrier-level fault the eventual stream's own
   * `'end'`/`'error'` events do not otherwise surface (the FIFO forwarder
   * subprocess's own promise rejecting); never resolves.
   */
  readonly faulted: Promise<never>
  /**
   * Resolve the driver's raw response byte stream once the channel is
   * usable, already UTF-8 decoded.
   * @param handle - the kernel's own subprocess handle; a transport whose
   *   connection is not yet established races this against the kernel
   *   process exiting first, so a kernel that dies before connecting fails
   *   fast instead of hanging.
   * @param kernelStartTimeoutMs - bound for this wait, mirroring the spawn-to-READY deadline.
   * @param signal - caller's own operation cancellation.
   */
  connect(handle: SubprocessHandle, kernelStartTimeoutMs: number, signal: AbortSignal | undefined): Promise<Readable>
  /**
   * Ordinary end-of-life teardown for an already-ready kernel: terminate and
   * quiesce whatever carrier this transport owns, destroy the response
   * stream, and remove any on-disk channel resource. Merged by the caller
   * into `KernelProcess.end()`'s own combined {@link Quiescence} verdict.
   */
  end(): Promise<Quiescence>
  /**
   * Teardown for a kernel that never reached READY: awaits full quiescence
   * before returning, since no combined-verdict caller exists at this stage
   * (mirrors {@link end} but never leaves an unproven tree for a caller to
   * track separately).
   */
  endStartFailure(): Promise<void>
}

/**
 * Select and open a fresh kernel's response transport.
 * @param kind - which transport to open (see {@link selectKernelTransportKind}).
 * @param subprocess - subprocess service the FIFO transport's owned `cat` forwarder spawns through; unused for `'tcp'`.
 * @param cwd - the kernel's own scratch directory the FIFO transport creates its response FIFO under; unused for `'tcp'`.
 * @returns the opened transport, ready for {@link KernelResponseTransport.connect}.
 */
export function createKernelResponseTransport(
  kind: KernelTransportKind,
  subprocess: SubprocessRuntime,
  cwd: string,
): Promise<KernelResponseTransport> {
  return kind === 'tcp' ? LoopbackTcpTransport.create() : createFifoTransport(subprocess, cwd)
}

// ---------------------------------------------------------------------------
// FIFO transport (darwin, linux)
// ---------------------------------------------------------------------------

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

/** One FIFO plus its owned forwarding `cat` subprocess, wrapped as a {@link KernelResponseTransport}. */
class FifoTransport implements KernelResponseTransport {
  readonly faulted: Promise<never>

  constructor(
    private readonly fifoPath: string,
    private readonly reader: SubprocessHandle,
    private readonly stream: Readable,
  ) {
    this.faulted = new Promise<never>((_resolve, reject) => {
      reader.done.catch(reject)
    })
  }

  get endpointArg(): string {
    return this.fifoPath
  }

  /** Already open: the forwarder was spawned at transport creation. */
  connect(): Promise<Readable> {
    return Promise.resolve(this.stream)
  }

  async end(): Promise<Quiescence> {
    const result = await stopResponseReader(this.reader)
    this.stream.destroy()
    await unlinkFifo(this.fifoPath)
    return result
  }

  async endStartFailure(): Promise<void> {
    const result = await stopResponseReader(this.reader)
    if (!result.quiescent) await result.eventualQuiescence
    this.stream.destroy()
    await unlinkFifo(this.fifoPath)
  }
}

/**
 * Open one FIFO transport: create the FIFO, spawn its forwarding reader, and
 * verify the reader's own stdout pipe. A reader-spawn or stdout failure tears
 * down whatever partial state exists (the reader, if spawned) and removes the
 * FIFO before rethrowing; a `mkfifo` failure itself needs no cleanup, since
 * nothing was created.
 */
async function createFifoTransport(subprocess: SubprocessRuntime, cwd: string): Promise<FifoTransport> {
  const fifoPath = join(cwd, 'resp.fifo')
  await createResponseFifo(subprocess, cwd, fifoPath)
  let reader: SubprocessHandle | undefined
  try {
    reader = await startResponseReader(subprocess, cwd, fifoPath)
    const stream = reader.stdout
    if (stream === undefined) throw new Error('science-runtime: FIFO reader was not spawned with a stdout pipe')
    stream.setEncoding('utf8')
    return new FifoTransport(fifoPath, reader, stream)
  } catch (error) {
    if (reader !== undefined) {
      const result = await stopResponseReader(reader)
      if (!result.quiescent) await result.eventualQuiescence
      reader.stdout?.destroy()
    }
    await unlinkFifo(fifoPath)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Loopback TCP transport (win32)
// ---------------------------------------------------------------------------

/** Hex characters in a fresh per-kernel token: 32 hex characters (16 random bytes). */
const TOKEN_BYTES = 16
/** Generous bound on the token line's own byte length, guarding against an unbounded pre-newline buffer. */
const MAX_TOKEN_LINE_BYTES = 256

/** Close a listening server, tolerating one already stopped (e.g. by an accepted connection). */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => { resolve() })
  })
}

/**
 * Read exactly one newline-terminated token line off `socket` before
 * treating it as the kernel's response stream. Uses the paused-mode
 * `'readable'`/`read()` pattern (the documented technique for this
 * parse-a-prefix-then-hand-off-the-rest shape — the same one Node's own HTTP
 * upgrade handling uses) rather than a `'data'` listener, since flipping a
 * socket between flowing and paused mode mid-handshake is not guaranteed to
 * preserve already-buffered bytes: buffers raw bytes (the socket's encoding
 * is not yet set) until a `\n`, destroys the connection and rejects on a
 * wrong/missing/oversized token, and otherwise re-queues whatever bytes
 * followed the token line (`unshift`) before switching the socket to UTF-8
 * decoding and resolving it as the transport's stream.
 * @param socket - the one accepted connection.
 * @param token - this transport's own per-kernel token.
 * @returns the same socket, ready to read as a UTF-8 frame stream.
 */
function readToken(socket: Socket, token: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    function cleanup(): void {
      socket.off('readable', onReadable)
      socket.off('end', onEnd)
      socket.off('error', onError)
    }
    function onReadable(): void {
      let chunk: unknown
      while ((chunk = socket.read()) !== null) {
        buffer = Buffer.concat([buffer, chunk as Buffer])
        const newline = buffer.indexOf(0x0a)
        if (newline === -1) {
          if (buffer.length > MAX_TOKEN_LINE_BYTES) {
            cleanup()
            socket.destroy()
            reject(new Error('science-runtime: kernel response channel token line exceeded its bound'))
            return
          }
          continue
        }
        cleanup()
        const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '')
        const remainder = buffer.subarray(newline + 1)
        if (line !== token) {
          socket.destroy()
          reject(new Error('science-runtime: kernel response channel presented an incorrect or missing token'))
          return
        }
        if (remainder.length > 0) socket.unshift(remainder)
        socket.setEncoding('utf8')
        resolve(socket)
        return
      }
    }
    function onEnd(): void {
      cleanup()
      reject(new Error('science-runtime: kernel response channel ended before presenting its token'))
    }
    function onError(error: unknown): void {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    socket.on('readable', onReadable)
    socket.once('end', onEnd)
    socket.once('error', onError)
  })
}

/**
 * A win32 kernel's response channel: the Host listens on `127.0.0.1` with an
 * OS-assigned port and accepts connections until one presents this
 * transport's own random token (see this package's README for why a named
 * pipe is rejected instead). A connection that fails the handshake in any
 * way — wrong, missing, or oversized token line, premature EOF, or a socket
 * error — is destroyed, but the listener keeps accepting further connections
 * until {@link connect}'s own deadline or the kernel process itself exits:
 * the token is 128 bits of CSPRNG output, so an indefinite guessing channel
 * is not a realistic threat, and closing the listener on the first
 * connection regardless of its token would let any other unrelated local
 * process — accidentally or on purpose — fail every kernel start by winning
 * the race to connect first. Only a connection that actually presents the
 * correct token stops the listener.
 */
export class LoopbackTcpTransport implements KernelResponseTransport {
  /** Never settles: a TCP socket's own carrier fault surfaces through the resolved stream's `'error'`/`'end'` events instead. */
  readonly faulted: Promise<never> = new Promise<never>(() => {})

  private connectionSocket: Socket | undefined
  /**
   * Set by the listener's own long-lived `'error'` handler; {@link connect}
   * checks it first so a fault that already happened before it was ever
   * called fails fast instead of hanging until the deadline.
   */
  private listenerError: Error | undefined
  /**
   * Connections accepted with no attempt in progress for them yet: the
   * kernel driver connects as soon as it starts, which can race ahead of
   * this Host process reaching its own {@link connect} call, so a
   * connection arriving in that window is queued here instead of being
   * accepted with no listener at all and leaked open.
   */
  private readonly pendingSockets: Socket[] = []
  private waiter: ReturnType<typeof Promise.withResolvers<Readable>> | undefined

  private constructor(
    private readonly server: Server,
    private readonly port: number,
    private readonly token: string,
  ) {
    // Long-lived: `create()` returns before any caller invokes `connect()`
    // (this transport's own address must be embedded in the kernel driver's
    // argv first), and a server-level fault (e.g. EMFILE during accept)
    // landing in that window has no other listener yet and would otherwise
    // crash the Host process as an uncaught 'error' event.
    this.server.on('error', (error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.listenerError = normalized
      this.waiter?.reject(normalized)
    })
    // Long-lived, for the same reason: see `pendingSockets`' own doc.
    this.server.on('connection', (socket: Socket) => {
      this.connectionSocket = socket
      this.pendingSockets.push(socket)
      this.drainPending()
    })
  }

  /**
   * Open a fresh loopback listener with a fresh random token, without waiting for any connection.
   * @returns the listening transport, ready to embed in a driver's argv via {@link endpointArg}.
   */
  static async create(): Promise<LoopbackTcpTransport> {
    const token = randomBytes(TOKEN_BYTES).toString('hex')
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      const onError = (error: unknown): void => { reject(error instanceof Error ? error : new Error(String(error))) }
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      await closeServer(server)
      throw new Error('science-runtime: loopback kernel transport listener produced no port')
    }
    return new LoopbackTcpTransport(server, address.port, token)
  }

  get endpointArg(): string {
    return `tcp:127.0.0.1:${String(this.port)}:${this.token}`
  }

  /**
   * Attempt every currently queued connection against the token, once a
   * caller is actually waiting for one. A losing attempt destroys that one
   * socket and leaves every other queued or future connection unaffected;
   * a winning one stops the listener and settles the waiter (a second,
   * differently-timed winner is a no-op against the already-cleared waiter
   * — the token makes two independent winners unreachable in practice).
   */
  private drainPending(): void {
    if (this.waiter === undefined) return
    for (const socket of this.pendingSockets.splice(0)) {
      readToken(socket, this.token).then(
        (stream) => {
          this.server.close()
          const waiter = this.waiter
          this.waiter = undefined
          waiter?.resolve(stream)
        },
        () => { socket.destroy() },
      )
    }
  }

  connect(handle: SubprocessHandle, kernelStartTimeoutMs: number, signal: AbortSignal | undefined): Promise<Readable> {
    if (this.listenerError !== undefined) return Promise.reject(this.listenerError)
    const bound = deadline(signal, kernelStartTimeoutMs, 'KERNEL_START_TIMEOUT')
    const waiter = Promise.withResolvers<Readable>()
    this.waiter = waiter
    this.drainPending()
    const onExit = (): void => {
      waiter.reject(new Error('science-runtime: kernel process exited before connecting to its response channel'))
    }
    const onAbort = (): void => {
      waiter.reject(new Error(`science-runtime: kernel did not connect to its response channel within ${String(kernelStartTimeoutMs)}ms`))
    }
    void handle.done.then(onExit, onExit)
    bound.signal.addEventListener('abort', onAbort, { once: true })
    if (bound.signal.aborted) onAbort()
    return waiter.promise.finally(() => {
      bound.signal.removeEventListener('abort', onAbort)
      bound[Symbol.dispose]()
      if (this.waiter === waiter) this.waiter = undefined
    })
  }

  async end(): Promise<Quiescence> {
    this.connectionSocket?.destroy()
    for (const socket of this.pendingSockets.splice(0)) socket.destroy()
    await closeServer(this.server)
    return { quiescent: true, forced: false }
  }

  async endStartFailure(): Promise<void> {
    this.connectionSocket?.destroy()
    for (const socket of this.pendingSockets.splice(0)) socket.destroy()
    await closeServer(this.server)
  }
}
