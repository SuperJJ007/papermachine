/** Transactional micromamba provisioning for desktop discipline environments. */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'
import type { DesktopPlatform, EnvironmentDeclaration, EnvironmentSource } from './environment-declaration.ts'

type ProvisioningPhase = 'checking' | 'solving' | 'installing' | 'verifying' | 'publishing' | 'ready'

/** Bounded progress suitable for direct renderer projection. */
export interface ProvisioningProgress {
  readonly phase: ProvisioningPhase
  readonly message: string
  /**
   * The package source this update concerns: the source about to be, or
   * being, attempted during `solving`/`installing`, and the source that
   * ultimately succeeded during `verifying`/`publishing`/`ready`. Absent
   * only for `checking`, which precedes any source attempt. Telemetry
   * (`main.ts`'s `startProvisioning`) tracks the most recent value across
   * a run to report which source a failed or cancelled run was last
   * attempting.
   */
  readonly sourceId?: string
  /** Cumulative bytes downloaded for the current installation or package set. */
  readonly bytesDownloaded?: number
  /** Total bytes to download across the package set or current package. */
  readonly bytesTotal?: number
  /** Instantaneous download speed in bytes per second. */
  readonly speedBytesPerSec?: number
  /** Estimated time remaining in seconds until downloads complete. */
  readonly etaSeconds?: number
  /** Name of the package currently being downloaded, extracted, or linked. */
  readonly currentPackage?: string
  /** Completion percentage (0 to 100). */
  readonly percent?: number
  /** Which source attempt is running out of total fallback sources. */
  readonly retryAttempt?: { readonly index: number; readonly total: number }
}

export interface ParsedProgress {
  readonly currentPackage?: string
  readonly bytesDownloaded?: number
  readonly bytesTotal?: number
  readonly speedBytesPerSec?: number
  readonly etaSeconds?: number
  readonly percent?: number
}

function parseUnitMultiplier(unitStr?: string): number {
  if (!unitStr) return 1
  const u = unitStr.toUpperCase()
  if (u.startsWith('K')) return 1024
  if (u.startsWith('M')) return 1024 * 1024
  if (u.startsWith('G')) return 1024 * 1024 * 1024
  return 1
}

function parseSize(numStr: string, unitStr?: string): number | undefined {
  const n = parseFloat(numStr)
  if (Number.isNaN(n)) return undefined
  return Math.round(n * parseUnitMultiplier(unitStr))
}

/**
 * Parse micromamba console progress lines containing package names,
 * download sizes (e.g. `12.5MB / 25.0MB`), transfer speeds (`2.5MB/s`),
 * percentages, or extraction/linking status.
 */
export function parseMicromambaProgressLine(line: string): ParsedProgress {
  let bytesDownloaded: number | undefined
  let bytesTotal: number | undefined
  let speedBytesPerSec: number | undefined
  let etaSeconds: number | undefined
  let currentPackage: string | undefined
  let percent: number | undefined

  const percentMatch = line.match(/(\d+(?:\.\d+)?)%/)
  if (percentMatch && percentMatch[1] !== undefined) {
    percent = parseFloat(percentMatch[1])
  }

  const bytesMatch = line.match(/(\d+(?:\.\d+)?)\s*([KMGT]?i?B)?\s*\/\s*(\d+(?:\.\d+)?)\s*([KMGT]?i?B)?/i)
  if (bytesMatch && bytesMatch[1] !== undefined && bytesMatch[3] !== undefined) {
    const unit1 = bytesMatch[2] ?? bytesMatch[4]
    const unit2 = bytesMatch[4] ?? bytesMatch[2]
    bytesDownloaded = parseSize(bytesMatch[1], unit1)
    bytesTotal = parseSize(bytesMatch[3], unit2)
  }

  const speedMatch = line.match(/(\d+(?:\.\d+)?)\s*([KMGT]?i?B)?\/s/i)
  if (speedMatch && speedMatch[1] !== undefined) {
    speedBytesPerSec = parseSize(speedMatch[1], speedMatch[2])
  }

  if (bytesDownloaded !== undefined && bytesTotal !== undefined && speedBytesPerSec !== undefined && speedBytesPerSec > 0) {
    if (bytesTotal >= bytesDownloaded) {
      etaSeconds = Math.round((bytesTotal - bytesDownloaded) / speedBytesPerSec)
    }
  }

  const pkgActionMatch = line.match(/(?:Downloading|Extracting|Linking|Fetching)\s+([a-z0-9_\-.]+)/i)
  if (pkgActionMatch && pkgActionMatch[1] !== undefined) {
    currentPackage = pkgActionMatch[1]
  } else {
    const pkgLeadMatch = line.match(/^([a-z0-9_\-.]+)\s+.*(?:\d+%.*|\d+\s*[KMGT]?B)/i)
    if (pkgLeadMatch && pkgLeadMatch[1] !== undefined && !['download', 'extract', 'total', 'progress'].includes(pkgLeadMatch[1].toLowerCase())) {
      currentPackage = pkgLeadMatch[1]
    }
  }

  return {
    ...(bytesDownloaded !== undefined && { bytesDownloaded }),
    ...(bytesTotal !== undefined && { bytesTotal }),
    ...(speedBytesPerSec !== undefined && { speedBytesPerSec }),
    ...(etaSeconds !== undefined && { etaSeconds }),
    ...(currentPackage !== undefined && { currentPackage }),
    ...(percent !== undefined && { percent }),
  }
}

