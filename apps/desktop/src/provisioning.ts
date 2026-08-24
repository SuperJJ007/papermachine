/** Transactional micromamba provisioning for desktop discipline environments. */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopPlatform, EnvironmentDeclaration } from './environment-declaration.ts'

type ProvisioningPhase = 'checking' | 'solving' | 'installing' | 'verifying' | 'publishing' | 'ready'

/** Bounded progress suitable for direct renderer projection. */
export interface ProvisioningProgress {
  readonly phase: ProvisioningPhase
  readonly message: string
}

/** Published pointer to the only prefix desktop Runtime configuration may consume. */
export interface AppliedEnvironment {
  readonly id: string
  readonly revision: string
  readonly prefix: string
  readonly appliedAt: number
}

export interface ProcessRequest {
  readonly executable: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly onLine?: (line: string) => void
}

export type ProcessRunner = (request: ProcessRequest) => Promise<void>

// Milliseconds a cancelled or timed-out provisioning child is given to exit
// cooperatively after SIGTERM before this module escalates to SIGKILL,
// symmetric with HostProcessSupervisor.stop's own escalation.
const KILL_GRACE_MS = 5000

/** Signal the process group on POSIX and the direct child on Windows, tolerating a group that is already gone. */
function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** Stop the child's process group, escalating to SIGKILL after {@link KILL_GRACE_MS} if it has not exited. */
function stopProcessGroup(child: ChildProcess): void {
  signalProcessGroup(child, 'SIGTERM')
  const escalate = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalProcessGroup(child, 'SIGKILL')
  }, KILL_GRACE_MS)
  child.once('exit', () => { clearTimeout(escalate) })
}

/**
 * Run one cancellable child and reject on timeout, signal, or non-zero exit.
 * The promise settles only on the child's own `exit` event — cancellation and
 * timeout request termination but never report completion before the process
 * (and, on POSIX, the rest of its signalled group) has actually quit, so a
 * caller that awaits rejection before quitting Electron never races an
 * orphaned download group past the signal it just sent.
 */
export const runProvisioningProcess: ProcessRunner = async (request) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(request.executable, request.args, {
      env: request.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    let outcome: 'cancelled' | 'timed-out' | undefined
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.signal.removeEventListener('abort', abort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const abort = (): void => {
      outcome = 'cancelled'
      stopProcessGroup(child)
    }
    const timer = setTimeout(() => {
      outcome = 'timed-out'
      stopProcessGroup(child)
    }, request.timeoutMs)
    for (const stream of [child.stdout, child.stderr]) {
      let pending = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        pending += chunk
        const lines = pending.split(/\r?\n/u)
        pending = lines.pop() ?? ''
        for (const line of lines) if (line.length > 0) request.onLine?.(line.slice(0, 500))
      })
    }
    child.once('error', (error) => { finish(error) })
    child.once('exit', (code, signal) => {
      if (outcome === 'cancelled') { finish(new Error('desktop provisioning: cancelled')); return }
      if (outcome === 'timed-out') { finish(new Error('desktop provisioning: timed out')); return }
      if (code === 0) finish()
      else finish(new Error(`desktop provisioning: process stopped (${String(code ?? signal)})`))
    })
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) abort()
  })
}

const SECRET_ENV_PATTERN = /KEY|SECRET|TOKEN|PASSWORD/iu
const PROXY_ENV_NAMES = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'])

/**
 * Build the minimal environment for a provisioning child from an allowlist —
 * `PATH`, `HOME`, `TMPDIR`, locale (`LANG`/`LC_*`), and the proxy variables
 * provisioning legitimately needs to reach package channels — excluding
 * anything credential-shaped even if it were added above. Micromamba and the
 * health-check interpreters never see the desktop process's full ambient
 * environment, so a credential exported into that process cannot leak into
 * installer output relayed verbatim to the renderer.
 * @param source - the environment to allowlist from; defaults to `process.env`.
 * @returns the scrubbed environment to pass to the child.
 */
export function buildProvisioningEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || SECRET_ENV_PATTERN.test(key)) continue
    if (key === 'PATH' || key === 'HOME' || key === 'TMPDIR' || key === 'LANG' || key.startsWith('LC_') || PROXY_ENV_NAMES.has(key)) {
      env[key] = value
    }
  }
  return env
}

