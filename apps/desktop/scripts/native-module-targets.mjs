/**
 * Pure logic for the sharp/koffi native module directories that a desktop
 * packaging target keeps or discards.
 *
 * electron-builder's `afterPack` hook loads this file directly with Node's
 * ESM loader (never through tsx), so it cannot be a `.ts` module like every
 * other build script under `scripts/`. `vitest` also loads plain `.mjs`
 * directly, so this one file serves both the packaging hook and its unit
 * tests without a duplicate implementation; types are documented with JSDoc
 * instead of TypeScript syntax for the same reason.
 */

/**
 * The native module families each `node_modules` scope this carrier ships
 * always carries, longest-family-name first so
 * `sharp-libvips-darwin-arm64` parses as the `sharp-libvips` family rather
 * than truncating to `sharp`. This is fixed domain knowledge, not inferred
 * from which families happen to appear in a scope's own directory listing:
 * inferring it from the listing cannot tell "this scope never carries this
 * family" apart from "every entry of this family failed to install into
 * this scope", which is the same failure {@link selectNativeModuleTargets}
 * must catch one level down, at the `(family, os)` granularity — a scope
 * that lost every entry of its own required family (for example every
 * `@img/sharp-*` package failing to download) must fail exactly as loud as
 * a scope missing only one target's variant.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const SCOPE_FAMILIES = Object.freeze({
  '@img': Object.freeze(['sharp', 'sharp-libvips']),
  '@koromix': Object.freeze(['koffi']),
})

/**
 * `(family, os)` pairs this carrier never ships as a separate package, so
 * {@link selectNativeModuleTargets} must not require one. This is a fixed
 * list, not inferred from which `os` values happen to appear in `entries`:
 * inferring it from `entries` cannot tell "this family never ships for this
 * os" apart from "every entry of this family for this os is missing", which
 * is exactly the failure {@link selectNativeModuleTargets} exists to catch.
 * sharp's win32 build folds libvips into the same `@img/sharp-win32-*`
 * package; no separate `@img/sharp-libvips-win32-*` package exists at any
 * version.
 * @type {ReadonlyArray<{ readonly family: string, readonly os: string }>}
 */
const FAMILY_NOT_SHIPPED_FOR_OS = Object.freeze([
  { family: 'sharp-libvips', os: 'win32' },
])

/**
 * Whether `family` ships a separate package for `os` at all.
 * @param {string} family - a family named in {@link SCOPE_FAMILIES}.
 * @param {string} os - a platform segment (`darwin`, `win32`, `linux`, …).
 * @returns {boolean} false only for a pair listed in {@link FAMILY_NOT_SHIPPED_FOR_OS}.
 */
function familyShipsForOs(family, os) {
  return !FAMILY_NOT_SHIPPED_FOR_OS.some(exempt => exempt.family === family && exempt.os === os)
}

/**
 * @typedef {object} NativeModuleEntry
 * @property {string} name - the directory's basename, unchanged.
 * @property {string} family - which family named in {@link SCOPE_FAMILIES} matched.
 * @property {string} os - the platform segment (`darwin`, `win32`, `linux`, …).
 * @property {string} arch - the architecture segment (`x64`, `arm64`, …).
 */

/**
 * Parse one `node_modules/@img` or `node_modules/@koromix` directory name.
 * @param {string} name - the directory's basename.
 * @returns {NativeModuleEntry | undefined} the parsed family/os/arch, or
 *   `undefined` for a name that names no known native module family (for
 *   example `@img/colour`) — callers must leave those untouched.
 */
export function parseNativeModuleEntry(name) {
  // Longest family name first within each scope, same reasoning as
  // SCOPE_FAMILIES' own ordering: this flattened list only needs the
  // relative order between `sharp-libvips` and `sharp` preserved, since no
  // family name is a prefix of a family from the other scope.
  for (const families of Object.values(SCOPE_FAMILIES)) {
    for (const family of families) {
      if (!name.startsWith(`${family}-`)) continue
      const remainder = name.slice(family.length + 1)
      const match = /^([a-z0-9]+)-([a-z0-9]+)$/.exec(remainder)
      if (match === null) continue
      const [, os, arch] = match
      return { name, family, os, arch }
    }
  }
  return undefined
}

/**
 * Split one scope directory's entries into what a packaging target keeps and
 * what it can discard.
 *
 * Every family {@link SCOPE_FAMILIES} lists for `scope` must have an entry
 * matching `target` exactly, unless {@link FAMILY_NOT_SHIPPED_FOR_OS}
 * exempts it for `target.os`; otherwise this throws — including when
 * `entries` contains no entry of that family at all (an empty scope
 * directory, or one that lost every platform variant), not only when some
 * entries of it are missing. Which families a scope must carry is fixed
 * domain knowledge from {@link SCOPE_FAMILIES}, never inferred from which
 * families happen to appear in `entries`: an entries-inferred check cannot
 * tell "this scope never carries this family" apart from "every entry of
 * this family failed to install", which is exactly the failure this
 * function exists to catch. A name that parses to no known family
 * (`parseNativeModuleEntry` returns `undefined`) is always kept. A name
 * that parses to a known family but a different `(os, arch)` than `target`
 * is removed. A missing target variant means the workspace was installed
 * without `--os`/`--cpu`/`--libc` widened to cover every desktop packaging target
 * (see `apps/desktop/README.md`),
 * and packaging must fail loud rather than ship a Host that exits before
 * readiness on the missing import.
 * @param {string} scope - the `node_modules` scope `entries` was read from
 *   (`@img` or `@koromix`); selects which families from
 *   {@link SCOPE_FAMILIES} are required.
 * @param {{ readonly os: string, readonly arch: string }} target - the
 *   packaging target being built.
 * @param {readonly string[]} entries - directory basenames under `scope`.
 * @returns {{ readonly keep: readonly string[], readonly remove: readonly string[] }}
 * @throws when `scope` names no entry in {@link SCOPE_FAMILIES}, or when a
 *   family {@link SCOPE_FAMILIES} requires for `scope` and not exempted for
 *   `target.os` has no entry matching `target`.
 */
