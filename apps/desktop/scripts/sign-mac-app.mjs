/**
 * Ad-hoc deep-sign the packaged macOS app in `afterPack`, and verify the
 * result, so a downloaded copy reads to Gatekeeper as an app from an
 * unidentified developer rather than a damaged one.
 *
 * This repository's `electron-builder.yml` carries no `mac.identity`
 * certificate (Apple Developer ID enrollment is a separate, undecided
 * business decision), so electron-builder skips macOS code signing
 * entirely and the packaged `.app` keeps only the ad-hoc signature the
 * `Electron Framework` and helper binaries already carry from their own
 * link step. That signature does not cover the app's own bundle
 * resources, so `codesign --verify --deep --strict` on the unsigned
 * package reports `code has no resources but signature indicates they
 * must be present` — the exact condition Gatekeeper reports to a user as
 * "app is damaged and can't be opened", for which right-click-Open (the
 * fix for an unidentified-developer app) does nothing; only stripping the
 * quarantine attribute recovers it. Ad-hoc-signing the whole bundle
 * (`--sign -`) after packaging gives every resource a covering signature
 * without an Apple Developer ID, which downgrades the Gatekeeper verdict
 * to unidentified developer, where right-click-Open does work.
 * `--deep` is required, not optional, because `PaperMachine.app` bundles
 * nested executables (the packaged Host under `Contents/Resources/host`,
 * the app-local micromamba binary) that a shallow signature does not
 * cover; `codesign --verify --deep --strict` fails on any of them left
 * unsigned.
 *
 * This runs in `afterPack`, after every step that edits the bundle's
 * contents (the Host `node_modules` copy, native-module pruning), because
 * electron-builder's hook order is `afterPack` → code signing (skipped
 * here, no identity) → `afterSign` → DMG assembly: nothing between this
 * hook and the DMG touches the bundle again, so a signature applied here
 * is the final one the DMG ships.
 */
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

/** @typedef {(command: string, args: readonly string[]) => Promise<{ stdout: string, stderr: string }>} CodesignExecFile */

/** @type {CodesignExecFile} */
const defaultExecFile = promisify(execFileCallback)

/**
 * Ad-hoc deep-sign `appPath`, then verify the signature covers every
 * resource and nested executable.
 * @param appPath - absolute path to the packaged `.app` bundle.
 * @param {CodesignExecFile} [execFile] - injected in tests; defaults to a
 *   promisified `child_process.execFile` that actually runs `codesign`.
 * @returns nothing; resolves once verification passes.
 * @throws when either the sign or the verify invocation exits non-zero;
 *   the error message includes that invocation's stderr.
 */
export async function signMacApp(appPath, execFile = defaultExecFile) {
  await runCodesign(execFile, ['--force', '--deep', '--sign', '-', appPath], 'sign', appPath)
  await runCodesign(execFile, ['--verify', '--deep', '--strict', '--verbose=2', appPath], 'verify', appPath)
}

/**
 * Ad-hoc deep-sign the packaged app for one electron-builder `afterPack`
 * invocation, doing nothing when `electronPlatformName` names a target
 * `codesign` does not apply to (win32, linux).
 * @param electronPlatformName - electron-builder's platform name for this
 *   build (`darwin`, `win32`, or `linux`).
 * @param appPath - absolute path to the packaged `.app` bundle; only read
 *   when `electronPlatformName` is `darwin`.
 * @param {CodesignExecFile} [execFile] - forwarded to {@link signMacApp}.
 * @returns nothing; resolves once signing and verification pass, or
 *   immediately for a non-darwin target.
 */
export async function maybeSignMacApp(electronPlatformName, appPath, execFile = defaultExecFile) {
  if (electronPlatformName !== 'darwin') return
  await signMacApp(appPath, execFile)
}

/**
 * Run one `codesign` invocation, forwarding its stdout/stderr into the
 * build log and failing loud on a non-zero exit.
 * @param {CodesignExecFile} execFile - the exec function to run `codesign` through.
 * @param {readonly string[]} args - `codesign` argv, excluding the command name itself.
 * @param {string} step - `'sign'` or `'verify'`, named in a thrown error.
 * @param {string} appPath - the bundle path this step ran against, named in a thrown error.
 * @returns nothing; resolves once the invocation exits 0.
 * @throws an `Error` naming `step` and `appPath`, wrapping the underlying
 *   `codesign` failure and including its stderr, when the invocation exits
 *   non-zero.
 */
async function runCodesign(execFile, args, step, appPath) {
  let result
  try {
    result = await execFile('codesign', args)
  } catch (cause) {
    const stderr = cause !== null && typeof cause === 'object' && 'stderr' in cause ? cause.stderr : undefined
    const message = typeof stderr === 'string' && stderr.length > 0
      ? stderr
      : cause instanceof Error ? cause.message : String(cause)
    throw new Error(`after-pack: codesign ${step} failed for ${appPath}: ${message}`, { cause })
  }
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}
