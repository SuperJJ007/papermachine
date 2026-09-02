/** Host child-process supervision for the Electron development carrier. */

import { Buffer } from 'node:buffer'
import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MAX_HOST_LOG_ROTATED_FILES } from './host-config.ts'

/** Persisted, bounded stderr destination for one Host command. */
export interface HostStderrLog {
  /** Exact `<dshHome>/logs/host.log` path. */
  readonly path: string
  /** Maximum bytes retained in the active file. */
  readonly maxBytes: number
  /** Number of numbered rotated files retained beside the active file. */
  readonly maxRotatedFiles: number
}

/** A complete process launch specification with no ambient shell parsing. */
export interface HostCommand {
  /** Executable path. */
  executable: string
  /** Exact argument vector. */
  args: readonly string[]
  /** Working directory inherited by the Host. */
  cwd: string
  /** Complete environment inherited by the Host. */
  env: NodeJS.ProcessEnv
  /** Private bounded destination for redacted Host stderr. */
  stderrLog: HostStderrLog
}

/** Unexpected Host termination reported after the process was ready. */
export interface HostExit {
  /** Numeric exit status, or `null` for signal termination. */
  code: number | null
  /** Terminating signal, or `null` for ordinary exit. */
  signal: NodeJS.Signals | null
}

/** Options controlling one Host supervisor. */
export interface HostProcessSupervisorOptions {
  /** Called only when a ready Host terminates without an active stop request. */
  onUnexpectedExit?: (exit: HostExit) => void
  /** Milliseconds {@link HostProcessSupervisor.stop} allows for cooperative Cordis disposal before escalating to SIGKILL. */
  graceMs: number
}

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/
const SENSITIVE_ENV_NAME = /(credential|key|password|secret|token)/i
const REDACTED = '[REDACTED]'
const OVERSIZED_LINE = '[host stderr line omitted: exceeded configured logMaxBytes]\n'
// Milliseconds `HostProcessSupervisor`'s exit handling waits for the stderr
// drain to settle before deciding the launch/exit outcome without it. The
// drain only resolves at end-of-pipe; a grandchild that inherited the
// Host's stderr file descriptor (subagent processes spawn with
// `stderr: 'inherit'`) can keep that pipe open long after the Host itself
// has exited, and a launch failure or crash must still be reported.
const EXIT_LOG_DRAIN_TIMEOUT_MS = 500

/** Return an errno match without weakening unknown caught values. */
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null
    && (error as { readonly code?: unknown }).code === code
}

