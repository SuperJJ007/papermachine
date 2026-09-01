/**
 * Host launch orchestration for the port it binds: prefer the port last
 * remembered for this Harness home, falling back to an OS-assigned port
 * (`0`) when the remembered one is unavailable. Kept apart from `main.ts` so
 * the retry/record decision is testable without Electron.
 */

import { readRememberedHostPort, writeRememberedHostPort } from './host-port.ts'

/** Launches the Host once on the given port (`0` requests an OS-assigned one); resolves with the loopback URL the ready Host reported. */
export type HostLaunchAttempt = (port: number) => Promise<URL>

/**
 * Launch the Host, preferring the port last remembered for `dshHome`.
 *
 * The Host reports no bind failure this carrier can distinguish from any
 * other startup failure: a taken port and every other startup failure both
 * surface identically, as the child process exiting before it prints its
 * readiness line (`host-process.ts`'s `HostProcessSupervisor.start` rejects
 * with the same generic "exited before readiness" error either way). A
 * remembered-port failure is therefore not diagnosed — `attempt` is simply
 * retried once more on an OS-assigned port. A first launch, with no
 * remembered port yet, requests `0` directly with no retry.
 *
 * The port the Host actually reports is recorded afterward, never the port
 * that was requested: the two differ exactly in the fallback case this
 * function exists to handle, so recording the request instead would keep
 * remembering an unavailable port forever.
 * @param dshHome - the Harness home the remembered port is scoped to.
 * @param attempt - launches the Host once on the given port.
 * @returns the loopback URL the ready Host reported.
 * @throws whatever `attempt` throws on its final try: the fallback attempt
 *   when a remembered port was used, otherwise the only attempt.
 */
export async function launchHostOnRememberedPort(dshHome: string, attempt: HostLaunchAttempt): Promise<URL> {
  const rememberedPort = await readRememberedHostPort(dshHome)
  const url = rememberedPort === undefined
    ? await attempt(0)
    : await attempt(rememberedPort).catch(async () => attempt(0))
  await writeRememberedHostPort(dshHome, Number(url.port))
  return url
}