/** Published pointer to the only prefix desktop Runtime configuration may consume. */
export interface AppliedEnvironment {
  readonly id: string
  readonly revision: string
  readonly prefix: string
  readonly appliedAt: number
  /** The package source whose `create` attempt actually succeeded, for telemetry (`environment.installed`'s `sourceId`). */
  readonly sourceId: string
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

// Milliseconds a cancelled or timed-out provisioning child's process group is
// given to exit cooperatively after SIGTERM before this module escalates to
// a group SIGKILL, symmetric with HostProcessSupervisor.stop's own
// escalation.
const KILL_GRACE_MS = 5000

// Interval this module polls the child's process group for liveness during
// stopProcessGroup's grace period.
const STOP_POLL_MS = 100

// Milliseconds stopProcessGroup keeps polling after sending the group
// SIGKILL before giving up on confirming the group is actually gone.
// isProcessGroupAlive reports EPERM (for example, a pid reused across a
// privilege boundary) as alive with no way to distinguish that from a
// genuine survivor, so an unconfirmable group must not block its caller
// forever; this bound is the honest limit on how long that confirmation is
// worth waiting for.
const POST_SIGKILL_CONFIRM_MS = 5000

/** Signal the process group on POSIX and the direct child on Windows, tolerating a group that is already gone. */
function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** Whether the direct child or, on POSIX, any other member of its process group is still alive. */
function isProcessGroupAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) return false
  try {
    if (process.platform === 'win32') process.kill(child.pid, 0)
    else process.kill(-child.pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Stop the child's process group, escalating to a group SIGKILL if anything
 * in it is still alive after {@link KILL_GRACE_MS}. The direct child exiting
 * is not sufficient: a solve or health-check process that disposes itself on
 * SIGTERM while a spawned grandchild ignores it would otherwise leave that
 * grandchild alive forever, so the grace period polls the whole process
 * group's liveness rather than only the direct child's own exit — unlike
 * `HostProcessSupervisor.stop`, which awaits only the direct child's own
 * `exit` event once SIGKILL has been sent (bounded there because SIGKILL
 * cannot be ignored by the direct child itself), this does not mirror that
 * method's escalation. The returned promise settles once the group is
 * confirmed gone, or, after SIGKILL has been sent, rejects naming the pid
 * that may still be alive once {@link POST_SIGKILL_CONFIRM_MS} of continued
 * polling still cannot confirm the group is gone — an awaited caller that
 * would otherwise quit Electron must never hang on a group this module
 * cannot prove is dead.
 * @param child - the process whose group to stop.
 * @throws when SIGTERM/SIGKILL delivery fails for a reason other than the
 * group already being gone, or when the group cannot be confirmed dead
 * within {@link POST_SIGKILL_CONFIRM_MS} of the SIGKILL.
 */
export async function stopProcessGroup(child: ChildProcess): Promise<void> {
  signalProcessGroup(child, 'SIGTERM')
  const graceDeadline = Date.now() + KILL_GRACE_MS
  while (isProcessGroupAlive(child) && Date.now() < graceDeadline) {
    await new Promise(resolve => setTimeout(resolve, STOP_POLL_MS))
  }
  if (!isProcessGroupAlive(child)) return
  signalProcessGroup(child, 'SIGKILL')
  const confirmDeadline = Date.now() + POST_SIGKILL_CONFIRM_MS
  while (isProcessGroupAlive(child) && Date.now() < confirmDeadline) {
    await new Promise(resolve => setTimeout(resolve, STOP_POLL_MS))
  }
  if (isProcessGroupAlive(child)) {
    throw new Error(`desktop provisioning: process group ${String(child.pid)} may still be alive after SIGKILL`)
  }
}

/**
 * Run one cancellable child and reject on timeout, signal, or non-zero exit.
 * An ordinary exit settles the returned promise directly on the direct
 * child's own `exit` event. Cancellation and a timeout instead settle only
 * once {@link stopProcessGroup} settles — whether it resolves, having
 * confirmed the whole process group (not just the direct child) is gone, or
 * rejects because delivery failed or the group could not be confirmed dead —
 * so the returned promise always settles rather than hanging on
 * {@link stopProcessGroup}'s own bounded confirmation wait, and a caller
 * awaiting rejection before quitting Electron never leaves this escalation's
 * SIGKILL timer running past its own teardown.
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
    // Both handlers settle `finish` from either branch of stopProcessGroup's
    // outcome, so a signal-delivery failure or an unconfirmable group (see
    // stopProcessGroup's JSDoc) still settles this run instead of leaving it
    // pending forever behind an unhandled rejection.
    const abort = (): void => {
      outcome = 'cancelled'
      void stopProcessGroup(child).then(
        () => { finish(new Error('desktop provisioning: cancelled')) },
        (error: unknown) => { finish(error instanceof Error ? error : new Error(String(error))) },
      )
    }
    const timer = setTimeout(() => {
      outcome = 'timed-out'
      void stopProcessGroup(child).then(
        () => { finish(new Error('desktop provisioning: timed out')) },
        (error: unknown) => { finish(error instanceof Error ? error : new Error(String(error))) },
      )
    }, request.timeoutMs)
    for (const stream of [child.stdout, child.stderr]) {
      let pending = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        pending += chunk
        const lines = pending.split(/\r?\n|\r/u)
        pending = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.length > 0) request.onLine?.(trimmed.slice(0, 500))
        }
      })
    }
    child.once('error', (error) => { finish(error) })
    child.once('exit', (code, signal) => {
      // A cancelled or timed-out run settles only from stopProcessGroup's
      // own resolution above, once the whole group is confirmed gone; the
      // direct child's exit alone does not prove that.
      if (outcome === 'cancelled' || outcome === 'timed-out') return
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

/**
 * The provisioner root under a Harness home: `applied.json`, the
 * micromamba package cache, and every provisioned environment prefix live
 * here. Shared with `environment-binding.ts`'s
 * {@link isWithinProvisionedRoot}, so a binding naming a prefix outside this
 * root — a foreign conda-family environment from before this application
 * owned its environment outright — is recognised as no longer valid.
 * @param dshHome - the Harness home directory.
 */
export function desktopEnvironmentsRoot(dshHome: string): string {
  return join(dshHome, 'desktop-environments')
}

/**
 * The directory under the provisioner root holding every provisioned
 * environment's prefix, keyed by declaration id and revision
 * (`environments/<id>/<revision>`).
 * @param root - the provisioner root, {@link desktopEnvironmentsRoot}.
 */
export function provisionedEnvironmentsDirectory(root: string): string {
  return join(root, 'environments')
}

/**
 * Order `sources` for one provisioning run: `preferredId`, if given and
 * matches a source, moves to the front; every other source keeps its
 * existing relative order behind it. Provisioning tries each source in this
 * order as a whole, independent `create` attempt (see
 * {@link EnvironmentDeclaration.sources}) — this decides only where the run
 * starts, never which sources are tried or skipped.
 * @param sources - the declaration's ordered sources.
 * @param preferredId - the source id to start from; `undefined` or an id
 *   absent from `sources` leaves the order unchanged.
 * @returns `sources` reordered to start from `preferredId`.
 */
export function orderSourcesFrom(
  sources: readonly EnvironmentSource[],
  preferredId: string | undefined,
): readonly EnvironmentSource[] {
  if (preferredId === undefined) return sources
  const preferred = sources.find(source => source.id === preferredId)
  if (preferred === undefined) return sources
  return [preferred, ...sources.filter(source => source.id !== preferredId)]
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
   * run or leftover from a prior failed health check. Re-provisioning the
   * exact revision `applied.json` already names (the same-revision repair
   * path) clears that pointer before touching the prefix: creating
   * over a live prefix in place would otherwise leave a destroyed
   * environment advertised as `current` if the recreate fails partway
   * through, and clearing the pointer first turns that failure into an
   * honest not-ready status that routes back to onboarding instead.
   *
   * `declaration.sources`, reordered to start from `preferredSourceId` (see
   * {@link orderSourcesFrom}), are tried in order as whole `create`
   * attempts: a source that fails for any reason — network unreachable, a
   * bad package spec, anything — is abandoned entirely and the next source
   * is tried against a freshly cleared prefix, never merged into the same
   * attempt's channel list. Cancellation during a `create` attempt is not
   * retried; it propagates immediately. The last source's error is thrown
   * only once every source has failed.
   * @param preferredSourceId - the source id to try first; `undefined` or
   *   an id absent from `declaration.sources` starts from that list's own order.
   */
  async provision(
    declaration: EnvironmentDeclaration,
    signal: AbortSignal,
    onProgress: (progress: ProvisioningProgress) => void = () => {},
    preferredSourceId?: string,
  ): Promise<AppliedEnvironment> {
    if (!declaration.supportedPlatforms.includes(this.options.platform)) {
      throw new Error(`desktop provisioning: ${declaration.id} does not support ${this.options.platform}`)
    }
    await mkdir(this.options.root, { recursive: true, mode: 0o700 })
    onProgress({ phase: 'checking', message: 'Checking available disk space' })
    if (await this.#freeBytes() < declaration.requiredFreeBytes) {
      throw new Error(`desktop provisioning: ${declaration.name} needs ${String(declaration.requiredFreeBytes)} free bytes`)
    }
    const environments = provisionedEnvironmentsDirectory(this.options.root)
    const prefix = join(environments, declaration.id, declaration.revision)
    await mkdir(join(environments, declaration.id), { recursive: true, mode: 0o700 })
    const applied = await this.applied()
    const alreadyPublished = applied !== undefined && applied.id === declaration.id
      && applied.revision === declaration.revision && applied.prefix === prefix
    if (alreadyPublished) await rm(join(this.options.root, 'applied.json'), { force: true })
    const attempts = orderSourcesFrom(declaration.sources, preferredSourceId)
    let lastError: unknown
    let succeededSourceId: string | undefined
    const logRingBuffer: string[] = []
    const recordLog = (line: string): void => {
      if (logRingBuffer.length >= 200) logRingBuffer.shift()
      logRingBuffer.push(line)
    }

    for (const [index, source] of attempts.entries()) {
      await rm(prefix, { recursive: true, force: true })
      onProgress({
        phase: 'solving',
        message: index === 0
          ? `Resolving ${declaration.name} packages via ${source.name}`
          : `Retrying via ${source.name} (source ${String(index + 1)} of ${String(attempts.length)})`,
        sourceId: source.id,
        retryAttempt: { index: index + 1, total: attempts.length },
      })
      try {
        await this.#run({
          executable: this.options.micromambaPath,
          args: [
            'create', '--yes', '--no-rc', '--override-channels', '--prefix', prefix,
            ...source.channels.flatMap(channel => ['--channel', channel]),
            ...declaration.packages,
          ],
          env: { ...buildProvisioningEnv(), MAMBA_ROOT_PREFIX: join(this.options.root, 'micromamba') },
          signal,
          timeoutMs: declaration.timeoutMs,
          onLine: (line) => {
            recordLog(line)
            const parsed = parseMicromambaProgressLine(line)
            onProgress({
              phase: 'installing',
              message: line,
              sourceId: source.id,
              ...parsed,
              retryAttempt: { index: index + 1, total: attempts.length },
            })
          },
        })
        succeededSourceId = source.id
        break
      } catch (error) {
        lastError = error
        if (signal.aborted) throw error
      }
    }
    if (succeededSourceId === undefined) {
      const recentLogs = logRingBuffer.slice(-200)
      const baseMessage = lastError instanceof Error ? lastError.message : String(lastError)
      const logSummary = recentLogs.length > 0 ? `\n\nLast ${String(recentLogs.length)} log lines:\n${recentLogs.join('\n')}` : ''
      const failureError = new Error(`${baseMessage}${logSummary}`)
      ;(failureError as unknown as { recentLogs: readonly string[] }).recentLogs = recentLogs
      throw failureError
    }
    onProgress({ phase: 'verifying', message: 'Verifying Python and R', sourceId: succeededSourceId })
    for (const check of declaration.healthChecks) {
      await this.#run({
        executable: join(prefix, 'bin', check.executable),
        args: check.args,
        env: buildProvisioningEnv(),
        signal,
        timeoutMs: Math.min(declaration.timeoutMs, 120_000),
      })
    }
    onProgress({ phase: 'publishing', message: 'Publishing verified environment', sourceId: succeededSourceId })
    const published: AppliedEnvironment = {
      id: declaration.id,
      revision: declaration.revision,
      prefix,
      appliedAt: this.#now(),
      sourceId: succeededSourceId,
    }
    await writeFileAtomic(join(this.options.root, 'applied.json'), `${JSON.stringify(published)}\n`, { mode: 0o600 })
    onProgress({ phase: 'ready', message: `${declaration.name} is ready`, sourceId: succeededSourceId })
    return published
  }
}
