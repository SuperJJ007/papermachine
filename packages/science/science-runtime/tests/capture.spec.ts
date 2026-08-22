/**
 * Auto-capture end-to-end through `ScienceRuntime.startRun`: new/changed/
 * identical files, oversized/per-run/per-session bounds, dotfile/extension
 * exclusion, capture on a failed run, and non-fatal capture failure.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { crc32 } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { CallId } from '@deepseek-ai/dsh-llm'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { StartScienceRunRequest } from '../src/types.ts'
import { planSessionScratch, runArtifactDirectory } from '../src/scratch.ts'
import {
  authorizePythonRun,
  createKernelRuntimeHarness,
  createFakePythonPrefix,
  createScienceSession,
  kernelAction,
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

/**
 * Bind the fake Python profile (unless `bound`), then start one run held
 * open by the fake kernel driver's `sleep` action so the test can write the
 * run's artifact files under its real `runId` before DONE arrives.
 */
async function startHeldRun(
  harness: Awaited<ReturnType<typeof createKernelRuntimeHarness>>,
  session: Session,
  status: 'ok' | 'error' = 'ok',
  bound = false,
  artifacts?: Pick<StartScienceRunRequest, 'artifactInputs' | 'editBaselines'>,
): Promise<Awaited<ReturnType<typeof harness.runtime.startRun>>> {
  if (!bound) {
    await harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
  }
  callCounter += 1
  return harness.runtime.startRun({
    session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status }),
    ...artifacts,
    ...authorizePythonRun(session, `capture-run-${String(callCounter)}`),
    signal: new AbortController().signal,
  })
}

/** Start one run, write every listed file into its artifact directory, then await settlement. */
async function runWithFiles(
  harness: Awaited<ReturnType<typeof createKernelRuntimeHarness>>,
  root: string,
  session: Session,
  files: Readonly<Record<string, Uint8Array | string>>,
  status: 'ok' | 'error' = 'ok',
  alreadyBound = false,
  artifacts?: Pick<StartScienceRunRequest, 'artifactInputs' | 'editBaselines'>,
) {
  const handle = await startHeldRun(harness, session, status, alreadyBound, artifacts)
  for (const [relativePath, data] of Object.entries(files)) {
    await writeArtifact(root, session, handle.runId, relativePath, data)
  }
  const result = await handle.done
  return { runId: handle.runId, result }
}

/**
 * Authorize one more run inside the turn the session is already answering:
 * a fresh tool call against the latest `request/header`, with no new header
 * of its own (`authorizePythonRun` opens a new turn every time).
 */
function authorizeRunInTurn(session: Session, id: string, turn: number): {
  readonly toolCallId: ReturnType<typeof CallId>
  readonly requestHeaderSeq: number
} {
  const header = session.events.filter(event => event.type === 'request/header').at(-1)
  if (header === undefined) throw new Error('capture test: the session has no request/header to reuse')
  const toolCallId = CallId(id)
  session.append('tool/call', { turn, step: 1, callId: toolCallId, name: 'run_python', arguments: '{}' })
  return { toolCallId, requestHeaderSeq: header.seq }
}

/**
 * The 1x1 PNG with a `tEXt` metadata chunk spliced in before IEND: the
 * attachment store's normalize route strips metadata (rewriting the bytes),
 * so only verbatim admission can read this back byte-identical.
 */
function pngWithMetadata(): Uint8Array {
  const type = Buffer.from('tEXt')
  const payload = Buffer.from('Software\0Matplotlib', 'latin1')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.byteLength)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, payload])))
  const iendOffset = PNG.byteLength - 12
  return Uint8Array.from(Buffer.concat([
    PNG.subarray(0, iendOffset), length, type, payload, crc, PNG.subarray(iendOffset),
  ]))
}

