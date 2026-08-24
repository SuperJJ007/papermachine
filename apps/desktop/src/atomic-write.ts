/** Durable atomic file replacement shared by every desktop-owned pointer file (environment binding, applied environment). */

import { randomBytes } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'

/** Filesystem options for {@link writeFileAtomic}; `mode` is required so the permission decision stays visible at every call site. */
export interface WriteFileAtomicOptions {
  /** Permission bits stamped on the fresh temp inode and carried through the rename (subject to the process umask). */
  readonly mode: number
}

/**
 * Replace `filename` with `content` in one durable atomic step. The content
 * is written to a random-suffix sibling opened with exclusive create
 * (`wx`) so the write can neither follow a symlink planted at the temp path
 * nor reuse a stale temp file left by a prior crash, fsynced before the
 * rename so a crash between the write and the rename cannot leave the
 * destination filesystem without the durable write, then renamed over
 * `filename` — an atomic replace a reader always observes as either the
 * previous or the complete new content. On any failure the temp file is
 * removed and the failure rethrown. `filename`'s parent directory must
 * already exist.
 * @param filename - final path receiving the content.
 * @param content - complete next file content.
 * @param options - permission bits for the replacement inode.
 */
export async function writeFileAtomic(filename: string, content: string, options: WriteFileAtomicOptions): Promise<void> {
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    const handle = await open(temp, 'wx', options.mode)
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, filename)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
