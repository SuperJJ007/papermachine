/** Plain-Node watchdog that collects the Host process group after Electron dies. */

const POLL_MS = 250
const GRACE_MS = 5_000
// Sanity bound on this process's own lifetime, independent of how long
// Electron legitimately runs: if the parent pid is reused by an unrelated
// process before this watchdog observes its exit, `isAlive` would otherwise
// report the original parent as alive forever and this process would never
// exit. This bound only ever fires on that pid-reuse edge case.
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000

export interface WatchdogOptions {
  /** Interval between liveness polls. */
  readonly pollMs?: number
  /** Grace period after SIGTERM to the Host group before escalating to SIGKILL. */
  readonly graceMs?: number
  /** Upper bound on this function's total run time. */
  readonly maxLifetimeMs?: number
}

/** Whether a process id still names a live process visible to this user. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Whether the POSIX process group led by `pid` still has a live member. */
function isGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Signal the process group, tolerating a group that is already gone. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}

/**
 * Stop one POSIX process group after its owning Electron process disappears.
 * A single "not alive" sample is confirmed with one more poll before this
 * function acts, so a momentary pid-table glitch cannot trigger an early
 * signal; {@link WatchdogOptions.maxLifetimeMs} bounds the case where the
 * parent pid is reused by an unrelated process and never reads as dead, so
 * this watchdog cannot pin the Host process alive, or itself run, forever.
 * @param parentPid - the Electron process this watchdog outlives.
 * @param hostPid - the Host process group leader to stop once `parentPid` is gone.
 * @param options - poll interval, grace period, and total lifetime bound; all default to production values.
 */
export async function watchParent(parentPid: number, hostPid: number, options: WatchdogOptions = {}): Promise<void> {
  const pollMs = options.pollMs ?? POLL_MS
  const graceMs = options.graceMs ?? GRACE_MS
  const maxLifetimeMs = options.maxLifetimeMs ?? MAX_LIFETIME_MS
  const overallDeadline = Date.now() + maxLifetimeMs
  while (Date.now() < overallDeadline) {
    if (!isAlive(parentPid)) {
      await sleep(pollMs)
      if (!isAlive(parentPid)) break
      continue
    }
    await sleep(pollMs)
  }
  if (isAlive(parentPid)) return
  signalGroup(hostPid, 'SIGTERM')
  const graceDeadline = Date.now() + graceMs
  while (isGroupAlive(hostPid) && Date.now() < graceDeadline) {
    await sleep(pollMs)
  }
  if (isGroupAlive(hostPid)) signalGroup(hostPid, 'SIGKILL')
}

function positivePid(value: string | undefined, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`desktop watchdog: ${name} must be a positive process id`)
  }
  return parsed
}

if (import.meta.main) {
  await watchParent(
    positivePid(process.argv[2], 'parentPid'),
    positivePid(process.argv[3], 'hostPid'),
  )
}