export function selectNativeModuleTargets(scope, target, entries) {
  const families = SCOPE_FAMILIES[scope]
  if (families === undefined) {
    throw new Error(`unknown native module scope ${scope} (expected one of ${Object.keys(SCOPE_FAMILIES).join(', ')})`)
  }
  const parsed = entries.map(name => ({ name, entry: parseNativeModuleEntry(name) }))
  for (const family of families) {
    if (!familyShipsForOs(family, target.os)) continue
    const sameOs = parsed.filter(({ entry }) => entry?.family === family && entry.os === target.os)
    const matchesTarget = sameOs.some(({ entry }) => entry?.arch === target.arch)
    if (matchesTarget) continue
    throw new Error(
      `no ${family}-${target.os}-${target.arch} entry for the ${target.os}-${target.arch} packaging target ` +
      (sameOs.length === 0
        ? `(no ${family} entry for ${target.os} at all)`
        : `(present for ${target.os}: ${sameOs.map(({ name }) => name).join(', ')})`),
    )
  }
  const keep = []
  const remove = []
  for (const { name, entry } of parsed) {
    if (entry === undefined || (entry.os === target.os && entry.arch === target.arch)) keep.push(name)
    else remove.push(name)
  }
  return { keep, remove }
}

/**
 * The suffix a per-platform-optionalDependency package name ends with,
 * outside the `@img`/`@koromix` families {@link selectNativeModuleTargets}
 * already handles precisely: `-<os>-<arch>`, optionally followed by a
 * toolchain/libc qualifier. This workspace's `pnpm-workspace.yaml` widens
 * `--os`/`--cpu`/`--libc` for desktop packaging's `pnpm install` step, and
 * every other native-binary package with per-platform variants (ripgrep,
 * `node-addon-require-builtin`, the Landlock launcher, and others) gets
 * every platform's variant staged into the Host closure alongside
 * sharp/koffi — not just those two families' own scopes.
 * @type {RegExp}
 */
const PLATFORM_VARIANT_SUFFIX = /-(darwin|win32|linux|linuxmusl)-(x64|arm64|ia32)(?:-(?:msvc|gnu|eabi|elf|musl))?$/

/**
 * @typedef {object} PlatformVariantEntry
 * @property {string} name - the entry as given, unchanged (an alias such as
 *   `@scope/package-name` for a scoped package, or a bare name).
 * @property {string} family - `name` with its platform-variant suffix
 *   removed; entries sharing a `family` are the same package's variants.
 * @property {string} os - the platform segment matched by {@link PLATFORM_VARIANT_SUFFIX}.
 * @property {string} arch - the architecture segment matched by {@link PLATFORM_VARIANT_SUFFIX}.
 */

/**
 * Recognize `name` as a per-platform-optionalDependency package variant.
 * @param {string} name - a `node_modules` entry, either a bare package name
 *   or a scoped alias (`@scope/package-name`).
 * @returns {PlatformVariantEntry | undefined} the parsed family/os/arch, or
 *   `undefined` when `name` does not end in {@link PLATFORM_VARIANT_SUFFIX}.
 */
export function parsePlatformVariantEntry(name) {
  const match = PLATFORM_VARIANT_SUFFIX.exec(name)
  if (match === null) return undefined
  const [suffix, os, arch] = match
  return { name, family: name.slice(0, name.length - suffix.length), os, arch }
}

/**
 * Select every per-platform-optionalDependency entry in `entries` that does
 * not belong to `target`, for families outside `@img`/`@koromix` (callers
 * exclude those scopes before calling this, since
 * {@link selectNativeModuleTargets} already prunes them with a fail-loud
 * guarantee this function does not provide).
 *
 * A family is only pruned when one of its entries actually matches `target`
 * — deliberately weaker than {@link selectNativeModuleTargets}: a package
 * this function does not recognize as belonging to `target` at all is left
 * alone rather than guessed at, since an unexpectedly narrow install here
 * only wastes packaged bytes, not a Host that exits before readiness, and a
 * wrong guess could delete a package's only variant.
 * @param {{ readonly os: string, readonly arch: string }} target - the
 *   packaging target being built.
 * @param {readonly string[]} entries - `node_modules` entries (bare names or
 *   `@scope/package-name` aliases) to consider, excluding `@img`/`@koromix`.
 * @returns {readonly string[]} the subset of `entries` to remove.
 */
export function selectForeignPlatformEntries(target, entries) {
  const byFamily = new Map()
  for (const name of entries) {
    const entry = parsePlatformVariantEntry(name)
    if (entry === undefined) continue
    const list = byFamily.get(entry.family) ?? []
    list.push({ name, entry })
    byFamily.set(entry.family, list)
  }
  const remove = []
  for (const variants of byFamily.values()) {
    const hasTarget = variants.some(({ entry }) => entry.os === target.os && entry.arch === target.arch)
    if (!hasTarget) continue
    for (const { name, entry } of variants) {
      if (entry.os !== target.os || entry.arch !== target.arch) remove.push(name)
    }
  }
  return remove
}
