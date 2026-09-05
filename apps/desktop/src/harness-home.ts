/** Resolution of the Harness home: the directory `DSH_HOME` points at. */

import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Thrown by {@link resolveHarnessHome} when the resolved, canonical Harness
 * home path contains an ASCII space. `path` is the offending canonical path,
 * for callers that render a dedicated, restart-button-free error surface for
 * this specific startup configuration failure (unlike a Host crash, no
 * amount of restarting the Host fixes it).
 */
export class HarnessHomeSpaceError extends Error {
  constructor(readonly path: string) {
    super(
      `desktop: cannot use "${path}" as the Harness home because it contains a space — R cannot run with a space in its scratch TMPDIR. PaperMachine cannot run science kernels while your user home directory's path contains a space.`,
    )
    this.name = 'HarnessHomeSpaceError'
  }
}

/** @throws {@link HarnessHomeSpaceError} when `path` contains an ASCII space. */
function requireNoAsciiSpace(path: string): void {
  if (path.includes(' ')) throw new HarnessHomeSpaceError(path)
}

/**
 * Resolve and create the Harness home directory used for `DSH_HOME`,
 * deliberately independent of Electron's own `userData` directory (which
 * stays Electron-owned, holding only its cookies, caches, and similar
 * Electron state — untouched by this resolution).
 *
 * Precedence: `customHomeDir` (an explicit choice, for example from
 * onboarding directory selection or settings) over `process.env.PAPERMACHINE_HOME`,
 * over `process.env.DSH_HOME`, over the fixed default `<osHomeDir>/.papermachine`
 * when none of those is set.
 *
 * The science-runtime R probe and kernel both refuse to run with an ASCII
 * space anywhere in their scratch `TMPDIR`
 * (`packages/science/science-runtime/src/environment.ts:402`,
 * `kernel-process.ts:340`), and on macOS Electron's `userData` path
 * (`~/Library/Application Support/<app name>`) contains one, which made
 * every R kernel fail unconditionally on desktop. Resolving under the home
 * directory directly avoids that path segment; `osHomeDir`, `customHomeDir`,
 * and both environment variables can still name a path that contains a
 * space, which the checks below catch.
 *
 * The literal candidate path is checked before creating anything, so an
 * obviously space-containing candidate fails without any filesystem side
 * effect. Science Runtime itself derives every kernel and probe scratch
 * path from the canonical, `realpath`-resolved Harness home
 * (`scratch.ts`'s `rootForSession`), so a space-free literal path is not
 * sufficient by itself: a candidate that is, or sits under, a symlink whose
 * real target contains a space would pass the literal check and only fail
 * later, inside a kernel process. The directory is therefore also
 * canonicalized and re-checked after creation, and the canonical path —
 * not the literal one — is what `DSH_HOME` is set to.
 * @param osHomeDir - the OS user home directory (Electron's `app.getPath('home')`), used only when
 *   neither `customHomeDir` nor either environment variable is set.
 * @param customHomeDir - an explicit Harness home directory, taking precedence over both
 *   `PAPERMACHINE_HOME` and `DSH_HOME`.
 * @returns the absolute, canonical, already-created Harness home path.
 * @throws {@link HarnessHomeSpaceError} when the literal or canonical
 *   resolved path contains an ASCII space.
 */
export async function resolveHarnessHome(osHomeDir: string, customHomeDir?: string): Promise<string> {
  const envHome = process.env.PAPERMACHINE_HOME ?? process.env.DSH_HOME
  const candidate = customHomeDir !== undefined && customHomeDir.trim().length > 0
    ? customHomeDir.trim()
    : (envHome !== undefined && envHome.trim().length > 0 ? envHome.trim() : join(osHomeDir, '.papermachine'))
  requireNoAsciiSpace(candidate)
  await mkdir(candidate, { recursive: true, mode: 0o700 })
  const canonical = await realpath(candidate)
  requireNoAsciiSpace(canonical)
  return canonical
}