export interface ProvisionerOptions {
  readonly root: string
  readonly micromambaPath: string
  readonly platform: DesktopPlatform
  readonly run?: ProcessRunner
  readonly now?: () => number
  readonly freeBytes?: () => Promise<number>
}

/** Install, verify, then atomically publish one declared environment revision. */
export class DesktopEnvironmentProvisioner {
  readonly #run: ProcessRunner
  readonly #now: () => number
  readonly #freeBytes: () => Promise<number>

  constructor(readonly options: ProvisionerOptions) {
    this.#run = options.run ?? runProvisioningProcess
    this.#now = options.now ?? Date.now
    this.#freeBytes = options.freeBytes ?? (async () => {
      const stats = await statfs(options.root)
      return stats.bavail * stats.bsize
    })
  }

  /** Read the last transactionally published environment pointer, if any. */
  async applied(): Promise<AppliedEnvironment | undefined> {
    try {
      return JSON.parse(await readFile(join(this.options.root, 'applied.json'), 'utf8')) as AppliedEnvironment
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  /**
   * Provision a declaration without changing the prior pointer on failure.
   * The environment is created directly at the prefix path it will be
   * published under and every health check runs against that same path:
   * Conda/micromamba installs are not relocatable (`bin/R`'s `R_HOME_DIR`,
   * Python console-script shebangs, and sysconfig entries all bake in the
   * install-time prefix), so a health check that passed at one path proves
   * nothing about a different published path. Readiness is decided solely by
   * `applied.json`: a prefix directory that exists without a matching
   * `applied.json` entry is not ready, so provisioning always starts by
   * clearing it, whether it is a stale partial install from an interrupted
   * run or leftover from a prior failed health check.
   */
  async provision(
    declaration: EnvironmentDeclaration,
    signal: AbortSignal,
    onProgress: (progress: ProvisioningProgress) => void = () => {},
  ): Promise<AppliedEnvironment> {
    if (!declaration.supportedPlatforms.includes(this.options.platform)) {
      throw new Error(`desktop provisioning: ${declaration.id} does not support ${this.options.platform}`)
    }
    await mkdir(this.options.root, { recursive: true, mode: 0o700 })
    onProgress({ phase: 'checking', message: 'Checking available disk space' })
    if (await this.#freeBytes() < declaration.requiredFreeBytes) {
      throw new Error(`desktop provisioning: ${declaration.name} needs ${String(declaration.requiredFreeBytes)} free bytes`)
    }
    const environments = join(this.options.root, 'environments')
    const prefix = join(environments, declaration.id, declaration.revision)
    await mkdir(join(environments, declaration.id), { recursive: true, mode: 0o700 })
    const applied = await this.applied()
    const alreadyPublished = applied !== undefined && applied.id === declaration.id
      && applied.revision === declaration.revision && applied.prefix === prefix
    if (!alreadyPublished) await rm(prefix, { recursive: true, force: true })
    onProgress({ phase: 'solving', message: `Resolving ${declaration.name} packages` })
    await this.#run({
      executable: this.options.micromambaPath,
      args: [
        'create', '--yes', '--no-rc', '--override-channels', '--prefix', prefix,
        ...declaration.channels.flatMap(channel => ['--channel', channel]),
        ...declaration.packages,
      ],
      env: { ...buildProvisioningEnv(), MAMBA_ROOT_PREFIX: join(this.options.root, 'micromamba') },
      signal,
      timeoutMs: declaration.timeoutMs,
      onLine: (line) => { onProgress({ phase: 'installing', message: line }) },
    })
    onProgress({ phase: 'verifying', message: 'Verifying Python and R' })
    for (const check of declaration.healthChecks) {
      await this.#run({
        executable: join(prefix, 'bin', check.executable),
        args: check.args,
        env: buildProvisioningEnv(),
        signal,
        timeoutMs: Math.min(declaration.timeoutMs, 120_000),
      })
    }
    onProgress({ phase: 'publishing', message: 'Publishing verified environment' })
    const published: AppliedEnvironment = {
      id: declaration.id,
      revision: declaration.revision,
      prefix,
      appliedAt: this.#now(),
    }
    const pointer = join(this.options.root, 'applied.json')
    await writeFile(`${pointer}.next`, `${JSON.stringify(published)}\n`, { mode: 0o600 })
    await rename(`${pointer}.next`, pointer)
    onProgress({ phase: 'ready', message: `${declaration.name} is ready` })
    return published
  }
}
