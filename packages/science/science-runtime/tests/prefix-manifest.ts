/** Lstat-only Conda-prefix manifests for fake and opt-in real acceptance. */

import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** One lstat-observed prefix entry; atime is deliberately not retained. */
export interface PrefixManifestEntry {
  /** POSIX-relative path, with `.` naming the observed prefix root. */
  readonly path: string
  /** Lstat kind without following a symbolic link. */
  readonly type: 'directory' | 'file' | 'symlink' | 'other'
  /** Octal permission and special bits from the lstat record. */
  readonly mode: string
  /** Byte size from the lstat record. */
  readonly size: string
  /** Nanoseconds since Unix epoch from the lstat record. */
  readonly mtimeNs: string
  /** Nanoseconds since Unix epoch from the lstat record. */
  readonly ctimeNs: string
  /** Link target retained without resolving it. */
  readonly symlinkTarget?: string
  /** SHA-256 of a regular file's exact bytes. */
  readonly sha256?: string
}

/** One observable before/after difference in a prefix manifest. */
export interface PrefixManifestDifference {
  /** Relative path whose observed entry changed. */
  readonly path: string
  /** Entry before an operation, if it existed. */
  readonly before?: PrefixManifestEntry
  /** Entry after an operation, if it existed. */
  readonly after?: PrefixManifestEntry
}

/** Render an lstat mode without putting a non-JSON bigint into a report. */
function modeString(mode: bigint): string {
  return `0o${(mode & 0o7777n).toString(8).padStart(4, '0')}`
}

/** Read one lstat entry without following a final symlink. */
async function manifestEntry(root: string, path: string): Promise<PrefixManifestEntry> {
  const info = await lstat(path, { bigint: true })
  const relativePath = relative(root, path) || '.'
  const common = {
    path: relativePath,
    mode: modeString(info.mode),
    size: String(info.size),
    mtimeNs: String(info.mtimeNs),
    ctimeNs: String(info.ctimeNs),
  }
  if (info.isSymbolicLink()) {
    return { ...common, type: 'symlink', symlinkTarget: await readlink(path) }
  }
  if (info.isFile()) {
    return {
      ...common,
      type: 'file',
      sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    }
  }
  if (info.isDirectory()) return { ...common, type: 'directory' }
  return { ...common, type: 'other' }
}

/** Recursively record a prefix without following any symlink. */
async function visit(root: string, path: string, entries: Map<string, PrefixManifestEntry>): Promise<void> {
  const entry = await manifestEntry(root, path)
  entries.set(entry.path, entry)
  if (entry.type !== 'directory') return
  const children = await readdir(path)
  for (const child of children.sort((first, second) => first.localeCompare(second))) {
    await visit(root, join(path, child), entries)
  }
}

/**
 * Capture a recursive immutable prefix manifest without resolving symlinks.
 * @param prefix - Existing configured Conda prefix to observe.
 * @returns Map keyed by POSIX-relative path.
 */
export async function capturePrefixManifest(prefix: string): Promise<ReadonlyMap<string, PrefixManifestEntry>> {
  const entries = new Map<string, PrefixManifestEntry>()
  await visit(prefix, prefix, entries)
  return entries
}

/**
 * Compare two exact lstat manifests in stable relative-path order.
 * @param before - Prefix facts captured before an operation.
 * @param after - Prefix facts captured after an operation.
 * @returns Every added, removed, or changed observed entry.
 */
export function diffPrefixManifest(
  before: ReadonlyMap<string, PrefixManifestEntry>,
  after: ReadonlyMap<string, PrefixManifestEntry>,
): readonly PrefixManifestDifference[] {
  const paths = new Set([...before.keys(), ...after.keys()])
  return [...paths].sort((first, second) => first.localeCompare(second)).flatMap((path) => {
    const previous = before.get(path)
    const next = after.get(path)
    if (JSON.stringify(previous) === JSON.stringify(next)) return []
    return [{
      path,
      ...(previous === undefined ? {} : { before: previous }),
      ...(next === undefined ? {} : { after: next }),
    }]
  })
}
