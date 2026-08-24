/** Host child-process supervision for the Electron development carrier. */

import { spawn, type ChildProcess } from 'node:child_process'

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
    let stdout = ''
    child.stdout.setEncoding('utf8')
    // The desktop shell never retains Host stderr: provider diagnostics can
    // carry deployment data that does not belong in renderer-visible state.
    child.stderr.resume()
    return new Promise<URL>((resolve, reject) => {
      let settled = false
      const rejectStartup = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }
      child.once('error', (error) => {
        if (this.child === child) this.child = undefined
        rejectStartup(new Error(`desktop host: failed to start: ${error.message}`, { cause: error }))
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
        if (!wasReady) {
          rejectStartup(new Error(
            `desktop host: exited before readiness (${String(code ?? signal)})`,
          ))
          return
        }
        if (!wasStopping) this.options.onUnexpectedExit?.({ code, signal })
      })
    })
  }

  /** Stop the Host process group, escalating to SIGKILL after {@link HostProcessSupervisorOptions.graceMs}. */
  async stop(): Promise<void> {
    const child = this.child
    if (child?.pid === undefined) return
    this.stopping = true
    const exit = new Promise<void>(resolve => child.once('exit', () => { resolve() }))
    signalProcessTree(child, 'SIGTERM')
    const exited = await Promise.race([
      exit.then(() => true as const),
      new Promise<false>(resolve => setTimeout(() => { resolve(false) }, this.options.graceMs)),
    ])
    if (!exited && child.exitCode === null && child.signalCode === null) {
      signalProcessTree(child, 'SIGKILL')
      await exit
    }
  }
}

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
