/**
 * Type declarations for `native-module-targets.mjs`.
 *
 * Hand-written rather than generated: this module is plain JavaScript with
 * JSDoc types (see that file's own header comment for why), and TypeScript's
 * `bundler` module resolution only matches an `.mjs` import specifier
 * against a `.d.mts` declaration file of the same basename, never a `.d.ts`
 * one — `stage-host.ts` needs this file to typecheck its import.
 */

/**
 * The `node_modules` scopes this module's fixed family table covers
 * (`@img`, `@koromix`) — the authoritative list of which scopes every
 * packaging step must require and prune.
 */
export const NATIVE_MODULE_SCOPES: readonly string[]

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
 * @param scope - the `node_modules` scope `entries` was read from (`@img`
 *   or `@koromix`); selects which native module families are required.
 * @param target - the packaging target being built.
 * @param entries - directory basenames under `scope`.
 * @returns the entries to keep and the entries to remove.
 * @throws when `scope` names no known scope, or when a family required for
 *   `scope` and not exempted for `target.os` has no entry matching `target`
 *   — including when `entries` contains no entry of that family at all.
 */
export function selectNativeModuleTargets(
  scope: string,
  target: { readonly os: string, readonly arch: string },
  entries: readonly string[],
): { readonly keep: readonly string[], readonly remove: readonly string[] }

/** One parsed per-platform-optionalDependency package variant outside `@img`/`@koromix`. */
export interface PlatformVariantEntry {
  /** The entry as given, unchanged (a bare name or a `@scope/package-name` alias). */
  readonly name: string
  /** `name` with its platform-variant suffix removed. */
  readonly family: string
  /** The platform segment (`darwin`, `win32`, `linux`, `linuxmusl`). */
  readonly os: string
  /** The architecture segment (`x64`, `arm64`, `ia32`). */
  readonly arch: string
}

/**
 * Recognize `name` as a per-platform-optionalDependency package variant
 * outside `@img`/`@koromix` (ripgrep, `node-addon-require-builtin`, and others).
 * @param name - a `node_modules` entry, either a bare package name or a
 *   scoped alias (`@scope/package-name`).
 * @returns the parsed family/os/arch, or `undefined` when `name` does not
 *   end in a recognized platform-variant suffix.
 */
export function parsePlatformVariantEntry(name: string): PlatformVariantEntry | undefined

/**
 * Select every per-platform-optionalDependency entry in `entries` that does
 * not belong to `target`, for families outside `@img`/`@koromix`. A family
 * with no entry matching `target` is left untouched entirely, rather than
 * guessed at.
 * @param target - the packaging target being built.
 * @param entries - `node_modules` entries (bare names or `@scope/package-name`
 *   aliases) to consider, excluding `@img`/`@koromix`.
 * @returns the subset of `entries` to remove.
 */
export function selectForeignPlatformEntries(
  target: { readonly os: string, readonly arch: string },
  entries: readonly string[],
): readonly string[]
