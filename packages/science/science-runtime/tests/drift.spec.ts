/** Tests for conda prefix drift detection and automatic re-bind before runs. */

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prefixHistoryDigest } from '../src/environment.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeFakePrefix(): string {
  const root = mkdtempSync(join(tmpdir(), 'science-drift-'))
  roots.push(root)
  mkdirSync(join(root, 'conda-meta'), { recursive: true })
  writeFileSync(join(root, 'conda-meta', 'history'), '==> 2026-09-01 00:00:00 <==\n# initial install\n')
  return root
}

describe('prefixHistoryDigest', () => {
  it('computes sha256 of conda-meta/history', async () => {
    const prefix = makeFakePrefix()
    const digest1 = await prefixHistoryDigest(prefix)
    expect(digest1).toBeDefined()
    expect(typeof digest1).toBe('string')
    expect(digest1).toHaveLength(64)

    // Repeat reading without change yields byte-identical digest
    const digest2 = await prefixHistoryDigest(prefix)
    expect(digest2).toBe(digest1)
  })

  it('detects content modifications in conda-meta/history', async () => {
    const prefix = makeFakePrefix()
    const initialDigest = await prefixHistoryDigest(prefix)

    appendFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-09-05 00:00:00 <==\n+lifelines==0.30.0\n')
    const driftedDigest = await prefixHistoryDigest(prefix)

    expect(driftedDigest).toBeDefined()
    expect(driftedDigest).not.toBe(initialDigest)
  })

  it('returns undefined when conda-meta/history is absent', async () => {
    const emptyPrefix = mkdtempSync(join(tmpdir(), 'science-empty-'))
    roots.push(emptyPrefix)
    const digest = await prefixHistoryDigest(emptyPrefix)
    expect(digest).toBeUndefined()
  })
})
