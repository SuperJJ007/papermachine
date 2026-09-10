/** Collect the detached Host group if Electron disappears before orderly teardown. */
import { watchParent } from './watchdog-parent.ts'
const parent = Number(process.argv[2])
const host = Number(process.argv[3])
if (!Number.isSafeInteger(parent) || parent <= 0 || !Number.isSafeInteger(host) || host <= 0) {
  throw new Error('desktop watchdog: parent and Host pids must be positive integers')
}
await watchParent(parent, host)
