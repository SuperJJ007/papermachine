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
 * Native module package name prefixes this carrier ships, longest first so
 * `sharp-libvips-darwin-arm64` parses as the `sharp-libvips` family rather
 * than truncating to `sharp`.
 * @type {readonly string[]}
 */
const NATIVE_MODULE_FAMILIES = Object.freeze(['sharp-libvips', 'sharp', 'koffi'])

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
 * @param {string} family - a {@link NATIVE_MODULE_FAMILIES} entry.
 * @param {string} os - a platform segment (`darwin`, `win32`, `linux`, …).
 * @returns {boolean} false only for a pair listed in {@link FAMILY_NOT_SHIPPED_FOR_OS}.
 */
function familyShipsForOs(family, os) {
  return !FAMILY_NOT_SHIPPED_FOR_OS.some(exempt => exempt.family === family && exempt.os === os)
}

/**
 * @typedef {object} NativeModuleEntry
 * @property {string} name - the directory's basename, unchanged.
 * @property {string} family - which entry in {@link NATIVE_MODULE_FAMILIES} matched.
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
  for (const family of NATIVE_MODULE_FAMILIES) {
    if (!name.startsWith(`${family}-`)) continue
    const remainder = name.slice(family.length + 1)
    const match = /^([a-z0-9]+)-([a-z0-9]+)$/.exec(remainder)
    if (match === null) continue
    const [, os, arch] = match
    return { name, family, os, arch }
  }
  return undefined
}

/**
 * Split one scope directory's entries into what a packaging target keeps and
 * what it can discard.
 *
 * A name that parses to no known family (`parseNativeModuleEntry` returns
 * `undefined`) is always kept. A name that parses to a known family but a
 * different `(os, arch)` than `target` is removed. A family present in
 * `entries` for ANY `os` (proving `entries` is a scope this family belongs
 * to at all — `@img`'s entries never include `koffi`, `@koromix`'s never
 * include `sharp`) must have an entry matching `target` exactly, unless
 * {@link FAMILY_NOT_SHIPPED_FOR_OS} exempts it for `target.os`; otherwise
 * this throws. A missing target variant means the workspace was installed
 * without `supportedArchitectures` covering every desktop packaging target,
 * and packaging must fail loud rather than ship a Host that exits before
 * readiness on the missing import — including when EVERY entry of that
 * family for `target.os` is missing, not only when some are: whether a
 * family ships for `target.os` at all is fixed domain knowledge, never
 * inferred from which `os` values happen to appear in `entries`, because
 * that inference cannot tell "this family never ships for this os" apart
 * from "every entry of this family for this os failed to install".
 * @param {{ readonly os: string, readonly arch: string }} target - the
 *   packaging target being built.
 * @param {readonly string[]} entries - directory basenames under one scope
 *   (`@img` or `@koromix`).
 * @returns {{ readonly keep: readonly string[], readonly remove: readonly string[] }}
 * @throws when a family present in `entries` and not exempted for
 *   `target.os` has no entry matching `target`.
 */
export function selectNativeModuleTargets(target, entries) {
  const parsed = entries.map(name => ({ name, entry: parseNativeModuleEntry(name) }))
  const familiesPresent = new Set(
    parsed.map(({ entry }) => entry?.family).filter(family => family !== undefined),
  )
  for (const family of familiesPresent) {
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
