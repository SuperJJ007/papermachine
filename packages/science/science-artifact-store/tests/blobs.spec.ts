import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { admitBlob, readBlob } from '../src/blobs.ts'
import { ProjectArtifactStoreError } from '../src/errors.ts'

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-blobs-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('admitBlob', () => {
  it('admits bytes and returns their content address and byte count', async () => {
    const root = await makeRoot()
    const data = new TextEncoder().encode('artifact bytes')
    const admitted = await admitBlob(root, data)
    expect(admitted.sha256).toBe(digest(data))
    expect(admitted.byteCount).toBe(data.byteLength)
    const stored = await readFile(join(root, 'blobs', 'sha256', admitted.sha256.slice(0, 2), admitted.sha256))
    expect(new Uint8Array(stored)).toEqual(data)
  })

  it('is idempotent by hash: re-admitting identical bytes leaves the object unchanged', async () => {
    const root = await makeRoot()
    const data = new TextEncoder().encode('same content')
    const first = await admitBlob(root, data)
    const second = await admitBlob(root, data)
    expect(second.sha256).toBe(first.sha256)
    const stored = await readFile(join(root, 'blobs', 'sha256', first.sha256.slice(0, 2), first.sha256))
    expect(new Uint8Array(stored)).toEqual(data)
  })

  it('leaves no temp file behind after a successful admission', async () => {
    const root = await makeRoot()
    await admitBlob(root, new TextEncoder().encode('cleanup check'))
    const tmp = await readdir(join(root, 'blobs', 'tmp'))
    expect(tmp).toEqual([])
  })

  it('removes its temp file and rethrows when the final rename fails', async () => {
    const root = await makeRoot()
    const data = new TextEncoder().encode('rename failure')
    const sha256 = digest(data)
    // A real directory already occupying the content-addressed target path
    // makes rename() fail (EISDIR/ENOTDIR/EPERM depending on platform).
    const target = join(root, 'blobs', 'sha256', sha256.slice(0, 2), sha256)
    await mkdir(target, { recursive: true })

    await expect(admitBlob(root, data)).rejects.toBeInstanceOf(Error)
    const tmp = await readdir(join(root, 'blobs', 'tmp'))
    expect(tmp).toEqual([])
  })
})

describe('readBlob', () => {
  it('reads back exactly the admitted bytes', async () => {
    const root = await makeRoot()
    const data = new TextEncoder().encode('round trip')
    const { sha256 } = await admitBlob(root, data)
    const read = await readBlob(root, sha256)
    expect(read).toEqual(data)
  })

  it('throws BLOB_NOT_FOUND for a digest that was never admitted', async () => {
    const root = await makeRoot()
    await expect(readBlob(root, 'a'.repeat(64))).rejects.toMatchObject({
      code: 'BLOB_NOT_FOUND',
    } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('rethrows an unexpected filesystem error unwrapped', async () => {
    const root = await makeRoot()
    const sha256 = 'b'.repeat(64)
    // A directory at the object's path makes readFile fail with EISDIR, not ENOENT.
    await mkdir(join(root, 'blobs', 'sha256', sha256.slice(0, 2), sha256), { recursive: true })
    await expect(readBlob(root, sha256)).rejects.not.toBeInstanceOf(ProjectArtifactStoreError)
  })

  it('throws BLOB_CORRUPT when the stored bytes no longer match the digest', async () => {
    const root = await makeRoot()
    const data = new TextEncoder().encode('trustworthy bytes')
    const { sha256 } = await admitBlob(root, data)
    const objectPath = join(root, 'blobs', 'sha256', sha256.slice(0, 2), sha256)
    await chmod(objectPath, 0o600)
    await writeFile(objectPath, new TextEncoder().encode('tampered'))
    await expect(readBlob(root, sha256)).rejects.toMatchObject({
      code: 'BLOB_CORRUPT',
    } satisfies Partial<ProjectArtifactStoreError>)
  })
})