describe('Science auto-capture', () => {
  it('materializes verified artifact inputs byte-exactly and records the complete mapping', async () => {
    const root = tmp('.science-input-materialization-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, undefined, { inputMaxBytesPerRun: 8 },
    )
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-input-materialization')
    const source = 'a,b\n1,2\n'
    const first = await runWithFiles(harness, root, session, { 'source.csv': source })
    const version = first.result.capture?.captured.at(0)
    if (version === undefined) throw new Error('input test: expected one captured version')

    const handle = await startHeldRun(harness, session, 'ok', true, {
      artifactInputs: [{ artifactId: version.artifactId, version: version.version, path: 'data/source.csv' }],
    })
    const scratch = await planSessionScratch(join(root, 'dsh-home'), session)
    expect(readFileSync(join(scratch.runs, String(handle.runId), 'inputs/data/source.csv'), 'utf8')).toBe(source)
    expect(replayScience(session.events)?.runs.at(-1)).toMatchObject({
      inputs: [{ artifactId: version.artifactId, version: 1, path: 'data/source.csv' }],
    })
    await expect(handle.done).resolves.toMatchObject({ terminal: {
      status: 'success',
      inputs: [{ artifactId: version.artifactId, version: 1, path: 'data/source.csv' }],
    } })

    await expect(harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      artifactInputs: [
        { artifactId: version.artifactId, version: 1, path: 'a.csv' },
        { artifactId: version.artifactId, version: 1, path: 'b.csv' },
      ],
      ...authorizePythonRun(session, 'science-input-too-large'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
  })

  it('rejects missing versions and unsafe or colliding input paths before publication', async () => {
    const root = tmp('.science-input-preflight-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-input-preflight')
    const first = await runWithFiles(harness, root, session, { 'source.csv': 'x\n' })
    const version = first.result.capture?.captured.at(0)
    if (version === undefined) throw new Error('input test: expected one captured version')

    await expect(harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      artifactInputs: [{ artifactId: version.artifactId, version: 99, path: 'missing.csv' }],
      ...authorizePythonRun(session, 'science-input-missing'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INPUT_NOT_FOUND' })
    await expect(harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      artifactInputs: [{ artifactId: version.artifactId, version: 1, path: '../escape.csv' }],
      ...authorizePythonRun(session, 'science-input-escape'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INPUT_PATH_INVALID' })
    await expect(harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      artifactInputs: [
        { artifactId: version.artifactId, version: 1, path: 'data' },
        { artifactId: version.artifactId, version: 1, path: 'data/source.csv' },
      ],
      ...authorizePythonRun(session, 'science-input-collision'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INPUT_PATH_INVALID' })
    await expect(harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }),
      editBaselines: { 'output.csv': { artifactId: version.artifactId, version: 99 } },
      ...authorizePythonRun(session, 'science-baseline-missing'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it('attributes existing, cross-artifact, and stale-baseline captures to the exact named parent', async () => {
    const root = tmp('.science-edit-baselines-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-edit-baselines')
    const first = await runWithFiles(harness, root, session, { 'summary.csv': 'v1\n' })
    const baseline = first.result.capture?.captured.at(0)
    if (baseline === undefined) throw new Error('baseline test: expected one captured version')
    const parent = { artifactId: baseline.artifactId, version: baseline.version }

    const second = await runWithFiles(
      harness, root, session, { 'summary.csv': 'v2\n' }, 'ok', true,
      { editBaselines: { 'summary.csv': parent } },
    )
    expect(second.result.capture?.captured.at(0)).toMatchObject({
      artifactId: baseline.artifactId, version: 2, parent,
    })

    const third = await runWithFiles(
      harness, root, session, { 'summary.csv': 'v3\n', 'branch.csv': 'branch\n' }, 'ok', true,
      { editBaselines: { 'summary.csv': parent, 'branch.csv': parent } },
    )
    expect(third.result.capture?.captured.find(candidate => candidate.logicalName === 'summary.csv')).toMatchObject({
      artifactId: baseline.artifactId, version: 3, parent,
    })
    const branch = third.result.capture?.captured.find(candidate => candidate.logicalName === 'branch.csv')
    expect(branch).toMatchObject({ version: 1, parent })
    expect(branch?.artifactId).not.toBe(baseline.artifactId)
  })

  it('captures an image byte-exactly as evidence, never normalized', async () => {
    const root = tmp('.science-capture-verbatim-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-verbatim')
    const source = pngWithMetadata()

    const { result } = await runWithFiles(harness, root, session, { 'plots/evidence.png': source })

    const captured = result.capture?.captured.at(0)
    expect(captured).toMatchObject({ logicalName: 'plots/evidence.png', version: 1 })
    if (captured === undefined) throw new Error('capture test: expected one captured version')
    expect('originalDimensions' in captured.attachment).toBe(false)
    const attachments = harness.ctx.get('attachments')
    if (attachments === undefined) throw new Error('capture test: no attachments service mounted')
    if (!('width' in captured.attachment)) throw new Error('capture test: expected an image attachment')
    const stored = await attachments.readImage(captured.attachment)
    expect(stored.data).toEqual(source)
  })

  it('captures a two-part .vl.json suffix as Vega-Lite while ordinary JSON stays generic', async () => {
    const root = tmp('.science-capture-vega-lite-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-vega-lite')

    const { result } = await runWithFiles(harness, root, session, {
      'plots/summary.VL.JSON': '{"mark":"bar"}',
      'plots/meta.json': '{"rows":2}',
    })

    expect(result.capture?.captured).toHaveLength(2)
    expect(result.capture?.captured.find(version => version.logicalName === 'plots/summary.VL.JSON')).toMatchObject({
      attachment: { mediaType: 'application/vnd.vega-lite+json' },
    })
    expect(result.capture?.captured.find(version => version.logicalName === 'plots/meta.json')).toMatchObject({
      attachment: { mediaType: 'application/json' },
    })
  })

  it('opens version 2 for changed bytes from a later tool-call turn sharing one request header', async () => {
    const root = tmp('.science-capture-new-changed-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
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

    const handle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok' }),
      ...authorizeRunInTurn(session, 'capture-later-turn', 2), signal: new AbortController().signal,
    })
    await writeArtifact(root, session, handle.runId, 'summary.csv', 'a,b\n3,4\n')
    const second = await handle.done
    expect(second.capture?.captured).toHaveLength(1)
    expect(second.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 2, origin: 'auto' })

    const projection = replayScience(session.events)
    const versions = projection?.artifacts.filter(candidate => candidate.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1, 2])
  })

  it('supersedes rather than versions when the same turn rewrites the file: iteration is not a result', async () => {
    const root = tmp('.science-capture-same-turn-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-same-turn')

    const first = await runWithFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })
    expect(first.result.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 1 })

    // A second run answering the SAME request: the model rewrote its own
    // output rather than producing a second result for the reader.
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok' }),
      ...authorizeRunInTurn(session, 'capture-same-turn-second', 1),
      signal: new AbortController().signal,
    })
    await writeArtifact(root, session, handle.runId, 'summary.csv', 'a,b\n3,4\n')
    const second = await handle.done
    expect(second.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 1 })

    const versions = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1])
    // The surviving version is the turn's final content, and it carries the
    // run that actually produced it.
    expect(versions.at(0)?.runId).toBe(handle.runId)
    expect(versions.at(0)?.attachment.attachmentId).not.toBe(first.result.capture?.captured[0]?.attachment.attachmentId)
    // Both saves stay in the log; only the projected version list collapses.
    expect(session.events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(2)
  })

  it('skips an identical rerun of the same file: no new version, no new event', async () => {
    const root = tmp('.science-capture-identical-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-identical')

    await runWithFiles(harness, root, session, { 'notes.md': '# same\n' })
    const rerun = await runWithFiles(harness, root, session, { 'notes.md': '# same\n' }, 'ok', true)

    expect(rerun.result.capture?.captured).toEqual([])
    expect(session.events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(1)
    const projection = replayScience(session.events)
    expect(projection?.artifacts.filter(candidate => candidate.logicalName === 'notes.md')).toHaveLength(1)
  })

  it('skips and counts a file over captureMaxFileBytes without failing the run', async () => {
    const root = tmp('.science-capture-oversized-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, undefined, { captureMaxFileBytes: 1_048_576 },
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
    const harness = await createKernelRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, undefined, { captureMaxFilesPerRun: 2 },
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
    const harness = await createKernelRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, undefined, { captureMaxArtifactVersionsPerSession: 1 },
    )
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-per-session-cap')

    const first = await runWithFiles(harness, root, session, { 'one.txt': '1' })
    expect(first.result.capture?.captured).toHaveLength(1)
    expect(first.result.capture?.truncatedPerSession).toBe(false)

    const second = await runWithFiles(harness, root, session, { 'two.txt': '2' }, 'ok', true)
    expect(second.result.capture?.captured).toEqual([])
    expect(second.result.capture?.truncatedPerSession).toBe(true)
    expect(replayScience(session.events)?.artifacts).toHaveLength(1)
  })

  it('excludes dotfile/dot-directory segments and non-allowlisted extensions', async () => {
    const root = tmp('.science-capture-excluded-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
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
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-failed-run')

    const { result } = await runWithFiles(harness, root, session, { 'partial.json': '{"ok":false}' }, 'error')
    expect(result.terminal.status).toBe('failed')
    expect(result.capture?.captured).toHaveLength(1)
    expect(result.capture?.captured[0]).toMatchObject({ logicalName: 'partial.json', origin: 'auto' })
    const projection = replayScience(session.events)
    expect(projection?.artifacts).toHaveLength(1)
  })

  it('treats the deployment attachment store rejecting an admission as oversized, never a run failure', async () => {
    const root = tmp('.science-capture-admission-rejected-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, (ctx) => {
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
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, (ctx) => {
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
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, (ctx) => {
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
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, (ctx) => {
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
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
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
