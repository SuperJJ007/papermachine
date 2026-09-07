/**
 * Type declarations for `native-module-targets.mjs`.
 *
 * Hand-written rather than generated: this module is plain JavaScript with
 * JSDoc types (see that file's own header comment for why), and TypeScript's
 * `bundler` module resolution only matches an `.mjs` import specifier
 * against a `.d.mts` declaration file of the same basename, never a `.d.ts`
 * one — `stage-host.ts` needs this file to typecheck its import.
 */

/** One parsed `node_modules/@img` or `node_modules/@koromix` directory name. */
export interface NativeModuleEntry {
  /** The directory's basename, unchanged. */
  readonly name: string
  /** Which native module family the name matched (`sharp`, `sharp-libvips`, or `koffi`). */
  readonly family: string
  /** The platform segment (`darwin`, `win32`, `linux`, …). */
  readonly os: string
  /** The architecture segment (`x64`, `arm64`, …). */
  readonly arch: string
}

/**
 * Parse one `node_modules/@img` or `node_modules/@koromix` directory name.
 * @param name - the directory's basename.
 * @returns the parsed family/os/arch, or `undefined` for a name that names
 *   no known native module family (for example `@img/colour`).
 */
export function parseNativeModuleEntry(name: string): NativeModuleEntry | undefined

/**
 * Split one scope directory's entries into what a packaging target keeps and
 * what it can discard.
 * @param target - the packaging target being built.
 * @param entries - directory basenames under one scope (`@img` or `@koromix`).
 * @returns the entries to keep and the entries to remove.
 * @throws when a family present in `entries` has no entry matching `target`.
 */
export function selectNativeModuleTargets(
  target: { readonly os: string, readonly arch: string },
  entries: readonly string[],
): { readonly keep: readonly string[], readonly remove: readonly string[] }
