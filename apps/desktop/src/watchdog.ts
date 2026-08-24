/** Plain-Node watchdog that collects the Host process group after Electron dies. */

const POLL_MS = 250
const GRACE_MS = 5_000

export interface WatchdogOptions {
  /** Interval between liveness polls. */
  readonly pollMs?: number
  /** Grace period after SIGTERM to the Host group before escalating to SIGKILL. */
  readonly graceMs?: number
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
 * Stop one POSIX process group once this watchdog's own OS parent stops
 * being `parentPid`. This process is spawned as a direct, never-reparented
 * child of Electron (`detached` only gives it its own session so Electron's
 * own process-group signal cannot take it down too; it does not change who
 * spawned it), so the kernel updates `process.ppid` the instant Electron
 * exits — reparenting this process to the platform's init (pid 1 on macOS).
 * That kernel-maintained fact distinguishes a genuinely dead parent from an
 * unrelated process later reusing the same pid, which a `kill(pid, 0)`
 * liveness probe on the original parent pid cannot; this watchdog therefore
 * polls `process.ppid` with no bound on its own lifetime; the poll costs
 * nothing for as long as Electron legitimately runs.
 * @param parentPid - this watchdog's original Electron parent pid.
 * @param hostPid - the Host process group leader to stop once `parentPid` is gone.
 * @param options - poll interval and grace period; both default to production values.
 */
export async function watchParent(parentPid: number, hostPid: number, options: WatchdogOptions = {}): Promise<void> {
  const pollMs = options.pollMs ?? POLL_MS
  const graceMs = options.graceMs ?? GRACE_MS
  while (process.ppid === parentPid) {
    await sleep(pollMs)
  }
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
