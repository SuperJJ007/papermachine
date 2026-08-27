/**
 * Auto-capture end-to-end through `ScienceRuntime.startRun`: new/changed/
 * identical files, oversized/per-run/per-session bounds, dotfile/extension
 * exclusion, capture on a failed run, and non-fatal capture failure.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { crc32 } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
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
  artifacts?: Pick<StartScienceRunRequest, 'artifactInputs' | 'editBaselines' | 'rasterArtifacts'>,
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
  artifacts?: Pick<StartScienceRunRequest, 'artifactInputs' | 'editBaselines' | 'rasterArtifacts'>,
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

// Every case here spawns a real kernel subprocess through
// LocalSubprocessRuntime; under full-suite concurrency, spawn and pipe I/O
// contend for the OS scheduler and the default 5s timeout is not enough.
vi.setConfig({ testTimeout: 30_000 })

describe('Science auto-capture', () => {
  it('materializes verified artifact inputs byte-exactly and records the complete mapping', async () => {
    const root = tmp('.science-input-materialization-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 30_000, undefined, undefined, { inputMaxBytesPerRun: 8 },
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

    const { result } = await runWithFiles(
      harness, root, session, { 'plots/evidence.png': source }, 'ok', false, { rasterArtifacts: ['plots/evidence.png'] },
    )

    const captured = result.capture?.captured.at(0)
    expect(captured).toMatchObject({ logicalName: 'plots/evidence.png', version: 1, mediaType: 'image/png' })
    if (captured === undefined) throw new Error('capture test: expected one captured version')
    const stored = await harness.ctx.scienceArtifactStore.readBlob(captured.projectId, captured.sha256)
    expect(stored).toEqual(source)
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
      mediaType: 'application/vnd.vega-lite+json',
    })
    expect(result.capture?.captured.find(version => version.logicalName === 'plots/meta.json')).toMatchObject({
      mediaType: 'application/json',
    })
  })

  it('opens version 2 for changed bytes from a later tool-call turn sharing one request header', async () => {
    const root = tmp('.science-capture-new-changed-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-new')

    const first = await runWithFiles(
      harness, root, session, { 'summary.csv': 'a,b\n1,2\n', 'plot.png': PNG }, 'ok', false, { rasterArtifacts: ['plot.png'] },
    )
    expect(first.result.capture?.captured).toHaveLength(2)
    expect(first.result.capture?.captured.find(v => v.logicalName === 'summary.csv')).toMatchObject({
      logicalName: 'summary.csv', version: 1, origin: 'auto', title: 'summary.csv',
      mediaType: 'text/csv',
    })
    expect(first.result.capture?.captured.find(v => v.logicalName === 'plot.png')).toMatchObject({
      logicalName: 'plot.png', version: 1, origin: 'auto', title: 'plot.png',
      mediaType: 'image/png',
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

  it('opens the next version when the same turn rewrites the file: content history is append-only', async () => {
    const root = tmp('.science-capture-same-turn-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-same-turn')

    const first = await runWithFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })
    expect(first.result.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 1 })

    // A second run answering the SAME request rewrote the model's own
    // output. Store version rows are immutable, so the rewrite opens the
    // next version rather than replacing version 1's content in place.
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok' }),
      ...authorizeRunInTurn(session, 'capture-same-turn-second', 1),
      signal: new AbortController().signal,
    })
    await writeArtifact(root, session, handle.runId, 'summary.csv', 'a,b\n3,4\n')
    const second = await handle.done
    expect(second.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 2 })

    const versions = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1, 2])
    expect(versions.at(1)?.origin).not.toBe('human-edit')
    const latest = versions.at(1)
    if (latest?.origin === 'human-edit') throw new Error('run capture projected a human edit')
    expect(latest?.runId).toBe(handle.runId)
    expect(versions.at(1)?.sha256).not.toBe(first.result.capture?.captured[0]?.sha256)
    expect(session.events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(2)
  })

  it('opens the next version instead of superseding when a same-turn baseline names the version the supersede rule would overwrite', async () => {
    const root = tmp('.science-capture-same-turn-baseline-self-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-same-turn-baseline-self')

    const first = await runWithFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })
    const baseline = first.result.capture?.captured[0]
    if (baseline === undefined) throw new Error('baseline test: expected one captured version')
    expect(baseline).toMatchObject({ logicalName: 'summary.csv', version: 1 })
    const parent = { artifactId: baseline.artifactId, version: baseline.version }

    // A second run in the SAME turn names the latest version as its own
    // edit baseline: the edit opens version 2 descending from version 1.
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok' }),
      editBaselines: { 'summary.csv': parent },
      ...authorizeRunInTurn(session, 'capture-same-turn-self-parent', 1),
      signal: new AbortController().signal,
    })
    await writeArtifact(root, session, handle.runId, 'summary.csv', 'a,b\n3,4\n')
    const second = await handle.done
    expect(second.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 2, parent })

    // The strict fold's self-parent check (transition.ts) throws loudly on
    // an artifact whose parent names the version being committed; a clean
    // replay proves the appended version never collided with its own parent.
    const projection = replayScience(session.events)
    const versions = projection?.artifacts.filter(a => a.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1, 2])
    expect(versions.at(1)?.parent).toEqual(parent)
  })

  it('opens another version for a same-turn re-run of the same edit, repeating the named baseline', async () => {
    const root = tmp('.science-capture-same-turn-baseline-rerun-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-same-turn-baseline-rerun')

    const first = await runWithFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })
    const v1 = first.result.capture?.captured[0]
    if (v1 === undefined) throw new Error('baseline test: expected one captured version')
    const parent = { artifactId: v1.artifactId, version: v1.version }

    // A later turn's edit opens version 2 with v1 as its baseline: different
    // turn from v1's own, and the version being opened (2) does not name
    // itself as its own baseline, so no self-parent collision applies here.
    const secondHandle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok' }),
      editBaselines: { 'summary.csv': parent },
      ...authorizeRunInTurn(session, 'capture-baseline-rerun-edit', 2),
      signal: new AbortController().signal,
    })
    await writeArtifact(root, session, secondHandle.runId, 'summary.csv', 'a,b\n3,4\n')
    const second = await secondHandle.done
    expect(second.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 2, parent })

    // A third run sharing turn 2 with the run that produced v2 re-runs the
    // same edit (e.g. fixing a bug in the same edit's code), naming the same
    // v1 baseline again. Content history is append-only, so the re-run opens
    // version 3, repeating the explicitly named v1 parent.
    const thirdHandle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok' }),
      editBaselines: { 'summary.csv': parent },
      ...authorizeRunInTurn(session, 'capture-baseline-rerun-edit-2', 2),
      signal: new AbortController().signal,
    })
    await writeArtifact(root, session, thirdHandle.runId, 'summary.csv', 'a,b\n5,6\n')
    const third = await thirdHandle.done
    expect(third.capture?.captured[0]).toMatchObject({ logicalName: 'summary.csv', version: 3, parent })

    const projection = replayScience(session.events)
    const versions = projection?.artifacts.filter(a => a.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1, 2, 3])
    expect(versions.at(2)?.parent).toEqual(parent)
    expect(versions.at(2)?.sha256).not.toBe(second.capture?.captured[0]?.sha256)
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

  it('does not let an untouched run-produced file revert a later human edit', async () => {
    const root = tmp('.science-capture-human-edit-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-human-edit')
    const original = '{"mark":"bar"}'

    const first = await runWithFiles(harness, root, session, { 'chart.vl.json': original })
    const parent = first.result.capture?.captured[0]
    if (parent === undefined || parent.origin === 'human-edit') throw new Error('expected run-produced Vega-Lite parent')
    const humanEditV2 = await harness.ctx.scienceArtifactStore.appendVersion(parent.projectId, parent.artifactId, {
      producerSessionId: session.id,
      data: new TextEncoder().encode('{"mark":{"type":"bar","color":"red"}}'),
      mediaType: 'application/vnd.vega-lite+json',
      origin: 'human-edit',
      title: parent.title,
      editBaselines: parent.versionId,
    })
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: parent.artifactId,
        producerSessionId: humanEditV2.producerSessionId,
        logicalName: parent.logicalName,
        version: humanEditV2.ordinal,
        parent: { artifactId: parent.artifactId, version: 1 },
        title: parent.title,
        origin: 'human-edit',
        projectId: parent.projectId,
        versionId: humanEditV2.versionId,
        sha256: humanEditV2.sha256,
        mediaType: 'application/vnd.vega-lite+json',
        byteCount: humanEditV2.byteCount,
        environmentRevision: parent.environmentRevision,
        environmentFingerprint: parent.environmentFingerprint,
        createdAt: Date.now(),
      },
    })

    const untouched = await runWithFiles(harness, root, session, { 'chart.vl.json': original }, 'ok', true)
    expect(untouched.result.capture?.captured).toEqual([])
    expect(replayScience(session.events)?.artifacts.filter(artifact => artifact.logicalName === 'chart.vl.json'))
      .toHaveLength(2)

    const changed = await runWithFiles(
      harness,
      root,
      session,
      { 'chart.vl.json': '{"mark":{"type":"bar","color":"blue"}}' },
      'ok',
      true,
    )
    expect(changed.result.capture?.captured[0]).toMatchObject({
      artifactId: parent.artifactId,
      logicalName: 'chart.vl.json',
      version: 3,
      origin: 'auto',
    })
    const changedVersion = changed.result.capture?.captured[0]
    if (changedVersion === undefined || changedVersion.origin === 'human-edit') throw new Error('expected run-produced Vega-Lite version')
    const humanEditV4 = await harness.ctx.scienceArtifactStore.appendVersion(parent.projectId, parent.artifactId, {
      producerSessionId: session.id,
      data: new TextEncoder().encode('{"mark":{"type":"bar","color":"red"}}'),
      mediaType: 'application/vnd.vega-lite+json',
      origin: 'human-edit',
      title: parent.title,
      editBaselines: changedVersion.versionId,
    })
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: parent.artifactId,
        producerSessionId: humanEditV4.producerSessionId,
        logicalName: parent.logicalName,
        version: humanEditV4.ordinal,
        parent: { artifactId: parent.artifactId, version: 3 },
        title: parent.title,
        origin: 'human-edit',
        projectId: parent.projectId,
        versionId: humanEditV4.versionId,
        sha256: humanEditV4.sha256,
        mediaType: 'application/vnd.vega-lite+json',
        byteCount: humanEditV4.byteCount,
        environmentRevision: parent.environmentRevision,
        environmentFingerprint: parent.environmentFingerprint,
        createdAt: Date.now(),
      },
    })

    const intentional = await runWithFiles(
      harness,
      root,
      session,
      { 'chart.vl.json': original },
      'ok',
      true,
      { editBaselines: { 'chart.vl.json': { artifactId: parent.artifactId, version: 4 } } },
    )
    expect(intentional.result.capture?.captured[0]).toMatchObject({
      artifactId: parent.artifactId,
      logicalName: 'chart.vl.json',
      version: 5,
      parent: { artifactId: parent.artifactId, version: 4 },
      origin: 'auto',
    })
  })

  it('skips and counts a file over captureMaxFileBytes without failing the run', async () => {
    const root = tmp('.science-capture-oversized-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 30_000, undefined, undefined, { captureMaxFileBytes: 1_048_576 },
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
      root, { fake: { pythonPrefix: prefix } }, 30_000, undefined, undefined, { captureMaxFilesPerRun: 2 },
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
      root, { fake: { pythonPrefix: prefix } }, 30_000, undefined, undefined, { captureMaxArtifactVersionsPerSession: 1 },
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

  it('continues a prior session\'s artifact from a new session in the same project (S3 cross-session capture)', async () => {
    const root = tmp('.science-capture-cross-session-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    // Both sessions share one workspace `cwd`, so both resolve to the SAME
    // project — the only thing that makes this a same-project, cross-session
    // continuation rather than two unrelated projects each with their own
    // artifact.
    const workspace = tmp('.science-cross-session-workspace-')
    const sessionA = createScienceSession(harness.ctx, 'science-cross-session-a', workspace)
    const sessionB = createScienceSession(harness.ctx, 'science-cross-session-b', workspace)

    const first = await runWithFiles(harness, root, sessionA, { 'shared.csv': 'a,b\n1,2\n' })
    const versionA = first.result.capture?.captured.at(0)
    if (versionA === undefined) throw new Error('cross-session test: expected session A to capture one version')
    expect(versionA).toMatchObject({ logicalName: 'shared.csv', version: 1, origin: 'auto' })

    // Session B has never seen `shared.csv` in its OWN log — it has to
    // consult the project store to learn artifactId already owns that
    // logicalName, rather than forking a second artifact with the same name.
    const second = await runWithFiles(harness, root, sessionB, { 'shared.csv': 'a,b\n3,4\n' })
    const versionB = second.result.capture?.captured.at(0)
    if (versionB === undefined) throw new Error('cross-session test: expected session B to continue the same artifact')
    expect(versionB).toMatchObject({ artifactId: versionA.artifactId, logicalName: 'shared.csv', version: 2, origin: 'auto' })

    // Files still shows one artifact row for the project, its latest
    // version now produced by session B.
    const artifacts = await harness.ctx.scienceArtifactStore.listArtifacts(versionA.projectId)
    expect(artifacts).toHaveLength(1)
    const artifactRecord = artifacts[0]
    if (artifactRecord === undefined) throw new Error('cross-session test: expected exactly one project artifact')
    expect(artifactRecord.artifactId).toBe(versionA.artifactId)
    const latest = await harness.ctx.scienceArtifactStore.getVersion(versionA.projectId, artifactRecord.latestVersionId)
    expect(latest).toMatchObject({ ordinal: 2, producerSessionId: sessionB.id })

    // A THIRD session, its own local fold empty, reproduces session B's
    // latest bytes byte-for-byte: the store fallback's own dedup check (not
    // the local-history one, since this session has no local history at
    // all) still recognizes it and opens no redundant version.
    const sessionC = createScienceSession(harness.ctx, 'science-cross-session-c', workspace)
    const third = await runWithFiles(harness, root, sessionC, { 'shared.csv': 'a,b\n3,4\n' })
    expect(third.result.capture?.captured).toEqual([])
  })

  it('accepts session A\'s own append landing beyond its local knowledge after session B interleaves (S3 interleaving fix)', async () => {
    const root = tmp('.science-capture-interleave-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const workspace = tmp('.science-interleave-workspace-')
    const sessionA = createScienceSession(harness.ctx, 'science-interleave-a', workspace)
    const sessionB = createScienceSession(harness.ctx, 'science-interleave-b', workspace)

    const first = await runWithFiles(harness, root, sessionA, { 'shared.csv': 'a,b\n1,2\n' })
    const versionA1 = first.result.capture?.captured.at(0)
    if (versionA1 === undefined) throw new Error('interleaving test: expected session A to capture version 1')
    expect(versionA1).toMatchObject({ version: 1, origin: 'auto' })

    // Session B — not session A — takes the project's next ordinal (2).
    // Session A's OWN log still locally knows only version 1.
    const second = await runWithFiles(harness, root, sessionB, { 'shared.csv': 'a,b\n3,4\n' })
    const versionB = second.result.capture?.captured.at(0)
    if (versionB === undefined) throw new Error('interleaving test: expected session B to take version 2')
    expect(versionB).toMatchObject({ artifactId: versionA1.artifactId, version: 2 })

    // Session A appends again. It resolves the continuation from its OWN
    // local fold (which still only knows version 1), so it calls
    // `store.appendVersion` the same way a same-session continuation would
    // — but the store's linearized ordinal assignment gives it version 3,
    // not the 2 session A's own local history would predict. Before this
    // fix, committing that `science/artifact-saved` fact into session A's
    // own log would throw on replay (exact `latest.version + 1` only); the
    // fix accepts any version beyond session A's own locally-recorded
    // maximum, so the live Runtime's already-store-validated ordinal is
    // trusted instead of re-derived.
    const third = await runWithFiles(harness, root, sessionA, { 'shared.csv': 'a,b\n5,6\n' }, 'ok', true)
    const versionA2 = third.result.capture?.captured.at(0)
    if (versionA2 === undefined) throw new Error('interleaving test: expected session A to capture a further version')
    expect(versionA2).toMatchObject({ artifactId: versionA1.artifactId, version: 3, origin: 'auto' })

    // Session A's own session log replays cleanly with the accepted gap.
    const projectionA = replayScience(sessionA.events)
    expect(projectionA?.artifacts.map(v => v.version)).toEqual([1, 3])
  })

  it('continues writing to the same on-disk project store across a Host restart (fresh Context/Runtime, same project)', async () => {
    const root = tmp('.science-capture-restart-')
    const prefix = createFakePythonPrefix(root)
    const workspace = tmp('.science-restart-workspace-')

    const before = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    const sessionA = createScienceSession(before.ctx, 'science-restart-a', workspace)
    const first = await runWithFiles(before, root, sessionA, { 'restart.csv': 'a,b\n1,2\n' })
    const versionA = first.result.capture?.captured.at(0)
    if (versionA === undefined) throw new Error('restart test: expected session A to capture one version')
    // No in-memory state survives a Host restart — only what was durably
    // committed to disk under the same `dshHome`.
    await before.ctx.fiber.dispose()

    const after = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(after.ctx)
    const sessionB = createScienceSession(after.ctx, 'science-restart-b', workspace)
    const second = await runWithFiles(after, root, sessionB, { 'restart.csv': 'a,b\n3,4\n' })
    const versionB = second.result.capture?.captured.at(0)
    if (versionB === undefined) throw new Error('restart test: expected session B to continue the same artifact after restart')
    expect(versionB).toMatchObject({ artifactId: versionA.artifactId, logicalName: 'restart.csv', version: 2 })

    const artifacts = await after.ctx.scienceArtifactStore.listArtifacts(versionA.projectId)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ artifactId: versionA.artifactId, originSessionId: sessionA.id })
  })

  /** Mount a store double whose writes fail with `failure` while `openProject` still resolves a stable project. */
  function failingStoreOverride(failure: unknown) {
    return (ctx: Context): void => {
      ctx.provide('scienceArtifactStore', {
        openProject: async (workspacePath: string) => ({
          projectId: 'capture-test-project', storeRoot: workspacePath, workspacePath, outcome: 'created',
        }),
        listArtifacts: async () => [],
        createArtifact: async () => { throw failure },
        appendVersion: async () => { throw failure },
        readBlob: async () => { throw new Error('unexpected readBlob call') },
      } as never)
    }
  }

  it('does not fail the run when capture itself throws unexpectedly (a non-Error value), logging at error since it carries no filesystem code', async () => {
    const root = tmp('.science-capture-internal-failure-')
    const prefix = createFakePythonPrefix(root)
    const errors: string[] = []
    // Deliberately not an Error instance: exercises isCaptureFilesystemFailure's
    // non-object short circuit, mirroring environment.spec.ts's own
    // `throw 'injected non-Error static failure'` technique.
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 30_000, undefined, (ctx) => {
      ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
      failingStoreOverride('boom: capture-time infrastructure failure')(ctx)
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
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 30_000, undefined, (ctx) => {
      ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
      ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
      failingStoreOverride(Object.assign(new Error('disk unavailable'), { code: 'EIO' }))(ctx)
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
