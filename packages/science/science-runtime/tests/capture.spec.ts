/**
 * Auto-capture end-to-end through `ScienceRuntime.startRun`: new/changed/
 * identical files, oversized/per-run/per-session bounds, dotfile/extension
 * exclusion, capture on a failed run, and non-fatal capture failure.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { planSessionScratch, runArtifactDirectory } from '../src/scratch.ts'
import {
  authorizePythonRun,
  createControlledRuntimeHarness,
  createFakePythonPrefix,
  createScienceSession,
  rejectSessionAppend,
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

/** Write one file below a run's real Host artifact directory. */
async function writeArtifact(
  root: string, session: Session, runId: ScienceRunId, relativePath: string, data: Uint8Array | string,
): Promise<void> {
  const sessionScratch = await planSessionScratch(join(root, 'dsh-home'), session)
  const artifacts = runArtifactDirectory(sessionScratch, runId)
  const target = join(artifacts, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
}

let callCounter = 0

/** Bind the fake Python profile, then start and hold one run open under manual completion control. */
async function startHeldRun(
  harness: Awaited<ReturnType<typeof createControlledRuntimeHarness>>,
  session: Session,
  bound = false,
): Promise<{
  readonly run: ReturnType<typeof harness.subprocess.queueRun>
  readonly handle: Awaited<ReturnType<typeof harness.runtime.startRun>>
}> {
  if (!bound) {
    await harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
  }
  callCounter += 1
  const run = harness.subprocess.queueRun('immediate')
  const handle = await harness.runtime.startRun({
    session, language: 'python', code: 'print(1)',
    ...authorizePythonRun(session, `capture-run-${String(callCounter)}`),
    signal: new AbortController().signal,
  })
  return { run, handle }
}

/** Start one run, write every listed file into its artifact directory, then complete it and await settlement. */
async function runWithFiles(
  harness: Awaited<ReturnType<typeof createControlledRuntimeHarness>>,
  root: string,
  session: Session,
  files: Readonly<Record<string, Uint8Array | string>>,
  exitCode = 0,
  alreadyBound = false,
) {
  const { run, handle } = await startHeldRun(harness, session, alreadyBound)
  for (const [relativePath, data] of Object.entries(files)) {
    await writeArtifact(root, session, handle.runId, relativePath, data)
  }
  run.complete({ exitCode, signal: null })
  const result = await handle.done
  return { runId: handle.runId, result }
}

describe('Science auto-capture', () => {
  it('captures a new file as version 1 with origin auto, and a changed file as version 2', async () => {
    const root = tmp('.science-capture-new-changed-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-new')

    const first = await runWithFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n', 'plot.png': PNG })
    expect(first.result.capture?.captured).toHaveLength(2)
    expect(first.result.capture?.captured.find(v => v.logicalName === 'summary.csv')).toMatchObject({
      logicalName: 'summary.csv', version: 1, origin: 'auto', title: 'summary.csv',
      attachment: { mediaType: 'text/csv' },
    })
    expect(first.result.capture?.captured.find(v => v.logicalName === 'plot.png')).toMatchObject({
      logicalName: 'plot.png', version: 1, origin: 'auto', title: 'plot.png',
      attachment: { mediaType: 'image/png', width: 1, height: 1 },
    })

    const second = await runWithFiles(harness, root, session, { 'summary.csv': 'a,b\n3,4\n' }, 0, true)
    expect(second.result.capture?.captured).toHaveLength(1)
    expect(second.result.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 2, origin: 'auto' })

    const projection = replayScience(session.events)
    const versions = projection?.artifacts.filter(candidate => candidate.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1, 2])
  })

  it('skips an identical rerun of the same file: no new version, no new event', async () => {
    const root = tmp('.science-capture-identical-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-identical')

    await runWithFiles(harness, root, session, { 'notes.md': '# same\n' })
    const rerun = await runWithFiles(harness, root, session, { 'notes.md': '# same\n' }, 0, true)

    expect(rerun.result.capture?.captured).toEqual([])
    expect(session.events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(1)
    const projection = replayScience(session.events)
    expect(projection?.artifacts.filter(candidate => candidate.logicalName === 'notes.md')).toHaveLength(1)
  })

  it('skips and counts a file over captureMaxFileBytes without failing the run', async () => {
    const root = tmp('.science-capture-oversized-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, { captureMaxFileBytes: 1_048_576 },
    )
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-oversized')

    const { result } = await runWithFiles(harness, root, session, { 'big.txt': Buffer.alloc(1_048_577, 1) })
    expect(result.terminal.status).toBe('success')
    expect(result.capture?.captured).toEqual([])
    expect(result.capture?.skippedOversizedCount).toBe(1)
    expect(replayScience(session.events)?.artifacts).toEqual([])
  })

  it('truncates and flags eligible files beyond captureMaxFilesPerRun', async () => {
    const root = tmp('.science-capture-per-run-cap-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, { captureMaxFilesPerRun: 2 },
    )
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-per-run-cap')

    const { result } = await runWithFiles(harness, root, session, {
      'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c',
    })
    expect(result.capture?.truncatedPerRun).toBe(true)
    expect(result.capture?.captured).toHaveLength(2)
    expect(result.capture?.captured.map(v => v.logicalName)).toEqual(['a.txt', 'b.txt'])
  })

  it('stops appending once captureMaxArtifactVersionsPerSession is reached, flagging the run that hit it', async () => {
    const root = tmp('.science-capture-per-session-cap-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, { captureMaxArtifactVersionsPerSession: 1 },
    )
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-per-session-cap')

    const first = await runWithFiles(harness, root, session, { 'one.txt': '1' })
    expect(first.result.capture?.captured).toHaveLength(1)
    expect(first.result.capture?.truncatedPerSession).toBe(false)

    const second = await runWithFiles(harness, root, session, { 'two.txt': '2' }, 0, true)
    expect(second.result.capture?.captured).toEqual([])
    expect(second.result.capture?.truncatedPerSession).toBe(true)
    expect(replayScience(session.events)?.artifacts).toHaveLength(1)
  })

  it('excludes dotfile/dot-directory segments and non-allowlisted extensions', async () => {
    const root = tmp('.science-capture-excluded-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-excluded')

    const { result } = await runWithFiles(harness, root, session, {
      '.hidden.csv': 'a', '.cache/plot.png': 'x', 'notes.doc': 'y', 'kept.txt': 'z',
    })
    expect(result.capture?.captured.map(v => v.logicalName)).toEqual(['kept.txt'])
    expect(result.capture?.skippedOversizedCount).toBe(0)
    expect(result.capture?.truncatedPerRun).toBe(false)
  })

  it('captures a failed run\'s partial output with origin auto', async () => {
    const root = tmp('.science-capture-failed-run-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-failed-run')

    const { result } = await runWithFiles(harness, root, session, { 'partial.json': '{"ok":false}' }, 1)
    expect(result.terminal.status).toBe('failed')
    expect(result.capture?.captured).toHaveLength(1)
    expect(result.capture?.captured[0]).toMatchObject({ logicalName: 'partial.json', origin: 'auto' })
    const projection = replayScience(session.events)
    expect(projection?.artifacts).toHaveLength(1)
  })

  it('treats the deployment attachment store rejecting an admission as oversized, never a run failure', async () => {
    const root = tmp('.science-capture-admission-rejected-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, (ctx) => {
      ctx.provide('attachments', {
        imageLimits: {
          maxImageBytes: 10, maxImagesPerMessage: 1, maxMessageImageBytes: 10, maxImagePixels: 1_000_000,
          mediaTypes: ['image/png'],
        },
        textLimits: { maxTextBytes: 10, mediaTypes: ['text/csv', 'application/json', 'text/markdown', 'text/plain'] },
        validateImage: async () => {},
        validateText: async () => {},
        saveImage: async () => { throw new AttachmentError('Image exceeds the configured byte limit.', 'IMAGE_TOO_LARGE') },
        saveText: async () => { throw new AttachmentError('Text exceeds the configured byte limit.', 'TEXT_TOO_LARGE') },
        readImage: async () => { throw new Error('unexpected readImage call') },
        readText: async () => { throw new Error('unexpected readText call') },
      } as never)
    })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-admission-rejected')

    const { result } = await runWithFiles(harness, root, session, { 'small.txt': 'ok' })
    expect(result.terminal.status).toBe('success')
    expect(result.capture?.captured).toEqual([])
    expect(result.capture?.skippedOversizedCount).toBe(1)
    expect(replayScience(session.events)?.artifacts).toEqual([])
  })

  it('silently skips an eligible file whose media type the deployment attachment store does not accept', async () => {
    const root = tmp('.science-capture-media-type-excluded-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, (ctx) => {
      ctx.provide('attachments', {
        imageLimits: {
          maxImageBytes: 10_000, maxImagesPerMessage: 1, maxMessageImageBytes: 10_000, maxImagePixels: 1_000_000, mediaTypes: [],
        },
        textLimits: { maxTextBytes: 10_000, mediaTypes: ['text/csv', 'application/json', 'text/markdown'] },
        validateImage: async () => {},
        validateText: async () => {},
        saveImage: async () => { throw new Error('unexpected saveImage call: image/png is excluded') },
        saveText: async () => { throw new Error('unexpected saveText call: text/plain is excluded') },
        readImage: async () => { throw new Error('unexpected readImage call') },
        readText: async () => { throw new Error('unexpected readText call') },
      } as never)
    })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-media-type-excluded')

    const { result } = await runWithFiles(harness, root, session, { 'plot.png': 'x', 'excluded.txt': 'y' })
    expect(result.terminal.status).toBe('success')
    expect(result.capture?.captured).toEqual([])
    expect(result.capture?.skippedOversizedCount).toBe(0)
    expect(replayScience(session.events)?.artifacts).toEqual([])
  })

  it('does not fail the run when capture itself throws unexpectedly (a non-Error value), logging at error since it carries no filesystem code', async () => {
    const root = tmp('.science-capture-internal-failure-')
    const prefix = createFakePythonPrefix(root)
    const errors: string[] = []
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, (ctx) => {
      ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
      ctx.provide('attachments', {
        imageLimits: { maxImageBytes: 10, maxImagesPerMessage: 1, maxMessageImageBytes: 10, maxImagePixels: 1_000_000, mediaTypes: ['image/png'] },
        textLimits: { maxTextBytes: 10_000, mediaTypes: ['text/csv', 'application/json', 'text/markdown', 'text/plain'] },
        validateImage: async () => {},
        validateText: async () => {},
        saveImage: async () => { throw new Error('unexpected saveImage call') },
        // Deliberately not an Error instance: exercises isCaptureFilesystemFailure's
        // non-object short circuit, mirroring environment.spec.ts's own
        // `throw 'injected non-Error static failure'` technique.
        saveText: async () => { throw 'boom: capture-time infrastructure failure' },
        readImage: async () => { throw new Error('unexpected readImage call') },
        readText: async () => { throw new Error('unexpected readText call') },
      } as never)
    })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-internal-failure')

    const { result } = await runWithFiles(harness, root, session, { 'note.txt': 'hello' })
    expect(result.terminal.status).toBe('success')
    expect(result.capture).toBeUndefined()
    expect(replayScience(session.events)?.artifacts).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('boom: capture-time infrastructure failure')
  })

  it('logs at warn, not error, when the auto-capture failure carries a filesystem code', async () => {
    const root = tmp('.science-capture-fs-failure-')
    const prefix = createFakePythonPrefix(root)
    const warnings: string[] = []
    const errors: string[] = []
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, (ctx) => {
      ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
      ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
      ctx.provide('attachments', {
        imageLimits: { maxImageBytes: 10, maxImagesPerMessage: 1, maxMessageImageBytes: 10, maxImagePixels: 1_000_000, mediaTypes: ['image/png'] },
        textLimits: { maxTextBytes: 10_000, mediaTypes: ['text/csv', 'application/json', 'text/markdown', 'text/plain'] },
        validateImage: async () => {},
        validateText: async () => {},
        saveImage: async () => { throw new Error('unexpected saveImage call') },
        saveText: async () => { throw Object.assign(new Error('disk unavailable'), { code: 'EIO' }) },
        readImage: async () => { throw new Error('unexpected readImage call') },
        readText: async () => { throw new Error('unexpected readText call') },
      } as never)
    })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-fs-failure')

    const { result } = await runWithFiles(harness, root, session, { 'note.txt': 'hello' })
    expect(result.terminal.status).toBe('success')
    expect(result.capture).toBeUndefined()
    expect(replayScience(session.events)?.artifacts).toEqual([])
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('disk unavailable')
  })

  it('leaves the run\'s own terminal fact intact when the Session refuses the artifact-saved append, flagging and logging it', async () => {
    const root = tmp('.science-capture-append-refused-')
    const prefix = createFakePythonPrefix(root)
    const warnings: string[] = []
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    harness.ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof harness.ctx.logger.warn
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-append-refused')
    rejectSessionAppend(session, 'science/artifact-saved', new Error('boom: append refused'))

    const { result } = await runWithFiles(harness, root, session, { 'a.txt': 'a', 'b.txt': 'b' })
    expect(result.terminal.status).toBe('success')
    expect(result.capture?.captured).toEqual([])
    expect(result.capture?.appendFailed).toBe(true)
    expect(session.events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(0)
    expect(session.events.filter(event => event.type === 'science/run-finished')).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('auto-capture stopped early')
  })
})
