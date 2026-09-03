/**
 * Bounded artifact-directory walk and bounded file reads for auto-capture
 * (`capture.ts`). Curation remains metadata-only, but its not-found path
 * reuses the safe walk to identify a retained, uncaptured PNG and return an
 * actionable diagnostic without reading or importing its bytes.
 */

import { Buffer } from 'node:buffer'
import { open, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Hard ceiling on entries walked before truncation, independent of any caller-configured bound. */
const WALK_HARD_CAP = 10_000

/**
 * Collect every regular non-symlink file below `root`, never descending
 * through a symlinked directory, up to a hard walk cap independent of the
 * caller's configured bounds.
 * @param root - the run's artifact directory.
 * @returns every safe relative path found, in encounter order (unsorted).
 */
export async function walkArtifactFiles(root: string): Promise<string[]> {
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
 * Read a file's bytes, capped at `maxBytes + 1`. This bound is only a
 * memory guard against an oversized artifact file — the attachment store
 * remains the sole authority for the configured byte, pixel, decoded-media,
 * and media-type admission rules, and correctly rejects the returned bytes
 * as too large whenever the real file exceeds `maxBytes`.
 * @param path - the canonical Host path of the artifact file.
 * @param maxBytes - the caller's configured byte bound.
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
