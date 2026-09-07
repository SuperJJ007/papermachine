/**
 * Type declarations for `sign-mac-app.mjs`.
 *
 * Hand-written rather than generated: this module is plain JavaScript with
 * JSDoc types (electron-builder's `afterPack` hook loads `after-pack.mjs`
 * directly through Node's ESM loader, never through `tsx`, so everything it
 * imports must stay loadable the same way), and TypeScript's `bundler`
 * module resolution only matches an `.mjs` import specifier against a
 * `.d.mts` declaration file of the same basename, never a `.d.ts` one —
 * `tests/sign-mac-app.spec.ts` needs this file to typecheck its import.
 */

/** Injected `codesign` invocation, matching a promisified `child_process.execFile`. */
export type CodesignExecFile = (
  command: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string, readonly stderr: string }>

/**
 * Ad-hoc deep-sign `appPath`, then verify the signature covers every
 * resource and nested executable.
 * @param appPath - absolute path to the packaged `.app` bundle.
 * @param execFile - injected in tests; defaults to a promisified
 *   `child_process.execFile` that actually runs `codesign`.
 * @returns nothing; resolves once verification passes.
 * @throws when either the sign or the verify invocation exits non-zero;
 *   the error message includes that invocation's stderr.
 */
export function signMacApp(appPath: string, execFile?: CodesignExecFile): Promise<void>

/**
 * Ad-hoc deep-sign the packaged app for one electron-builder `afterPack`
 * invocation, doing nothing when `electronPlatformName` names a target
 * `codesign` does not apply to (win32, linux).
 * @param electronPlatformName - electron-builder's platform name for this
 *   build; this repository packages only `darwin` and `win32`.
 * @param appPath - absolute path to the packaged `.app` bundle; only read
 *   when `electronPlatformName` is `darwin`.
 * @param execFile - forwarded to {@link signMacApp}.
 * @returns nothing; resolves once signing and verification pass, or
 *   immediately for a non-darwin target.
 */
export function maybeSignMacApp(
  electronPlatformName: string,
  appPath: string,
  execFile?: CodesignExecFile,
): Promise<void>
