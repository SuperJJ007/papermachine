/**
 * Content-addressed blob storage for one project: verbatim bytes admitted by
 * SHA-256 under `<storeRoot>/blobs/sha256/<hh>/<hash>`.
 * @module @deepseek-ai/dsh-science-artifact-store/blobs
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ProjectArtifactStoreError } from './errors.ts'

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function blobPath(storeRoot: string, sha256: string): string {
  return join(storeRoot, 'blobs', 'sha256', sha256.slice(0, 2), sha256)
}

/** Result of admitting one blob: its content address and byte count. */
export interface AdmittedBlob {
  readonly sha256: string
  readonly byteCount: number
}

/**
 * Admit verbatim bytes into the project's content-addressed blob store.
 * Written to a random-suffix temp file under `blobs/tmp` then renamed onto
 * the final content-addressed path; the rename atomically replaces an
 * existing target, which is always byte-identical for the same digest, so
 * admission is idempotent by hash without an existence pre-check.
 * @param storeRoot - absolute path to the project's store directory.
 * @param data - bytes to admit.
 * @returns the SHA-256 digest and byte count identifying the admitted blob.
 */
export async function admitBlob(storeRoot: string, data: Uint8Array): Promise<AdmittedBlob> {
  const sha256 = digest(data)
  const target = blobPath(storeRoot, sha256)
  const tmpDir = join(storeRoot, 'blobs', 'tmp')
  await mkdir(tmpDir, { recursive: true, mode: 0o700 })
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const temp = join(tmpDir, randomUUID())
  await writeFile(temp, data, { mode: 0o600 })
  try {
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  return { sha256, byteCount: data.byteLength }
}

/**
 * Read and digest-verify one content-addressed blob's raw bytes.
 * @param storeRoot - absolute path to the project's store directory.
 * @param sha256 - digest identifying the blob, from an already-validated version row.
 * @returns the verified bytes.
 * @throws {@link ProjectArtifactStoreError} with code `BLOB_NOT_FOUND` when the
 * object is missing, or `BLOB_CORRUPT` when its bytes no longer hash to `sha256`.
 */
export async function readBlob(storeRoot: string, sha256: string): Promise<Uint8Array> {
  const target = blobPath(storeRoot, sha256)
  let data: Uint8Array
  try {
    data = new Uint8Array(await readFile(target))
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProjectArtifactStoreError(`blob ${sha256} is missing from the store at "${storeRoot}"`, 'BLOB_NOT_FOUND', { cause: error })
    }
    throw error
  }
  if (digest(data) !== sha256) {
    throw new ProjectArtifactStoreError(`blob ${sha256} in the store at "${storeRoot}" failed integrity verification`, 'BLOB_CORRUPT')
  }
  return data
}

/**
 * Check whether one content-addressed blob exists on disk, without reading
 * or digest-verifying its bytes — used by reconciliation, which only needs
 * presence and byte count, never the content itself.
 * @param storeRoot - absolute path to the project's store directory.
 * @param sha256 - digest identifying the blob.
 * @returns the blob's on-disk byte count, or `undefined` when it is missing.
 */
export async function blobByteCount(storeRoot: string, sha256: string): Promise<number | undefined> {
  try {
    const stats = await stat(blobPath(storeRoot, sha256))
    return stats.size
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
