/**
 * `walkArtifactFiles` and `readBoundedFile`: the bounded artifact-directory
 * walk and bounded file reads auto-capture (`capture.spec.ts`) exercises
 * end-to-end. This suite covers their own edge cases directly: symlink
 * exclusion, walk ordering, the hard walk cap, and bounded-read behavior at
 * and beyond the byte cap.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readBoundedFile, walkArtifactFiles } from '../src/artifact-file.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmp(prefix: string): string {
  const root = mkdtempSync(join(process.cwd(), prefix))
  roots.push(root)
  return root
}

describe('walkArtifactFiles', () => {
  it('finds every regular file below root, including nested directories', async () => {
    const dir = tmp('.science-artifact-file-walk-')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'b.png'), 'x')
    writeFileSync(join(dir, 'a.png'), 'z')
    writeFileSync(join(dir, 'sub', 'c.png'), 'y')
    const found = await walkArtifactFiles(dir)
    expect(found.sort()).toEqual(['a.png', 'b.png', 'sub/c.png'])
  })

  it('never descends through a symlinked directory and skips a symlinked file', async () => {
    const dir = tmp('.science-artifact-file-walk-symlink-')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'c.png'), 'y')
    writeFileSync(join(dir, 'a.png'), 'z')
    symlinkSync(join(dir, 'sub'), join(dir, 'loop'))
    symlinkSync(join(dir, 'a.png'), join(dir, 'link.png'))
    const found = await walkArtifactFiles(dir)
    expect(found.sort()).toEqual(['a.png', 'sub/c.png'])
  })

  it('returns an empty list for a directory that does not exist', async () => {
    const dir = tmp('.science-artifact-file-walk-missing-')
    expect(await walkArtifactFiles(join(dir, 'does-not-exist'))).toEqual([])
  })

  it('stops walking at the internal hard cap', async () => {
    const dir = tmp('.science-artifact-file-walk-hard-cap-')
    for (let index = 0; index < 10_001; index += 1) writeFileSync(join(dir, `f${String(index)}.png`), '')
    const found = await walkArtifactFiles(dir)
    expect(found.length).toBeLessThanOrEqual(10_000)
  }, 30_000)
})

describe('readBoundedFile', () => {
  it('reads a file at or below the cap in full', async () => {
    const dir = tmp('.science-artifact-file-read-full-')
    const path = join(dir, 'x.bin')
    writeFileSync(path, 'hello')
    expect(Buffer.from(await readBoundedFile(path, 1024)).toString()).toBe('hello')
  })

  it('caps the read at maxBytes + 1 for an oversized file', async () => {
    const dir = tmp('.science-artifact-file-read-capped-')
    const path = join(dir, 'big.bin')
    writeFileSync(path, Buffer.alloc(2000, 1))
    const data = await readBoundedFile(path, 100)
    expect(data.byteLength).toBe(101)
  })

  it('reads a file exactly at the cap without the +1 overrun', async () => {
    const dir = tmp('.science-artifact-file-read-exact-')
    const path = join(dir, 'exact.bin')
    writeFileSync(path, Buffer.alloc(100, 2))
    const data = await readBoundedFile(path, 100)
    expect(data.byteLength).toBe(100)
  })
})
