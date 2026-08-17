/**
 * Chart artifact-path validation, bounded safe-listing, bounded file reads,
 * and `ScienceRuntime.commitChart` end-to-end: contiguous versioning,
 * environment provenance inheritance, the fork-lineage boundary, and every
 * artifact-selection and admission failure.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { listArtifactEntries, readBoundedFile, resolveArtifactFile, validateArtifactPathSyntax } from '../src/chart.ts'
import { planSessionScratch, runArtifactDirectory } from '../src/scratch.ts'
import {
  authorizePythonRun,
  authorizeSaveChart,
  createControlledRuntimeHarness,
  createFakePythonPrefix,
  createScienceSession,
} from './harness.ts'

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmp(prefix: string): string {
  const root = mkdtempSync(join(process.cwd(), prefix))
  roots.push(root)
  return root
}

describe('validateArtifactPathSyntax', () => {
  it('accepts a safe relative forward-slash path', () => {
    expect(() => { validateArtifactPathSyntax('plot.png') }).not.toThrow()
    expect(() => { validateArtifactPathSyntax('nested/plot.png') }).not.toThrow()
  })

  it('rejects an empty or oversized path', () => {
    expect(() => { validateArtifactPathSyntax('') }).toThrow(/1-4096/)
    expect(() => { validateArtifactPathSyntax('a'.repeat(4097)) }).toThrow(/1-4096/)
  })

  it('rejects a NUL byte', () => {
    expect(() => { validateArtifactPathSyntax('a\0b') }).toThrow(/NUL/)
  })

  it('rejects a backslash', () => {
    expect(() => { validateArtifactPathSyntax('a\\b') }).toThrow(/forward-slash/)
  })

  it('rejects an absolute POSIX or drive-letter path', () => {
    expect(() => { validateArtifactPathSyntax('/etc/passwd') }).toThrow(/relative/)
    expect(() => { validateArtifactPathSyntax('C:/windows') }).toThrow(/relative/)
  })

  it('rejects an empty, ".", or ".." segment', () => {
    expect(() => { validateArtifactPathSyntax('a//b') }).toThrow(/segment/)
    expect(() => { validateArtifactPathSyntax('./a') }).toThrow(/segment/)
    expect(() => { validateArtifactPathSyntax('../a') }).toThrow(/segment/)
    expect(() => { validateArtifactPathSyntax('a/../b') }).toThrow(/segment/)
  })
})

describe('listArtifactEntries', () => {
  it('lists sorted safe relative paths, never descending through a symlinked directory', async () => {
    const dir = tmp('.science-chart-list-')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'b.png'), 'x')
    writeFileSync(join(dir, 'a.png'), 'z')
    writeFileSync(join(dir, 'sub', 'c.png'), 'y')
    symlinkSync(join(dir, 'sub'), join(dir, 'loop'))
    symlinkSync(join(dir, 'a.png'), join(dir, 'link.png'))
    const listing = await listArtifactEntries(dir, 100, 10_000)
    expect(listing.entries).toEqual(['a.png', 'b.png', 'sub/c.png'])
    expect(listing.omitted).toBe(0)
  })

  it('bounds the listing by entry count and reports the omitted count', async () => {
    const dir = tmp('.science-chart-list-count-')
    for (let index = 0; index < 5; index += 1) writeFileSync(join(dir, `f${String(index)}.png`), 'x')
    const listing = await listArtifactEntries(dir, 2, 10_000)
    expect(listing.entries).toHaveLength(2)
    expect(listing.omitted).toBe(3)
  })

  it('bounds the listing by UTF-8 bytes', async () => {
    const dir = tmp('.science-chart-list-bytes-')
    writeFileSync(join(dir, 'a.png'), 'x')
    writeFileSync(join(dir, 'zzzzzzzzzz.png'), 'x')
    const listing = await listArtifactEntries(dir, 100, 6)
    expect(listing.entries).toEqual(['a.png'])
    expect(listing.omitted).toBe(1)
  })

  it('returns an empty listing for a directory that does not exist', async () => {
    const dir = tmp('.science-chart-list-missing-')
    const listing = await listArtifactEntries(join(dir, 'does-not-exist'), 100, 10_000)
    expect(listing).toEqual({ entries: [], omitted: 0 })
  })

  it('stops walking at the hard cap independent of the configured bounds', async () => {
    const dir = tmp('.science-chart-list-hard-cap-')
    // One more than the internal hard cap (10_000), so the walk itself must
    // stop early rather than merely truncating the final sorted listing.
    for (let index = 0; index < 10_001; index += 1) writeFileSync(join(dir, `f${String(index)}.png`), '')
    const listing = await listArtifactEntries(dir, 20_000, 10_000_000)
    expect(listing.entries.length).toBeLessThanOrEqual(10_000)
  }, 30_000)
})

describe('resolveArtifactFile', () => {
  it('resolves a regular file inside the artifact directory', async () => {
    const dir = tmp('.science-chart-resolve-')
    writeFileSync(join(dir, 'plot.png'), PNG)
    const resolved = await resolveArtifactFile(dir, 'plot.png', 200, 8192)
    expect(resolved.endsWith(join('plot.png'))).toBe(true)
  })

  it('rejects a missing path with a bounded diagnostic listing the available files', async () => {
    const dir = tmp('.science-chart-resolve-missing-')
    writeFileSync(join(dir, 'plot.png'), PNG)
    await expect(resolveArtifactFile(dir, 'missing.png', 200, 8192)).rejects
      .toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
    await expect(resolveArtifactFile(dir, 'missing.png', 200, 8192)).rejects
      .toThrow(/plot\.png/)
  })

  it('reports an empty artifact directory distinctly', async () => {
    const dir = tmp('.science-chart-resolve-empty-')
    await expect(resolveArtifactFile(dir, 'plot.png', 200, 8192)).rejects
      .toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
    await expect(resolveArtifactFile(dir, 'plot.png', 200, 8192)).rejects
      .toThrow(/no eligible files/)
  })

  it('rejects a directory', async () => {
    const dir = tmp('.science-chart-resolve-dir-')
    mkdirSync(join(dir, 'sub'))
    await expect(resolveArtifactFile(dir, 'sub', 200, 8192)).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it('rejects a symlinked file even when it stays inside the artifact directory', async () => {
    const dir = tmp('.science-chart-resolve-symlink-')
    writeFileSync(join(dir, 'real.png'), PNG)
    symlinkSync(join(dir, 'real.png'), join(dir, 'link.png'))
    await expect(resolveArtifactFile(dir, 'link.png', 200, 8192)).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it('rejects a path escaping the artifact directory through a symlinked parent segment', async () => {
    const outside = tmp('.science-chart-resolve-outside-')
    writeFileSync(join(outside, 'secret.png'), PNG)
    const dir = tmp('.science-chart-resolve-escape-')
    symlinkSync(outside, join(dir, 'escape'))
    await expect(resolveArtifactFile(dir, 'escape/secret.png', 200, 8192)).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it('reports the omitted count in the diagnostic when the listing is bounded', async () => {
    const dir = tmp('.science-chart-resolve-bounded-')
    for (let index = 0; index < 3; index += 1) writeFileSync(join(dir, `f${String(index)}.png`), 'x')
    await expect(resolveArtifactFile(dir, 'missing.png', 1, 8192)).rejects
      .toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
    await expect(resolveArtifactFile(dir, 'missing.png', 1, 8192)).rejects
      .toThrow(/further entries omitted/)
  })
})

describe('readBoundedFile', () => {
  it('reads a file at or below the cap in full', async () => {
    const dir = tmp('.science-chart-read-full-')
    const path = join(dir, 'x.bin')
    writeFileSync(path, PNG)
    expect(await readBoundedFile(path, 1024)).toEqual(PNG)
  })

  it('caps the read at maxBytes + 1 for an oversized file', async () => {
    const dir = tmp('.science-chart-read-capped-')
    const path = join(dir, 'big.bin')
    writeFileSync(path, Buffer.alloc(2000, 1))
    const data = await readBoundedFile(path, 100)
    expect(data.byteLength).toBe(101)
  })
})

describe('ScienceRuntime.commitChart', () => {
  /** Bind the fake Python profile through the public Runtime operation. */
  async function bindFakePython(
    runtime: Awaited<ReturnType<typeof createControlledRuntimeHarness>>['runtime'],
    session: Session,
  ): Promise<void> {
    await runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal })
  }

  /** Bind, run, and durably succeed one Python run; returns the exact successful runId. */
  async function successfulRun(
    harness: Awaited<ReturnType<typeof createControlledRuntimeHarness>>,
    session: Session,
  ): Promise<ScienceRunId> {
    await bindFakePython(harness.runtime, session)
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    const result = await handle.done
    expect(result.terminal.status).toBe('success')
    return handle.runId
  }

  /** Write one artifact file below a run's real Host artifact directory. */
  async function writeArtifact(
    root: string, session: Session, runId: ScienceRunId, relativePath: string, data: Uint8Array,
  ): Promise<void> {
    const sessionScratch = await planSessionScratch(join(root, 'dsh-home'), session)
    const artifacts = runArtifactDirectory(sessionScratch, runId)
    const target = join(artifacts, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
  }

  it('commits version 1 for the first save of a logical name, inheriting run environment provenance', async () => {
    const root = tmp('.science-chart-commit-first-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-chart-first')
    const runId = await successfulRun(harness, session)
    await writeArtifact(root, session, runId, 'plot.png', PNG)
    const started = session.events.find(event => event.type === 'science/run-started')
    const startedRun = started?.type === 'science/run-started' ? started.data.run : undefined
    const chart = await harness.runtime.commitChart({
      session, runId, artifactPath: 'plot.png', logicalName: 'main', title: 'Main plot', caption: 'A caption',
      ...authorizeSaveChart(session), signal: new AbortController().signal,
    })
    expect(chart.version).toBe(1)
    expect(chart.logicalName).toBe('main')
    expect(chart.title).toBe('Main plot')
    expect(chart.caption).toBe('A caption')
    expect(chart.attachment.mediaType).toBe('image/png')
    expect(chart.attachment.name).toBe('plot.png')
    expect(chart.runId).toBe(runId)
    expect(chart.environmentRevision).toBe(startedRun?.environmentRevision)
    expect(chart.environmentFingerprint).toBe(startedRun?.environmentFingerprint)
    const projection = replayScience(session.events)
    expect(projection?.charts).toEqual([chart])
    expect(session.events.some(event => event.type === 'science/chart-saved')).toBe(true)
  })

  it('increments the version and retains the chartId for a repeat logical name', async () => {
    const root = tmp('.science-chart-commit-repeat-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-chart-repeat')
    const runId = await successfulRun(harness, session)
    await writeArtifact(root, session, runId, 'plot.png', PNG)
    const first = await harness.runtime.commitChart({
      session, runId, artifactPath: 'plot.png', logicalName: 'main', title: 'v1',
      ...authorizeSaveChart(session, 'science-chart-repeat-call-1'), signal: new AbortController().signal,
    })
    const second = await harness.runtime.commitChart({
      session, runId, artifactPath: 'plot.png', logicalName: 'main', title: 'v2',
      ...authorizeSaveChart(session, 'science-chart-repeat-call-2'), signal: new AbortController().signal,
    })
    expect(second.chartId).toBe(first.chartId)
    expect(second.version).toBe(2)
  })

  it('assigns a new chartId for a distinct logical name', async () => {
    const root = tmp('.science-chart-commit-distinct-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-chart-distinct')
    const runId = await successfulRun(harness, session)
    await writeArtifact(root, session, runId, 'plot.png', PNG)
    const first = await harness.runtime.commitChart({
      session, runId, artifactPath: 'plot.png', logicalName: 'main', title: 'main',
      ...authorizeSaveChart(session, 'science-chart-distinct-call-1'), signal: new AbortController().signal,
    })
    const other = await harness.runtime.commitChart({
      session, runId, artifactPath: 'plot.png', logicalName: 'secondary', title: 'secondary',
      ...authorizeSaveChart(session, 'science-chart-distinct-call-2'), signal: new AbortController().signal,
    })
    expect(other.chartId).not.toBe(first.chartId)
    expect(other.version).toBe(1)
  })

  it('rejects a source run that does not exist', async () => {
    const root = tmp('.science-chart-commit-missing-run-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-chart-missing-run')
    await bindFakePython(harness.runtime, session)
    await expect(harness.runtime.commitChart({
      session, runId: 'not-a-real-run' as never, artifactPath: 'plot.png', logicalName: 'main', title: 'main',
      ...authorizeSaveChart(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'SOURCE_RUN_NOT_SUCCESSFUL' })
  })

  it('rejects a source run that exists but is not durably successful', async () => {
    const root = tmp('.science-chart-commit-failed-run-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-chart-failed-run')
    await bindFakePython(harness.runtime, session)
    const controlled = harness.subprocess.queueRun('immediate')
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: 'print(1)', ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    controlled.complete({ exitCode: 1, signal: null })
    const result = await handle.done
    expect(result.terminal.status).toBe('failed')
    await expect(harness.runtime.commitChart({
      session, runId: handle.runId, artifactPath: 'plot.png', logicalName: 'main', title: 'main',
      ...authorizeSaveChart(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'SOURCE_RUN_NOT_SUCCESSFUL' })
  })

  it('rejects a run inherited through a fork with a distinct diagnostic', async () => {
    const root = tmp('.science-chart-commit-inherited-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const parent = createScienceSession(harness.ctx, 'science-chart-inherited-parent')
    const runId = await successfulRun(harness, parent)
    await writeArtifact(root, parent, runId, 'plot.png', PNG)
    const seed = [...parent.events]
    const child = harness.ctx.sessions.create(SessionId('science-chart-inherited-child'), {
      seed,
      meta: { agentPreset: 'science', seedLength: seed.length },
    })
    await expect(harness.runtime.commitChart({
      session: child, runId, artifactPath: 'plot.png', logicalName: 'main', title: 'main',
      ...authorizeSaveChart(child), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INHERITED_RUN' })
  })

  it('rejects an artifact path that does not resolve inside the run\'s artifact directory', async () => {
    const root = tmp('.science-chart-commit-bad-path-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-chart-bad-path')
    const runId = await successfulRun(harness, session)
    await expect(harness.runtime.commitChart({
      session, runId, artifactPath: '../escape.png', logicalName: 'main', title: 'main',
      ...authorizeSaveChart(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(harness.runtime.commitChart({
      session, runId, artifactPath: 'missing.png', logicalName: 'main', title: 'main',
      ...authorizeSaveChart(session, 'science-chart-bad-path-call-2'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it('rejects loudly when the deployment attachment allowlist excludes image/png', async () => {
    const root = tmp('.science-chart-commit-media-type-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, (ctx) => {
      ctx.provide('attachments', {
        imageLimits: {
          maxImageBytes: 1024, maxImagesPerMessage: 1, maxMessageImageBytes: 1024, maxImagePixels: 1_000_000,
          mediaTypes: ['image/jpeg'],
        },
        validateImage: async () => {},
        saveImage: async () => { throw new Error('save_chart must not save when PNG is not allowed') },
        readImage: async () => { throw new Error('unexpected readImage call') },
      } as never)
    })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-chart-media-type')
    const runId = await successfulRun(harness, session)
    await writeArtifact(root, session, runId, 'plot.png', PNG)
    await expect(harness.runtime.commitChart({
      session, runId, artifactPath: 'plot.png', logicalName: 'main', title: 'main',
      ...authorizeSaveChart(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'IMAGE_TYPE_NOT_ALLOWED' })
    expect(replayScience(session.events)?.charts).toEqual([])
  })
})
