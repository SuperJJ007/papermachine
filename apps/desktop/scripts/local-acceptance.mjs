/** Installed-app acceptance packaging without release credentials or publication. */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Resolve local packaging and reject accidental use for other platforms or production updates.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {string} platform - Target operating system.
 * @returns {boolean} Whether to build a local-only application.
 */
export function isLocalAcceptance(env = process.env, platform = env.DSH_DESKTOP_TARGET_PLATFORM ?? process.platform) {
  const value = env.DSH_DESKTOP_LOCAL_ACCEPTANCE
  if (value === undefined || value === '0') return false
  if (value !== '1') throw new Error('desktop local acceptance: DSH_DESKTOP_LOCAL_ACCEPTANCE must be 0 or 1')
  if (platform !== 'darwin' && platform !== 'win32') throw new Error('desktop local acceptance: only macOS and Windows are supported')
  if (env.DSH_DESKTOP_AUTO_UPDATE_ENV === 'production') {
    throw new Error('desktop local acceptance: production updates are forbidden')
  }
  return true
}

/**
 * Ad-hoc sign a writable seed executable before its pnpm digest is recomputed.
 * @param {string} path - Writable Mach-O copy.
 * @param {string} identifier - Stable code identifier.
 * @returns {Promise<void>} Resolves after successful signing.
 */
export async function signLocalSeedCode(path, identifier) {
  await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', identifier, '--timestamp=none', path])
}

/**
 * Verify the complete ad-hoc signature without requiring a release authority or Apple ticket.
 * @param {string} path - Seed executable or application bundle.
 * @returns {void}
 */
export function verifyLocalCode(path) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path])
}
