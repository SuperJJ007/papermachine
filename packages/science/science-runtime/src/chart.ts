/** Chart artifact-path validation and bounded safe-listing for `save_chart`. */

import { Buffer } from 'node:buffer'
import { lstat, open, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { canonicalWithin } from './scratch.ts'
import { ScienceRuntimeError } from './types.ts'

/** Longest accepted `artifact_path` value. */
export const MAX_ARTIFACT_PATH_LENGTH = 4096

/** Hard ceiling on entries walked before truncation, independent of the configured diagnostic bounds. */
const WALK_HARD_CAP = 10_000

/**
 * Reject a syntactically unsafe artifact-relative path before any
 * filesystem access: forward-slash segments only, no empty/`.`/`..`
 * segment, no NUL, no backslash, and no absolute, drive, or UNC form.
 * @param path - the model-supplied `artifact_path`.
 * @throws {@link ScienceRuntimeError} (`INVALID_REQUEST`) for a malformed path.
 */
export function validateArtifactPathSyntax(path: string): void {
  if (path.length === 0 || path.length > MAX_ARTIFACT_PATH_LENGTH) {
    throw new ScienceRuntimeError('INVALID_REQUEST', `artifact_path must be 1-${String(MAX_ARTIFACT_PATH_LENGTH)} characters`)
  }
  if (path.includes('\0')) {
    throw new ScienceRuntimeError('INVALID_REQUEST', 'artifact_path must not contain NUL')
  }
  if (path.includes('\\')) {
    throw new ScienceRuntimeError('INVALID_REQUEST', 'artifact_path must use forward-slash segments only')
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new ScienceRuntimeError('INVALID_REQUEST', 'artifact_path must be relative, not an absolute or drive/UNC form')
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new ScienceRuntimeError('INVALID_REQUEST', 'artifact_path must not contain an empty, ".", or ".." segment')
    }
  }
}

/** One safe relative path collected while walking an artifact directory. */
interface WalkResult {
  readonly entries: readonly string[]
  readonly omitted: number
}

/**
 * Collect every regular non-symlink file below `root`, never descending
 * through a symlinked directory, up to a hard walk cap independent of the
 * caller's configured diagnostic bounds.
 * @param root - the run's artifact directory.
 * @returns every safe relative path found, in encounter order (unsorted).
 */
async function walkArtifactFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (dir: string): Promise<void> => {
    let children
    try {
      children = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of children) {
      if (found.length >= WALK_HARD_CAP) return
      if (child.isSymbolicLink()) continue
      const full = join(dir, child.name)
      if (child.isDirectory()) {
        await visit(full)
        continue
      }
      /* v8 ignore next -- a device, socket, or FIFO entry; a Science artifact directory holds only files and directories in practice */
      if (!child.isFile()) continue
      found.push(relative(root, full).split(sep).join('/'))
    }
  }
  await visit(root)
  return found
}

/**
 * Build the sorted, bounded safe relative-path listing named in an
 * artifact-selection diagnostic.
 * @param root - the run's artifact directory.
 * @param maxEntries - validated Runtime config bound on listed entries.
 * @param maxBytes - validated Runtime config bound on the listing's UTF-8 bytes.
 * @returns the bounded sorted listing and how many further entries were omitted.
 */
export async function listArtifactEntries(root: string, maxEntries: number, maxBytes: number): Promise<WalkResult> {
  const all = (await walkArtifactFiles(root)).sort()
  const bounded: string[] = []
  let bytes = 0
  for (const path of all) {
    if (bounded.length >= maxEntries) break
    const size = Buffer.byteLength(path, 'utf8') + 1
    if (bytes + size > maxBytes) break
    bounded.push(path)
    bytes += size
  }
  return { entries: bounded, omitted: all.length - bounded.length }
}

/** Render the diagnostic message for a failed artifact selection. */
function artifactDiagnosticMessage(requested: string, listing: WalkResult): string {
  const lines = [`artifact_path ${JSON.stringify(requested)} does not name a regular file in this run's artifact directory.`]
  if (listing.entries.length === 0) {
    lines.push('The artifact directory has no eligible files.')
  } else {
    lines.push(`Available: ${listing.entries.join(', ')}.`)
    if (listing.omitted > 0) lines.push(`(${String(listing.omitted)} further entries omitted.)`)
  }
  return lines.join(' ')
}

/**
 * Resolve one requested artifact-relative path to its canonical Host
 * location: syntactically safe, an existing regular non-symlink file, and
 * canonically contained by the run's artifact directory.
 * @param runArtifacts - the source run's private Host artifact directory.
 * @param requested - the model-supplied `artifact_path`.
 * @param diagnosticMaxEntries - validated Runtime config bound on listed entries.
 * @param diagnosticMaxBytes - validated Runtime config bound on the listing's UTF-8 bytes.
 * @returns the canonical Host path of the requested file.
 * @throws {@link ScienceRuntimeError} (`ARTIFACT_NOT_FOUND`) with a bounded
 *   safe-listing diagnostic when selection fails.
 */
export async function resolveArtifactFile(
  runArtifacts: string,
  requested: string,
  diagnosticMaxEntries: number,
  diagnosticMaxBytes: number,
): Promise<string> {
  validateArtifactPathSyntax(requested)
  const candidate = join(runArtifacts, ...requested.split('/'))
  const fail = async (cause?: unknown): Promise<never> => {
    const listing = await listArtifactEntries(runArtifacts, diagnosticMaxEntries, diagnosticMaxBytes)
    throw new ScienceRuntimeError('ARTIFACT_NOT_FOUND', artifactDiagnosticMessage(requested, listing), { cause })
  }
  let entry
  try {
    entry = await lstat(candidate)
  } catch (error) {
    return fail(error)
  }
  if (!entry.isFile() || entry.isSymbolicLink()) return fail()
  try {
    return await canonicalWithin(runArtifacts, candidate)
  } catch (error) {
    return fail(error)
  }
}

/**
 * Read a file's bytes, capped at `maxBytes + 1`. This bound is only a
 * memory guard against an oversized artifact file — `ctx.attachments.saveImage`
 * remains the sole authority for the configured byte, pixel, decoded-media,
 * and media-type admission rules, and correctly rejects the returned bytes
 * as too large whenever the real file exceeds `maxBytes`.
 * @param path - the canonical Host path of the resolved artifact file.
 * @param maxBytes - the deployment's configured `maxImageBytes` limit.
 * @returns up to `maxBytes + 1` bytes read from the start of the file.
 */
export async function readBoundedFile(path: string, maxBytes: number): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const cap = maxBytes + 1
    const buffer = Buffer.allocUnsafe(cap)
    let total = 0
    while (total < cap) {
      const { bytesRead } = await handle.read(buffer, total, cap - total, null)
      if (bytesRead === 0) break
      total += bytesRead
    }
    return new Uint8Array(buffer.subarray(0, total))
  } finally {
    await handle.close()
  }
}
