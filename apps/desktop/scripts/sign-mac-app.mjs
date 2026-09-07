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
 * "app is damaged and can't be opened", recoverable only by stripping the
 * quarantine attribute (`xattr -dr com.apple.quarantine`), never by
 * right-click-Open. Ad-hoc-signing the whole bundle (`--sign -`) after
 * packaging gives every resource a covering signature without an Apple
 * Developer ID, which downgrades the Gatekeeper verdict to a plain
 * rejection: the user resolves it from System Settings → Privacy &
 * Security → "Open Anyway", or, on macOS releases before 15,
 * right-click-Open. `--deep` is required, not optional, because
 * `PaperMachine.app` bundles nested executables (the packaged Host under
 * `Contents/Resources/host`, the app-local micromamba binary) that a
 * shallow signature does not cover; `codesign --verify --deep --strict`
 * fails on any of them left unsigned.
 *
 * This runs in `afterPack`, after every step that edits the bundle's
 * contents (the Host `node_modules` copy, native-module pruning). It is
 * not, however, the last thing to touch the bundle: electron-builder's
 * real hook order is `afterPack` (this signature) → `sanityCheckPackage`
 * (read-only) → `@electron/fuses` flipping the requested fuse bits, which
 * rewrites `Contents/Frameworks/Electron Framework.framework/…/Electron
 * Framework` → electron-builder's own code-signing step (skipped here,
 * `mac.identity: null`) → `afterSign` → DMG assembly. A fuse flip that
 * changes any byte invalidates the signature this module applies;
 * `electron-builder.yml`'s `electronFuses.resetAdHocDarwinSignature: true`
 * makes `@electron/fuses` re-sign (ad-hoc, no verify) immediately after
 * flipping, so the signature the DMG ships is the one from that later
 * step, not from this one. This module's verify stays as the only
 * assertion in the chain — the fuse-flip resign carries none of its own.
 */
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

/** @typedef {(command: string, args: readonly string[]) => Promise<{ stdout: string, stderr: string }>} CodesignExecFile */

/** @type {CodesignExecFile} */
const defaultExecFile = promisify(execFileCallback)

/**
 * Ad-hoc deep-sign `appPath`, then verify the signature covers every
 * resource and nested executable.
 * @param {string} appPath - absolute path to the packaged `.app` bundle.
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
 * @param {string} electronPlatformName - electron-builder's platform name
 *   for this build; this repository packages only `darwin` and `win32`.
 * @param {string} appPath - absolute path to the packaged `.app` bundle;
 *   only read when `electronPlatformName` is `darwin`.
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
