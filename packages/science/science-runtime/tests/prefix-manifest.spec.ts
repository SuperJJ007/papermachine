/** Prefix-manifest behavior and fake Runtime non-mutation evidence. */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import {
  authorizePythonRun,
  createFastRuntimeHarness,
  createFakePythonPrefix,
  createScienceSession,
} from './harness.ts'
import { capturePrefixManifest, diffPrefixManifest } from './prefix-manifest.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Science Runtime prefix manifests', () => {
  it('records link targets without following them and excludes atime from a stable comparison', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-manifest-links-'))
    roots.push(root)
    mkdirSync(join(root, 'prefix'))
    writeFileSync(join(root, 'prefix', 'history'), 'initial')
    symlinkSync('../outside', join(root, 'prefix', 'outside-link'))

    const manifest = await capturePrefixManifest(join(root, 'prefix'))
    expect(manifest.get('outside-link')).toMatchObject({ type: 'symlink', symlinkTarget: '../outside' })
    expect(manifest.get('history')).toMatchObject({
      type: 'file', sha256: 'ac1b5c0961a7269b6a053ee64276ed0e20a7f48aefb9f67519539d23aaf10149',
    })
    expect(diffPrefixManifest(manifest, await capturePrefixManifest(join(root, 'prefix')))).toEqual([])
  })

  it('leaves the fake configured prefix byte-for-byte manifest-equivalent after binding and running', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-prefix-unchanged-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const before = await capturePrefixManifest(prefix)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime } = harness
    const session = createScienceSession(ctx, 'science-prefix-unchanged')
    await runtime.bindEnvironment({
      session,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })
    const handle = await runtime.startRun({
      session,
      language: 'python',
      code: 'print("prefix must remain unchanged")',
      ...authorizePythonRun(session, 'science-prefix-unchanged-call'),
      signal: new AbortController().signal,
    })
    await expect(handle.done).resolves.toMatchObject({ terminal: { status: 'success' } })

    expect(diffPrefixManifest(before, await capturePrefixManifest(prefix))).toEqual([])
  })
})
