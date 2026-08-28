/** Direct chart editing through the assembled Runtime and fake persistent kernel. */

import { mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId, ScienceVersionId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceChartOp, ScienceHumanEditArtifactVersion } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { planRunScratch, planSessionScratch } from '../src/scratch.ts'
import {
  authorizeAnnotateArtifact,
  authorizePythonRun,
  createFakePythonPrefix,
  createKernelRuntimeHarness,
  createScienceSession,
  kernelAction,
} from './harness.ts'

vi.setConfig({ testTimeout: 30_000 })

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const extraction = {
  runtime: 'matplotlib',
  png: { width: 1, height: 1, dpi: 120 },
  elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Original' }],
  hitmap: [{ id: 'title', bbox: [0, 0, 1, 1], z: 1 }],
  hitmapStatus: 'ok',
}

const editExtraction = {
  ...extraction,
  elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Edited' }],
}

const titleOp = { op: 'set_title', axes: null, text: 'Edited' } as const satisfies ScienceChartOp
const ops: readonly ScienceChartOp[] = [
  titleOp,
  { op: 'set_axis_label', axes: 0, axis: 'x', text: 'Dose' },
]

async function harness(id: string, action: Record<string, unknown> = {}): Promise<{
  readonly root: string
  readonly runtime: Awaited<ReturnType<typeof createKernelRuntimeHarness>>['runtime']
  readonly session: Session
}> {
  const root = mkdtempSync(join(process.cwd(), '.science-chart-edit-'))
  roots.push(root)
  const prefix = createFakePythonPrefix(root)
  const assembled = await createKernelRuntimeHarness(
    root,
    { fake: { pythonPrefix: prefix } },
    10_000,
    1_800_000,
    undefined,
    { chartExtractTimeoutMs: 30 },
  )
  contexts.push(assembled.ctx)
  const session = createScienceSession(assembled.ctx, id)
  await assembled.runtime.bindEnvironment({
    session,
    profileId: ScienceEnvironmentProfileId('fake'),
    signal: new AbortController().signal,
  })
  const handle = await assembled.runtime.startRun({
    session,
    language: 'python',
    code: kernelAction({
      status: 'ok',
      artifact: 'tiny-png',
      chartResult: { charts: { 'plot.png': extraction }, errors: {} },
      chartApplyResult: { chart: editExtraction, failedOps: [] },
      ...action,
    }),
    rasterArtifacts: ['plot.png'],
    ...authorizePythonRun(session, `${id}-run`),
    signal: new AbortController().signal,
  })
  await handle.done
  return { root, runtime: assembled.runtime, session }
}

function chart(session: Session) {
  const artifact = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'plot.png')
  if (artifact === undefined) throw new Error('chart fixture was not captured')
  return artifact
}

function appendHumanEdit(
  session: Session,
  parent: ReturnType<typeof chart>,
  overrides: Partial<ScienceHumanEditArtifactVersion>,
): void {
  if (parent.origin === 'human-edit') throw new Error('synthetic edit parent must be run-origin')
  if (parent.mediaType !== 'image/png') throw new Error('synthetic edit parent must be a PNG')
  const { runId: _runId, toolCallId: _toolCallId, requestHeaderSeq: _requestHeaderSeq, ...common } = parent
  const artifact: ScienceHumanEditArtifactVersion = {
    ...common,
    version: parent.version + 1,
    versionId: ScienceVersionId(`${String(parent.versionId)}-synthetic-${String(parent.version + 1)}`),
    parent: { artifactId: parent.artifactId, version: parent.version },
    origin: 'human-edit',
    mediaType: 'image/png',
    createdAt: Date.now(),
    ...overrides,
  }
  session.append('science/artifact-saved', {
    version: 1,
    artifact,
  })
}

