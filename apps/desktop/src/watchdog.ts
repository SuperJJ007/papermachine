/** Plain-Node watchdog that collects the Host process group after Electron dies. */

const POLL_MS = 250

/** Whether a process id still names a live process visible to this user. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Stop one POSIX process group after its owning Electron process disappears. */
export async function watchParent(parentPid: number, hostPid: number): Promise<void> {
  while (isAlive(parentPid)) {
    await new Promise<void>(resolve => setTimeout(resolve, POLL_MS))
  }
  try {
    process.kill(-hostPid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
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
