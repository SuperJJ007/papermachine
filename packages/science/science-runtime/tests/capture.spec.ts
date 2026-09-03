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
import { ProjectArtifactStoreError } from '@deepseek-ai/dsh-science-artifact-store'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import { SessionId } from '@deepseek-ai/dsh-session'
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
  chartResult?: unknown,
  chartStatus?: 'error' | 'hang' | 'missing-result' | 'crash',
): Promise<Awaited<ReturnType<typeof harness.runtime.startRun>>> {
  if (!bound) {
    await harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
  }
  callCounter += 1
  return harness.runtime.startRun({
    session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status, chartResult, chartStatus }),
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
    const secondVersion = second.result.capture?.captured.at(0)
    expect(secondVersion).toMatchObject({ artifactId: baseline.artifactId, version: 2 })
    if (secondVersion === undefined) throw new Error('baseline test: expected a second captured version')
    // `baseVersionId`/`baseExplicit` are store-only provenance now (T1's
    // authority rule); the session event no longer carries `parent`.
    await expect(harness.ctx.scienceArtifactStore.getVersion(secondVersion.projectId, secondVersion.versionId))
      .resolves.toMatchObject({ baseVersionId: baseline.versionId, baseExplicit: true })

    const third = await runWithFiles(
      harness, root, session, { 'summary.csv': 'v3\n', 'branch.csv': 'branch\n' }, 'ok', true,
      { editBaselines: { 'summary.csv': parent, 'branch.csv': parent } },
    )
    const thirdSummary = third.result.capture?.captured.find(candidate => candidate.logicalName === 'summary.csv')
    expect(thirdSummary).toMatchObject({ artifactId: baseline.artifactId, version: 3 })
    if (thirdSummary === undefined) throw new Error('baseline test: expected a third summary.csv version')
    await expect(harness.ctx.scienceArtifactStore.getVersion(thirdSummary.projectId, thirdSummary.versionId))
      .resolves.toMatchObject({ baseVersionId: baseline.versionId, baseExplicit: true })
    const branch = third.result.capture?.captured.find(candidate => candidate.logicalName === 'branch.csv')
    expect(branch).toMatchObject({ version: 1 })
    if (branch === undefined) throw new Error('baseline test: expected one branch.csv version')
    expect(branch.artifactId).not.toBe(baseline.artifactId)
    await expect(harness.ctx.scienceArtifactStore.getVersion(branch.projectId, branch.versionId))
      .resolves.toMatchObject({ baseVersionId: baseline.versionId, baseExplicit: true })
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
    expect(captured).toMatchObject({ logicalName: 'plots/evidence.png', version: 1 })
    if (captured === undefined) throw new Error('capture test: expected one captured version')
    await expect(harness.ctx.scienceArtifactStore.getVersion(captured.projectId, captured.versionId))
      .resolves.toMatchObject({ mediaType: 'image/png' })
    const stored = await harness.ctx.scienceArtifactStore.readBlob(captured.projectId, captured.sha256)
    expect(stored).toEqual(source)
  })

  it('captures JSON case-insensitively with the generic JSON media type', async () => {
    const root = tmp('.science-capture-json-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-json')

    const { result } = await runWithFiles(harness, root, session, {
      'plots/summary.JSON': '{"rows":1}',
      'plots/meta.json': '{"rows":2}',
    })

    expect(result.capture?.captured).toHaveLength(2)
    const summary = result.capture?.captured.find(version => version.logicalName === 'plots/summary.JSON')
    const meta = result.capture?.captured.find(version => version.logicalName === 'plots/meta.json')
    if (summary === undefined || meta === undefined) throw new Error('json test: expected both versions captured')
    await expect(harness.ctx.scienceArtifactStore.getVersion(summary.projectId, summary.versionId))
      .resolves.toMatchObject({ mediaType: 'application/json' })
    await expect(harness.ctx.scienceArtifactStore.getVersion(meta.projectId, meta.versionId))
      .resolves.toMatchObject({ mediaType: 'application/json' })
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
    const csvV1 = first.result.capture?.captured.find(v => v.logicalName === 'summary.csv')
    const pngV1 = first.result.capture?.captured.find(v => v.logicalName === 'plot.png')
    expect(csvV1).toMatchObject({ logicalName: 'summary.csv', version: 1, title: 'summary.csv' })
    expect(pngV1).toMatchObject({ logicalName: 'plot.png', version: 1, title: 'plot.png' })
    if (csvV1 === undefined || pngV1 === undefined) throw new Error('capture test: expected both versions captured')
    await expect(harness.ctx.scienceArtifactStore.getVersion(csvV1.projectId, csvV1.versionId))
      .resolves.toMatchObject({ contentOrigin: 'run-auto', mediaType: 'text/csv' })
    await expect(harness.ctx.scienceArtifactStore.getVersion(pngV1.projectId, pngV1.versionId))
      .resolves.toMatchObject({ contentOrigin: 'run-auto', mediaType: 'image/png' })
    expect(first.result.capture?.chartUnavailablePaths).toEqual(['plot.png'])

    const handle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok' }),
      ...authorizeRunInTurn(session, 'capture-later-turn', 2), signal: new AbortController().signal,
    })
    await writeArtifact(root, session, handle.runId, 'summary.csv', 'a,b\n3,4\n')
    const second = await handle.done
    expect(second.capture?.captured).toHaveLength(1)
    const csvV2 = second.capture?.captured[0]
    expect(csvV2).toMatchObject({ logicalName: 'summary.csv', version: 2 })
    if (csvV2 === undefined) throw new Error('capture test: expected a second summary.csv version')
    await expect(harness.ctx.scienceArtifactStore.getVersion(csvV2.projectId, csvV2.versionId))
      .resolves.toMatchObject({ contentOrigin: 'run-auto' })

    const projection = replayScience(session.events)
    const versions = projection?.artifacts.filter(candidate => candidate.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1, 2])
  })

  it('attaches validated chart state only to an allowed captured PNG', async () => {
    const root = tmp('.science-capture-chart-state-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-chart-state')
    const chart = {
      runtime: 'matplotlib',
      png: { width: 1, height: 1, dpi: 100 },
      elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Evidence' }],
      hitmap: [],
      hitmapStatus: 'unavailable',
    }
    const handle = await startHeldRun(
      harness,
      session,
      'ok',
      false,
      { rasterArtifacts: ['plot.png'] },
      { charts: { 'plot.png': chart, 'undeclared.png': chart, 'table.csv': chart }, errors: { 'missed.png': 'not registered' } },
    )
    await writeArtifact(root, session, handle.runId, 'plot.png', PNG)
    await writeArtifact(root, session, handle.runId, 'table.csv', 'value\n1\n')
    const result = await handle.done
    expect(result.capture?.captured).toHaveLength(2)
    const pngVersion = result.capture?.captured.find(version => version.logicalName === 'plot.png')
    const csvVersion = result.capture?.captured.find(version => version.logicalName === 'table.csv')
    expect(pngVersion).toMatchObject({ logicalName: 'plot.png' })
    if (pngVersion === undefined || csvVersion === undefined) throw new Error('chart test: expected both versions captured')
    // Figure state (elements, op log, hitmap) lives only in the store's
    // `figure_state` side table now, keyed by versionId (T1).
    await expect(harness.ctx.scienceArtifactStore.getFigureState(pngVersion.projectId, pngVersion.versionId))
      .resolves.toMatchObject({ figureKey: 'plot.png', dpi: 100 })
    await expect(harness.ctx.scienceArtifactStore.getFigureState(csvVersion.projectId, csvVersion.versionId))
      .resolves.toBeUndefined()
    expect(result.capture?.chartUnavailablePaths).toEqual([])
  })

  it('keeps PNG capture when the kernel rejects chart extraction or returns invalid JSON data', async () => {
    const root = tmp('.science-capture-chart-failure-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-chart-failure')

    const rejected = await startHeldRun(
      harness, session, 'ok', false, { rasterArtifacts: ['rejected.png'] }, undefined, 'error',
    )
    await writeArtifact(root, session, rejected.runId, 'rejected.png', PNG)
    const rejectedResult = await rejected.done
    expect(rejectedResult.capture?.captured[0]).not.toHaveProperty('chart')
    expect(rejectedResult.capture?.chartUnavailablePaths).toEqual(['rejected.png'])

    const invalid = await startHeldRun(
      harness, session, 'ok', true, { rasterArtifacts: ['invalid.png'] }, 'not-an-object',
    )
    await writeArtifact(root, session, invalid.runId, 'invalid.png', PNG)
    const invalidResult = await invalid.done
    expect(invalidResult.capture?.captured[0]).not.toHaveProperty('chart')
    expect(invalidResult.capture?.chartUnavailablePaths).toEqual(['invalid.png'])

    const invalidChart = await startHeldRun(
      harness, session, 'ok', true, { rasterArtifacts: ['invalid-chart.png'] },
      { charts: { 'invalid-chart.png': { runtime: 'unknown' } }, errors: {} },
    )
    await writeArtifact(root, session, invalidChart.runId, 'invalid-chart.png', PNG)
    expect((await invalidChart.done).capture?.chartUnavailablePaths).toEqual(['invalid-chart.png'])

    const invalidError = await startHeldRun(
      harness, session, 'ok', true, { rasterArtifacts: ['invalid-error.png'] },
      { charts: {}, errors: { 'invalid-error.png': 1 } },
    )
    await writeArtifact(root, session, invalidError.runId, 'invalid-error.png', PNG)
    expect((await invalidError.done).capture?.chartUnavailablePaths).toEqual(['invalid-error.png'])

    const missingResult = await startHeldRun(
      harness, session, 'ok', true, { rasterArtifacts: ['missing-result.png'] }, undefined, 'missing-result',
    )
    await writeArtifact(root, session, missingResult.runId, 'missing-result.png', PNG)
    expect((await missingResult.done).capture?.chartUnavailablePaths).toEqual(['missing-result.png'])
  })

  it('extracts every eligible PNG under the always policy and retires a kernel that exits during extraction', async () => {
    const root = tmp('.science-capture-chart-always-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 30_000, undefined, undefined, { rasterCapture: 'always' },
    )
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-chart-always')
    const exited = await startHeldRun(harness, session, 'ok', false, undefined, undefined, 'crash')
    await writeArtifact(root, session, exited.runId, 'plot.png', PNG)
    expect((await exited.done).capture?.chartUnavailablePaths).toEqual(['plot.png'])

    const next = await startHeldRun(harness, session, 'ok', true)
    await next.done
    const starts = session.events.filter(event => event.type === 'science/run-started')
    expect(starts.map(event => event.data.run.kernelEpoch)).toEqual([1, 2])
  })

  it('retires a kernel after chart extraction times out while preserving ordinary PNG capture', async () => {
    const root = tmp('.science-capture-chart-timeout-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(
      root,
      { fake: { pythonPrefix: prefix } },
      30_000,
      undefined,
      undefined,
      { chartExtractTimeoutMs: 20 },
    )
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-chart-timeout')
    const first = await startHeldRun(
      harness, session, 'ok', false, { rasterArtifacts: ['plot.png'] }, undefined, 'hang',
    )
    await writeArtifact(root, session, first.runId, 'plot.png', PNG)
    const firstResult = await first.done
    expect(firstResult.capture?.captured[0]).not.toHaveProperty('chart')
    expect(firstResult.capture?.chartUnavailablePaths).toEqual(['plot.png'])

    const next = await startHeldRun(harness, session, 'ok', true)
    await next.done
    const starts = session.events.filter(event => event.type === 'science/run-started')
    expect(starts.map(event => event.data.run.kernelEpoch)).toEqual([1, 2])
  })

  it('skips chart extraction when run settlement already requires kernel retirement', async () => {
    const root = tmp('.science-capture-chart-retiring-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(
      root,
      { fake: { pythonPrefix: prefix } },
      30_000,
      undefined,
      undefined,
      { chartExtractTimeoutMs: 10_000 },
    )
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-chart-retiring')
    const handle = await startHeldRun(
      harness, session, 'ok', false, { rasterArtifacts: ['plot.png'] }, undefined, 'hang',
    )
    await writeArtifact(root, session, handle.runId, 'plot.png', PNG)
    handle.cancel()
    const settled = await Promise.race([
      handle.done,
      new Promise<'timed-out'>(resolve => setTimeout(() => { resolve('timed-out') }, 1_000)),
    ])
    expect(settled).not.toBe('timed-out')
    if (settled === 'timed-out') throw new Error('chart extraction ran for a retiring kernel')
    expect(settled.capture?.chartUnavailablePaths).toEqual(['plot.png'])
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
    const latest = versions.at(1)
    if (latest === undefined) throw new Error('capture test: expected a second summary.csv version')
    // `contentOrigin`/`producerRunId` are store-only provenance now (T1);
    // the session projection carries no more than the versionId reference.
    await expect(harness.ctx.scienceArtifactStore.getVersion(latest.projectId, latest.versionId)).resolves.toMatchObject({
      contentOrigin: 'run-auto', producerRunId: String(handle.runId),
    })
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
    const secondVersion = second.capture?.captured[0]
    expect(secondVersion).toMatchObject({ logicalName: 'summary.csv', version: 2 })
    if (secondVersion === undefined) throw new Error('baseline test: expected a second captured version')

    // The strict fold's own-versionId dedup check (transition.ts) throws
    // loudly on a versionId already backing a committed version; a clean
    // replay proves the appended version never collided with its baseline.
    const projection = replayScience(session.events)
    const versions = projection?.artifacts.filter(a => a.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1, 2])
    // `baseVersionId`/`baseExplicit` are store-only now (T1's authority rule).
    await expect(harness.ctx.scienceArtifactStore.getVersion(secondVersion.projectId, secondVersion.versionId))
      .resolves.toMatchObject({ baseVersionId: baseline.versionId, baseExplicit: true })
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
    const secondVersion = second.capture?.captured[0]
    expect(secondVersion).toMatchObject({ logicalName: 'summary.csv', version: 2 })
    if (secondVersion === undefined) throw new Error('baseline test: expected a second captured version')
    await expect(harness.ctx.scienceArtifactStore.getVersion(secondVersion.projectId, secondVersion.versionId))
      .resolves.toMatchObject({ baseVersionId: v1.versionId, baseExplicit: true })

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
    const thirdVersion = third.capture?.captured[0]
    expect(thirdVersion).toMatchObject({ logicalName: 'summary.csv', version: 3 })
    if (thirdVersion === undefined) throw new Error('baseline test: expected a third captured version')
    await expect(harness.ctx.scienceArtifactStore.getVersion(thirdVersion.projectId, thirdVersion.versionId))
      .resolves.toMatchObject({ baseVersionId: v1.versionId, baseExplicit: true })

    const projection = replayScience(session.events)
    const versions = projection?.artifacts.filter(a => a.logicalName === 'summary.csv') ?? []
    expect(versions.map(v => v.version)).toEqual([1, 2, 3])
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
    const original = 'PNG original'

    const first = await runWithFiles(
      harness, root, session, { 'chart.png': original }, 'ok', false, { rasterArtifacts: ['chart.png'] },
    )
    const parent = first.result.capture?.captured[0]
    if (parent === undefined) throw new Error('expected run-produced PNG parent')
    const store = harness.ctx.scienceArtifactStore
    const humanEditV2 = await store.appendVersion(parent.projectId, parent.artifactId, {
      producerSessionId: session.id,
      data: new TextEncoder().encode('PNG human edit'),
      mediaType: 'image/png',
      contentOrigin: 'human-edit',
      baseVersionId: parent.versionId,
    })
    await store.annotateVersion(parent.projectId, humanEditV2.versionId, { actor: 'human', sessionId: session.id, title: parent.title })
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: parent.artifactId,
        logicalName: parent.logicalName,
        version: humanEditV2.ordinal,
        title: parent.title,
        projectId: parent.projectId,
        versionId: humanEditV2.versionId,
        sha256: humanEditV2.sha256,
        seenAt: Date.now(),
      },
    })

    const untouched = await runWithFiles(
      harness, root, session, { 'chart.png': original }, 'ok', true, { rasterArtifacts: ['chart.png'] },
    )
    expect(untouched.result.capture?.captured).toEqual([])
    expect(replayScience(session.events)?.artifacts.filter(artifact => artifact.logicalName === 'chart.png'))
      .toHaveLength(2)

    const changed = await runWithFiles(
      harness,
      root,
      session,
      { 'chart.png': 'PNG model edit' },
      'ok',
      true,
      { rasterArtifacts: ['chart.png'] },
    )
    const changedVersion = changed.result.capture?.captured[0]
    expect(changedVersion).toMatchObject({ artifactId: parent.artifactId, logicalName: 'chart.png', version: 3 })
    if (changedVersion === undefined) throw new Error('expected run-produced PNG version')
    await expect(store.getVersion(changedVersion.projectId, changedVersion.versionId))
      .resolves.toMatchObject({ contentOrigin: 'run-auto' })
    const humanEditV4 = await store.appendVersion(parent.projectId, parent.artifactId, {
      producerSessionId: session.id,
      data: new TextEncoder().encode('PNG second human edit'),
      mediaType: 'image/png',
      contentOrigin: 'human-edit',
      baseVersionId: changedVersion.versionId,
    })
    await store.annotateVersion(parent.projectId, humanEditV4.versionId, { actor: 'human', sessionId: session.id, title: parent.title })
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: parent.artifactId,
        logicalName: parent.logicalName,
        version: humanEditV4.ordinal,
        title: parent.title,
        projectId: parent.projectId,
        versionId: humanEditV4.versionId,
        sha256: humanEditV4.sha256,
        seenAt: Date.now(),
      },
    })

    const intentional = await runWithFiles(
      harness,
      root,
      session,
      { 'chart.png': original },
      'ok',
      true,
      { editBaselines: { 'chart.png': { artifactId: parent.artifactId, version: 4 } }, rasterArtifacts: ['chart.png'] },
    )
    const intentionalVersion = intentional.result.capture?.captured[0]
    expect(intentionalVersion).toMatchObject({ artifactId: parent.artifactId, logicalName: 'chart.png', version: 5 })
    if (intentionalVersion === undefined) throw new Error('expected a fifth chart.png version')
    await expect(store.getVersion(intentionalVersion.projectId, intentionalVersion.versionId)).resolves.toMatchObject({
      contentOrigin: 'run-auto', baseVersionId: humanEditV4.versionId, baseExplicit: true,
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
    const captured = result.capture?.captured[0]
    expect(captured).toMatchObject({ logicalName: 'partial.json' })
    if (captured === undefined) throw new Error('capture test: expected one captured version')
    await expect(harness.ctx.scienceArtifactStore.getVersion(captured.projectId, captured.versionId))
      .resolves.toMatchObject({ contentOrigin: 'run-auto' })
    const projection = replayScience(session.events)
    expect(projection?.artifacts).toHaveLength(1)
  })

  it('continues an existing artifact when a different session captures the same logical name with new content (D7)', async () => {
    const root = tmp('.science-capture-cross-session-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const workspace = tmp('.science-cross-session-workspace-')
    const sessionA = createScienceSession(harness.ctx, 'science-cross-session-a', workspace)
    const sessionB = createScienceSession(harness.ctx, 'science-cross-session-b', workspace)
    const first = await runWithFiles(harness, root, sessionA, { 'shared.csv': 'a,b\n1,2\n' })
    const versionA = first.result.capture?.captured.at(0)
    if (versionA === undefined) throw new Error('expected session A capture')

    // sessionB's own fold has never captured `shared.csv` at all, but the
    // project's store already has an artifact under that logical name from
    // sessionA — the lazy `listArtifacts` lookup (D7) continues that same
    // artifact's version chain instead of colliding with the store's
    // UNIQUE(owningProjectId, logicalName) constraint.
    const second = await runWithFiles(harness, root, sessionB, { 'shared.csv': 'a,b\n3,4\n' })
    const versionB = second.result.capture?.captured.at(0)
    if (versionB === undefined) throw new Error('expected session B capture')
    expect(versionB).toMatchObject({ logicalName: 'shared.csv', version: 2 })
    expect(versionB.artifactId).toBe(versionA.artifactId)
    const artifacts = await harness.ctx.scienceArtifactStore.listArtifacts(versionA.projectId)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ artifactId: versionA.artifactId, latestVersionId: versionB.versionId })

    const third = await runWithFiles(harness, root, sessionA, { 'shared.csv': 'a,b\n5,6\n' }, 'ok', true)
    expect(third.result.capture?.captured.at(0)).toMatchObject({ artifactId: versionA.artifactId, version: 3 })
    expect(replayScience(sessionA.events)?.artifacts.map(version => version.version)).toEqual([1, 3])
  })

  it('skips a same-named capture in another session whose content already matches the store head (D7)', async () => {
    const root = tmp('.science-capture-cross-session-identical-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const workspace = tmp('.science-cross-session-identical-workspace-')
    const sessionA = createScienceSession(harness.ctx, 'science-cross-session-identical-a', workspace)
    const sessionB = createScienceSession(harness.ctx, 'science-cross-session-identical-b', workspace)
    const first = await runWithFiles(harness, root, sessionA, { 'shared.csv': 'a,b\n1,2\n' })
    const versionA = first.result.capture?.captured.at(0)
    if (versionA === undefined) throw new Error('expected session A capture')

    // sessionB captures the SAME bytes: the store's current head (read via
    // D7's lazy lookup, not sessionB's own empty local history) already
    // has this sha256, so no redundant version opens.
    const second = await runWithFiles(harness, root, sessionB, { 'shared.csv': 'a,b\n1,2\n' })
    expect(second.result.capture?.captured).toEqual([])
    const artifacts = await harness.ctx.scienceArtifactStore.listArtifacts(versionA.projectId)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ artifactId: versionA.artifactId, latestVersionId: versionA.versionId })
  })

  it('recovers from a concurrent create of the same logical name by continuing the winning artifact (D7 create race)', async () => {
    const root = tmp('.science-capture-race-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-race')
    const store = harness.ctx.scienceArtifactStore
    // oxlint-disable-next-line typescript/unbound-method -- call() below supplies the real store as this.
    const originalCreateArtifact = store.createArtifact
    let injected = false
    const spy = vi.spyOn(store, 'createArtifact').mockImplementation(async function (this: typeof store, projectId, input) {
      if (!injected && input.logicalName === 'race.csv') {
        injected = true
        // Simulate a genuinely concurrent winner: a DIFFERENT session
        // creates this same logical name between this walk's D7 lookup
        // (which found nothing) and this create call.
        await originalCreateArtifact.call(this, projectId, { ...input, originSessionId: SessionId('science-capture-race-winner') })
        throw new ProjectArtifactStoreError('injected race: logical name already exists', 'LOGICAL_NAME_CONFLICT')
      }
      return originalCreateArtifact.call(this, projectId, input)
    })
    try {
      const { result } = await runWithFiles(harness, root, session, { 'race.csv': 'a,b\n1,2\n' })
      expect(result.capture?.captured).toHaveLength(1)
      const captured = result.capture?.captured[0]
      // The winner's create already opened version 1; this walk's recovery
      // appends onto it as version 2 rather than failing the file.
      expect(captured).toMatchObject({ logicalName: 'race.csv', version: 2 })
      if (captured === undefined) throw new Error('race test: expected a captured version')
      const artifacts = await store.listArtifacts(captured.projectId)
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toMatchObject({ artifactId: captured.artifactId, latestVersionId: captured.versionId })
    } finally {
      spy.mockRestore()
    }
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
    // sessionB's fresh-process fold has never captured `restart.csv`; D7's
    // lazy store lookup continues sessionA's artifact even after a full
    // Host restart, since the lookup reads the on-disk store, not memory.
    const second = await runWithFiles(after, root, sessionB, { 'restart.csv': 'a,b\n3,4\n' })
    const versionB = second.result.capture?.captured.at(0)
    if (versionB === undefined) throw new Error('restart test: expected session B to continue the artifact after restart')
    expect(versionB).toMatchObject({ logicalName: 'restart.csv', version: 2 })
    expect(versionB.artifactId).toBe(versionA.artifactId)

    const artifacts = await after.ctx.scienceArtifactStore.listArtifacts(versionA.projectId)
    expect(artifacts).toHaveLength(1)
    expect(artifacts.find(artifact => artifact.artifactId === versionA.artifactId)).toMatchObject({
      originSessionId: sessionA.id, latestVersionId: versionB.versionId,
    })
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

  it('does not treat a store failure under a different code as the D7 create race', async () => {
    const root = tmp('.science-capture-other-store-error-')
    const prefix = createFakePythonPrefix(root)
    const warnings: string[] = []
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 30_000, undefined, (ctx) => {
      // ProjectArtifactStoreError carries a string `code` like an
      // ErrnoException, so isCaptureFilesystemFailure classifies it at warn
      // — this test only proves the LOGICAL_NAME_CONFLICT retry itself was
      // not taken (the injected error propagates unchanged), not the log level.
      ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
      failingStoreOverride(new ProjectArtifactStoreError('injected: not a logical-name conflict', 'ARTIFACT_NOT_FOUND'))(ctx)
    })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-capture-other-store-error')

    const { result } = await runWithFiles(harness, root, session, { 'note.txt': 'hello' })
    expect(result.terminal.status).toBe('success')
    expect(result.capture).toBeUndefined()
    expect(replayScience(session.events)?.artifacts).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('injected: not a logical-name conflict')
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