/** Replace credentials before any Host stderr bytes enter persistent storage. */
function redactHostStderr(text: string, env: NodeJS.ProcessEnv): string {
  let redacted = text
  const exactValues = Object.entries(env)
    .filter(([name, value]) => SENSITIVE_ENV_NAME.test(name) && typeof value === 'string' && value.length > 0)
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length)
  for (const value of exactValues) redacted = redacted.replaceAll(value, REDACTED)
  return redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/(\b(?:api[_-]?key|authorization|credential|password|secret|token)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, `$1${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
}

/**
 * Resolve when `drain` settles or after {@link EXIT_LOG_DRAIN_TIMEOUT_MS},
 * whichever comes first. `drain` (`HostProcessSupervisor.logDrain`) already
 * catches its own rejection internally, so this never rejects either way.
 */
function withBoundedDrain(drain: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, EXIT_LOG_DRAIN_TIMEOUT_MS)
    void drain.then(finish)
  })
}

/** Require a regular non-symlink log file, returning its byte size when present. */
async function regularFileSize(path: string): Promise<number | undefined> {
  try {
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`desktop host: log path ${JSON.stringify(path)} must be a regular file`)
    }
    return entry.size
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined
    throw error
  }
}

/** Remove one exact old rotation without following a symlink. */
async function removeRotationTarget(path: string): Promise<void> {
  try {
    const entry = await lstat(path)
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      throw new Error(`desktop host: rotated log path ${JSON.stringify(path)} must not be a directory`)
    }
    await unlink(path)
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error
  }
}

/** Rename one present regular log without accepting a link-shaped source. */
async function rotateIfPresent(source: string, target: string): Promise<void> {
  const size = await regularFileSize(source)
  if (size === undefined) return
  await rename(source, target)
}

/** Serialized writer that keeps the active and numbered Host logs within their configured byte/count bounds. */
class RotatingHostLog {
  private queue: Promise<void> = Promise.resolve()
  private activeBytes: number | undefined

  constructor(
    private readonly config: HostStderrLog,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  /** Largest raw line retained for redaction; larger lines become a fixed diagnostic. */
  get lineBufferMaxBytes(): number {
    return this.config.maxBytes
  }

  /** Queue one complete stderr line after credential redaction. */
  write(line: string): void {
    const safe = Buffer.byteLength(line) > this.config.maxBytes
      ? OVERSIZED_LINE
      : redactHostStderr(line, this.env)
    this.queue = this.queue.then(async () => { await this.append(Buffer.from(safe)) })
    // The supervisor observes the same rejection through `flush`; this
    // handler only prevents an early queue rejection from becoming unhandled.
    this.queue.catch(() => {})
  }

  /** Resolve after every queued write closes its file handle. */
  flush(): Promise<void> {
    return this.queue
  }

  /** Create and validate the private log directory and active file state once. */
  private async prepare(): Promise<void> {
    if (this.activeBytes !== undefined) return
    const directory = dirname(this.config.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const entry = await lstat(directory)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`desktop host: log directory ${JSON.stringify(directory)} must be a private directory`)
    }
    await chmod(directory, 0o700)
    for (let index = this.config.maxRotatedFiles + 1; index <= MAX_HOST_LOG_ROTATED_FILES; index += 1) {
      await removeRotationTarget(`${this.config.path}.${String(index)}`)
    }
    this.activeBytes = await regularFileSize(this.config.path) ?? 0
    if (this.activeBytes >= this.config.maxBytes) await this.rotate()
  }

  /** Move the active file through the configured numbered retention set. */
  private async rotate(): Promise<void> {
    for (let index = this.config.maxRotatedFiles; index >= 1; index -= 1) {
      const target = `${this.config.path}.${String(index)}`
      const source = index === 1 ? this.config.path : `${this.config.path}.${String(index - 1)}`
      await removeRotationTarget(target)
      await rotateIfPresent(source, target)
    }
    this.activeBytes = 0
  }

  /** Append one already-redacted line without splitting it across rotations. */
  private async append(data: Buffer): Promise<void> {
    await this.prepare()
    if ((this.activeBytes as number) > 0 && (this.activeBytes as number) + data.byteLength > this.config.maxBytes) {
      await this.rotate()
    }
    const handle = await open(
      this.config.path,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      const entry = await handle.stat()
      if (!entry.isFile()) throw new Error(`desktop host: log path ${JSON.stringify(this.config.path)} must be a regular file`)
      await handle.chmod(0o600)
      await handle.writeFile(data)
    } finally {
      await handle.close()
    }
    this.activeBytes = (this.activeBytes as number) + data.byteLength
  }
}

/** Drain Host stderr by complete bounded lines so credentials split across stream chunks are still redacted. */
function drainHostStderr(child: ChildProcess, log: RotatingHostLog): Promise<void> {
  const stderr = child.stderr
  if (stderr === null) return Promise.reject(new Error('desktop host: stderr pipe is unavailable'))
  stderr.setEncoding('utf8')
  return new Promise<void>((resolve, reject) => {
    let buffered = ''
    let discardingOversizedLine = false
    let finished = false
    const finish = (error?: Error): void => {
      if (finished) return
      finished = true
      if (!discardingOversizedLine && buffered.length > 0) log.write(buffered)
      void log.flush().then(
        () => {
          if (error === undefined) resolve()
          else reject(error)
        },
        reject,
      )
    }
    stderr.on('data', (incoming: string) => {
      let chunk = incoming
      if (discardingOversizedLine) {
        const newline = chunk.indexOf('\n')
        if (newline === -1) return
        chunk = chunk.slice(newline + 1)
        discardingOversizedLine = false
      }
      buffered += chunk
      while (true) {
        const newline = buffered.indexOf('\n')
        if (newline === -1) break
        log.write(buffered.slice(0, newline + 1))
        buffered = buffered.slice(newline + 1)
      }
      if (Buffer.byteLength(buffered) > log.lineBufferMaxBytes) {
        log.write(OVERSIZED_LINE)
        buffered = ''
        discardingOversizedLine = true
      }
    })
    stderr.once('end', () => { finish() })
    stderr.once('error', (error) => { finish(new Error('desktop host: stderr pipe failed', { cause: error })) })
  })
}

/**
 * Parse the stable Web readiness line without accepting a LAN address or unrelated URL.
 * @param line - one complete stdout line.
 * @returns the loopback URL, or `undefined` when the line is not readiness.
 */
export function parseHostReadyLine(line: string): URL | undefined {
  const match = READY_LINE.exec(line)
  if (match?.[1] === undefined) return undefined
  return new URL(match[1])
}

/** One restartable Host process whose process group belongs to this supervisor. */
export class HostProcessSupervisor {
  private child: ChildProcess | undefined
  private stopping = false
  private ready = false
  private logDrain: Promise<void> = Promise.resolve()

  constructor(
    private readonly command: HostCommand,
    private readonly options: HostProcessSupervisorOptions,
  ) {}

  /** Active Host pid, available synchronously after {@link start} begins. */
  get pid(): number | undefined {
    return this.child?.pid
  }

  /**
   * Start one Host and resolve only after its stable readiness line.
   * @returns the private loopback URL loaded by Electron.
   */
  start(): Promise<URL> {
    if (this.child !== undefined) throw new Error('desktop host: already running')
    this.stopping = false
    this.ready = false
    const child = spawn(this.command.executable, [...this.command.args], {
      cwd: this.command.cwd,
      env: this.command.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    const log = new RotatingHostLog(this.command.stderrLog, this.command.env)
    this.logDrain = drainHostStderr(child, log).catch((error: unknown) => {
      console.error(`desktop host: stderr logging failed: ${String(error)}`)
    })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    return new Promise<URL>((resolve, reject) => {
      let settled = false
      const rejectStartup = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }
      child.once('error', (error) => {
        if (this.child === child) this.child = undefined
        void this.logDrain.then(() => {
          rejectStartup(new Error(`desktop host: failed to start: ${error.message}`, { cause: error }))
        })
      })
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        while (true) {
          const newline = stdout.indexOf('\n')
          if (newline === -1) break
          const line = stdout.slice(0, newline).replace(/\r$/, '')
          stdout = stdout.slice(newline + 1)
          const url = parseHostReadyLine(line)
          if (url === undefined || settled) continue
          settled = true
          this.ready = true
          resolve(url)
        }
      })
      child.once('exit', (code, signal) => {
        const wasStopping = this.stopping
        const wasReady = this.ready
        if (this.child === child) this.child = undefined
        this.ready = false
        // Bounded, not `this.logDrain` directly: see EXIT_LOG_DRAIN_TIMEOUT_MS.
        void withBoundedDrain(this.logDrain).then(() => {
          if (!wasReady) {
            rejectStartup(new Error(
              `desktop host: exited before readiness (${String(code ?? signal)})`,
            ))
            return
          }
          if (!wasStopping) this.options.onUnexpectedExit?.({ code, signal })
        })
      })
    })
  }

  /**
   * Stop the Host process group, escalating to SIGKILL after
   * {@link HostProcessSupervisorOptions.graceMs} if anything in the group
   * survives. The direct child exiting cleanly is not sufficient: a Host
   * that disposes itself on SIGTERM while a kernel grandchild ignores it
   * would otherwise leave that grandchild alive forever, so the grace
   * period polls the whole process group rather than only the direct
   * child's own exit.
   */
  async stop(): Promise<void> {
    const child = this.child
    if (child?.pid === undefined) {
      await this.logDrain
      return
    }
    this.stopping = true
    const exit = new Promise<void>(resolve => child.once('exit', () => { resolve() }))
    signalProcessTree(child, 'SIGTERM')
    const deadline = Date.now() + this.options.graceMs
    while (isProcessTreeAlive(child) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, STOP_POLL_MS))
    }
    if (isProcessTreeAlive(child)) signalProcessTree(child, 'SIGKILL')
    await exit
    await this.logDrain
  }
}

// Interval this module polls the Host's process group for liveness during
// HostProcessSupervisor.stop's grace period.
const STOP_POLL_MS = 100

/** Signal the process group on POSIX and the direct child on Windows. */
function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** Whether the direct child or, on POSIX, any other member of its process group is still alive. */
function isProcessTreeAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) return false
  try {
    if (process.platform === 'win32') process.kill(child.pid, 0)
    else process.kill(-child.pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