describe('ScienceRuntime.applyChartEdit', () => {
  it('commits one warm human-edit version with cumulative successful operations', async () => {
    const { runtime, session } = await harness('chart-edit-warm')
    const parent = chart(session)
    const result = await runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: parent.version, ops, signal: new AbortController().signal,
    })
    expect(result.failedOps).toEqual([])
    expect(result.artifact).toMatchObject({ version: 2, origin: 'human-edit', parent: { version: 1 } })
    expect(result.artifact.chart?.ops).toEqual(ops)
    expect(session.events.filter(event => event.type === 'science/run-started')).toHaveLength(1)
  })

  it('replays an unregistered source without publishing a scientific run', async () => {
    const { runtime, session, root } = await harness('chart-edit-replay', { chartApplyStatus: 'not_registered_once' })
    const parent = chart(session)
    const result = await runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: parent.version, ops: [titleOp], signal: new AbortController().signal,
    })
    expect(result.artifact).toMatchObject({ version: 2, origin: 'human-edit' })
    expect(session.events.filter(event => event.type === 'science/run-started')).toHaveLength(1)
    const sessionScratch = await planSessionScratch(join(root, 'dsh-home'), session)
    expect(readdirSync(sessionScratch.runs).filter(name => name.startsWith('replay-'))).toEqual([])
  })

  it('rejects stale, unaddressable, empty, and wholly unresolved edits', async () => {
    const warm = await harness('chart-edit-validation')
    const parent = chart(warm.session)
    const committed = await warm.runtime.applyChartEdit({
      session: warm.session, artifactId: parent.artifactId, version: parent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })
    await expect(warm.runtime.applyChartEdit({
      session: warm.session, artifactId: parent.artifactId, version: parent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_STALE_VERSION' })
    await expect(warm.runtime.applyChartEdit({
      session: warm.session, artifactId: committed.artifact.artifactId, version: committed.artifact.version,
      ops: [], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_OP_INVALID' })

    const missing = await harness('chart-edit-unaddressable', { chartResult: { charts: {}, errors: {} } })
    const png = chart(missing.session)
    await expect(missing.runtime.applyChartEdit({
      session: missing.session, artifactId: png.artifactId, version: png.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })

    const unresolved = await harness('chart-edit-unresolved', {
      chartApplyResult: { chart: editExtraction, failedOps: [{ index: 0, reason: 'element_not_found' }] },
    })
    const unresolvedParent = chart(unresolved.session)
    await expect(unresolved.runtime.applyChartEdit({
      session: unresolved.session, artifactId: unresolvedParent.artifactId, version: unresolvedParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_ELEMENT_NOT_FOUND' })
  })

  it('rejects cumulative overflow and mismatched source provenance', async () => {
    const overflow = await harness('chart-edit-overflow')
    const overflowParent = chart(overflow.session)
    appendHumanEdit(overflow.session, overflowParent, {
      chart: { ...overflowParent.chart!, ops: [titleOp] },
    })
    await expect(overflow.runtime.applyChartEdit({
      session: overflow.session, artifactId: overflowParent.artifactId, version: 2,
      ops: Array.from({ length: 100 }, () => titleOp), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_OP_INVALID' })

    const noSource = await harness('chart-edit-no-source')
    const noSourceParent = chart(noSource.session)
    appendHumanEdit(noSource.session, noSourceParent, {
      chart: { ...noSourceParent.chart!, figureKey: 'missing.png' },
    })
    await expect(noSource.runtime.applyChartEdit({
      session: noSource.session, artifactId: noSourceParent.artifactId, version: 2,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })

    const mismatch = await harness('chart-edit-language-mismatch')
    const mismatchParent = chart(mismatch.session)
    appendHumanEdit(mismatch.session, mismatchParent, {
      chart: { ...mismatchParent.chart!, runtime: 'ggplot2' },
    })
    await expect(mismatch.runtime.applyChartEdit({
      session: mismatch.session, artifactId: mismatchParent.artifactId, version: 2,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })
  }, 90_000)

  it('rejects failed and still-unregistered source replay', async () => {
    const failedReplay = await harness('chart-edit-failed-replay', { chartApplyStatus: 'not_registered_once' })
    const failedReplayParent = chart(failedReplay.session)
    const failedRun = replayScience(failedReplay.session.events)?.runs[0]
    if (failedRun === undefined) throw new Error('source run was not recorded')
    const failedScratch = await planSessionScratch(join(failedReplay.root, 'dsh-home'), failedReplay.session)
    writeFileSync(planRunScratch(failedScratch, failedRun.runId, failedRun.language).source, kernelAction({ status: 'error' }))
    await expect(failedReplay.runtime.applyChartEdit({
      session: failedReplay.session, artifactId: failedReplayParent.artifactId, version: failedReplayParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })

    const unregistered = await harness('chart-edit-unregistered-replay', { chartApplyStatus: 'not_registered' })
    const unregisteredParent = chart(unregistered.session)
    await expect(unregistered.runtime.applyChartEdit({
      session: unregistered.session, artifactId: unregisteredParent.artifactId, version: unregisteredParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })
  }, 60_000)

  it('rejects malformed chart-apply result envelopes and failed-op entries', async () => {
    for (const [id, chartApplyResult] of [
      ['root', []],
      ['failed-op', { chart: editExtraction, failedOps: [{ index: -1, reason: 'invalid' }] }],
    ] as const) {
      const malformed = await harness(`chart-edit-malformed-${id}`, { chartApplyResult })
      const malformedParent = chart(malformed.session)
      await expect(malformed.runtime.applyChartEdit({
        session: malformed.session, artifactId: malformedParent.artifactId, version: malformedParent.version,
        ops: [titleOp], signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
    }

    const failed = await harness('chart-edit-kernel-error', { chartApplyStatus: 'error' })
    const failedParent = chart(failed.session)
    await expect(failed.runtime.applyChartEdit({
      session: failed.session, artifactId: failedParent.artifactId, version: failedParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
  }, 60_000)

  it('preserves a curated caption on the stored and projected human-edit version', async () => {
    const { runtime, session } = await harness('chart-edit-caption')
    const parent = chart(session)
    await runtime.annotateArtifact({
      session,
      logicalName: parent.logicalName,
      title: parent.title,
      caption: 'Curated caption',
      ...authorizeAnnotateArtifact(session),
      signal: new AbortController().signal,
    })
    const result = await runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: parent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })
    expect(result.artifact.caption).toBe('Curated caption')
  })

  it('commits partial success and reports the failed request index', async () => {
    const { runtime, session } = await harness('chart-edit-partial', {
      chartApplyResult: { chart: editExtraction, failedOps: [{ index: 1, reason: 'element_not_found' }] },
    })
    const parent = chart(session)
    const result = await runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: parent.version, ops, signal: new AbortController().signal,
    })
    expect(result.failedOps).toEqual([{ index: 1, reason: 'element_not_found' }])
    expect(result.artifact.chart?.ops).toEqual([titleOp])
  })

  it('retires a timed-out kernel and rejects replay when source scratch is gone', async () => {
    const timed = await harness('chart-edit-timeout', { chartApplyStatus: 'hang' })
    const timedParent = chart(timed.session)
    await expect(timed.runtime.applyChartEdit({
      session: timed.session, artifactId: timedParent.artifactId, version: timedParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
    expect(replayScience(timed.session.events)?.kernels.some(kernel => kernel.state === 'exited')).toBe(true)

    const missing = await harness('chart-edit-missing-source', { chartApplyStatus: 'not_registered_once' })
    const missingParent = chart(missing.session)
    const run = replayScience(missing.session.events)?.runs[0]
    if (run === undefined) throw new Error('source run was not recorded')
    const scratch = await planSessionScratch(join(missing.root, 'dsh-home'), missing.session)
    unlinkSync(planRunScratch(scratch, run.runId, run.language).source)
    await expect(missing.runtime.applyChartEdit({
      session: missing.session, artifactId: missingParent.artifactId, version: missingParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })
  })
})
