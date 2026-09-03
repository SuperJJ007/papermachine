/** Direct chart editing through the assembled Runtime and fake persistent kernel. */

import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId, ScienceRunId, decodeScienceChartState, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactVersion, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { planRunScratch, planSessionScratch } from '../src/scratch.ts'
import { KernelProcess } from '../src/kernel-process.ts'
import type { Config } from '../src/config.ts'
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
  vi.restoreAllMocks()
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

async function harness(id: string, action: Record<string, unknown> = {}, timeoutMs = 10_000, config: Partial<Config> = {}): Promise<{
  readonly root: string
  readonly ctx: Context
  readonly runtime: Awaited<ReturnType<typeof createKernelRuntimeHarness>>['runtime']
  readonly session: Session
}> {
  const root = mkdtempSync(join(process.cwd(), '.science-chart-edit-'))
  roots.push(root)
  const prefix = createFakePythonPrefix(root)
  const assembled = await createKernelRuntimeHarness(
    root,
    { fake: { pythonPrefix: prefix } },
    timeoutMs,
    1_800_000,
    undefined,
    { chartExtractTimeoutMs: 30, ...config },
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
  return { root, ctx: assembled.ctx, runtime: assembled.runtime, session }
}

function chart(session: Session): ScienceArtifactVersion {
  const artifact = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'plot.png')
  if (artifact === undefined) throw new Error('chart fixture was not captured')
  return artifact
}

/** Read one version's live-figure-object state from the store and decode it. */
async function figureStateOf(ctx: Context, artifact: ScienceArtifactVersion): Promise<ScienceChartState> {
  const state = await ctx.scienceArtifactStore.getFigureState(artifact.projectId, artifact.versionId)
  if (state === undefined) throw new Error('chart test: expected a figure_state row for this version')
  return decodeScienceChartState(JSON.parse(state.stateJson))
}

/** Read the run that produced one version, from its store row's `producerRunId`. */
async function producerRunIdOf(ctx: Context, artifact: ScienceArtifactVersion) {
  const record = await ctx.scienceArtifactStore.getVersion(artifact.projectId, artifact.versionId)
  if (record?.producerRunId === undefined) throw new Error('chart test: expected a run-produced version with a producerRunId')
  return ScienceRunId(record.producerRunId)
}

/**
 * Synthesize one human-edit version directly against the store and its
 * matching slimmed `science/artifact-saved` event, mirroring what
 * `ScienceRuntime`'s own `commitStyleEdit` path writes: `appendVersion` with
 * `contentOrigin: 'human-edit'` and `baseVersionId` set to the parent, a
 * `figure_state` row derived from the parent's own (optionally overridden),
 * and a title-inheriting `annotateVersion` call.
 */
async function appendHumanEdit(
  ctx: Context,
  session: Session,
  parent: ScienceArtifactVersion,
  chartOverride: Partial<ScienceChartState> = {},
  data: Uint8Array | string = 'synthetic human edit',
): Promise<ScienceArtifactVersion> {
  const store = ctx.scienceArtifactStore
  const parentChart = await figureStateOf(ctx, parent)
  const editedChart = { ...parentChart, ...chartOverride }
  const stored = await store.appendVersion(parent.projectId, parent.artifactId, {
    producerSessionId: session.id,
    data: typeof data === 'string' ? new TextEncoder().encode(data) : data,
    mediaType: 'image/png',
    contentOrigin: 'human-edit',
    baseVersionId: parent.versionId,
    figureState: { figureKey: editedChart.figureKey, dpi: editedChart.png.dpi, stateJson: JSON.stringify(editedChart) },
  })
  await store.annotateVersion(parent.projectId, stored.versionId, { actor: 'human', sessionId: session.id, title: parent.title })
  const artifact: ScienceArtifactVersion = {
    artifactId: parent.artifactId,
    logicalName: parent.logicalName,
    version: stored.ordinal,
    title: parent.title,
    projectId: parent.projectId,
    versionId: stored.versionId,
    sha256: stored.sha256,
    seenAt: Date.now(),
  }
  session.append('science/artifact-saved', { version: 1, artifact })
  return artifact
}

describe('ScienceRuntime.applyChartEdit', () => {
  it('edits the newest producing run and keeps that source through consecutive human edits', async () => {
    const { ctx, runtime, session } = await harness('chart-edit-newest-source')
    const first = chart(session)
    const secondExtraction = { ...editExtraction, elements: [{ ...editExtraction.elements[0], current: 'Second source' }] }
    const handle = await runtime.startRun({
      session, language: 'python',
      code: kernelAction({ status: 'ok', artifact: 'tiny-png', chartResult: { charts: { 'plot.png': extraction }, errors: {} },
        artifactPngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=',
        chartApplyResult: { chart: secondExtraction, failedOps: [] } }),
      rasterArtifacts: ['plot.png'], ...authorizePythonRun(session, 'second-source'), signal: new AbortController().signal,
    })
    await handle.done
    for (const version of [2, 3]) {
      const result = await runtime.applyChartEdit({
        session, artifactId: first.artifactId, version, ops: [titleOp], signal: new AbortController().signal,
      })
      const resultChart = await figureStateOf(ctx, result.artifact)
      expect(resultChart.elements).toEqual(secondExtraction.elements)
      expect(resultChart.ops).toHaveLength(version - 1)
    }
  })

  it.each(['warm', 'evicted'])('sends all committed operations on %s kernels and reports new failure indices', async (registration) => {
    const { ctx, runtime, session } = await harness(`chart-edit-cumulative-${registration}`, {
      evictCharts: registration === 'evicted', chartApplyResult: { chart: editExtraction, failedOps: [{ index: 2, reason: 'element_not_found' }] },
    })
    const parent = chart(session)
    await appendHumanEdit(ctx, session, parent, { ops: [titleOp] })
    const received: unknown[] = []
    // The saved method is invoked with the exact kernel receiver inside the spy.
    // oxlint-disable-next-line typescript/unbound-method
    const apply = KernelProcess.prototype.applyChart
    vi.spyOn(KernelProcess.prototype, 'applyChart').mockImplementation(function (this: KernelProcess, request) {
      received.push(JSON.parse(readFileSync(request.requestPath, 'utf8')))
      return apply.call(this, request)
    })
    const result = await runtime.previewChartEdit({
      session, artifactId: parent.artifactId, version: 2, ops, signal: new AbortController().signal,
    })
    expect(received).toHaveLength(registration === 'warm' ? 1 : 2)
    for (const request of received) expect(request).toMatchObject({ ops: [titleOp, ...ops] })
    expect(result.failedOps).toEqual([{ index: 1, reason: 'element_not_found' }])
    expect(result.chart.ops).toEqual([titleOp, titleOp])
  })

  it('refuses to save when a committed operation cannot be reconstructed', async () => {
    const { ctx, runtime, session } = await harness('chart-edit-invalid-baseline', {
      chartApplyResult: { chart: editExtraction, failedOps: [{ index: 0, reason: 'element_not_found' }] },
    })
    const parent = chart(session)
    await appendHumanEdit(ctx, session, parent, { ops: [titleOp] })
    await expect(runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: 2, ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })
    expect(replayScience(session.events)?.artifacts).toHaveLength(2)
  })

  it('commits one warm human-edit version with cumulative successful operations', async () => {
    const { ctx, runtime, session } = await harness('chart-edit-warm')
    const parent = chart(session)
    const result = await runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: parent.version, ops, signal: new AbortController().signal,
    })
    expect(result.failedOps).toEqual([])
    expect(result.artifact).toMatchObject({ version: 2 })
    await expect(ctx.scienceArtifactStore.getVersion(result.artifact.projectId, result.artifact.versionId))
      .resolves.toMatchObject({ contentOrigin: 'human-edit', baseVersionId: parent.versionId, baseExplicit: true })
    const resultChart = await figureStateOf(ctx, result.artifact)
    expect(resultChart.ops).toEqual(ops)
    expect(session.events.filter(event => event.type === 'science/run-started')).toHaveLength(1)
  })

  it('omits environment provenance a chained edit target does not itself carry (e.g. a v1-migrated row)', async () => {
    const { ctx, runtime, session } = await harness('chart-edit-no-environment')
    const parent = chart(session)
    const store = ctx.scienceArtifactStore
    const parentChart = await figureStateOf(ctx, parent)
    // A version with no environment provenance of its own — the store never
    // requires one (it is `undefined`-tolerant on every `appendVersion`
    // call) — is edited here as the CURRENT head; the nearest run-origin
    // ancestor (`parent`, still the real captured run) remains resolvable
    // for the actual edit, but `commitStyleEdit` must copy THIS version's
    // (absent) environment fields onto the appended edit, not the source
    // run's.
    const noEnvEdit = await store.appendVersion(parent.projectId, parent.artifactId, {
      producerSessionId: session.id,
      data: new TextEncoder().encode('PNG no-environment edit'),
      mediaType: 'image/png',
      contentOrigin: 'human-edit',
      baseVersionId: parent.versionId,
      figureState: { figureKey: parentChart.figureKey, dpi: parentChart.png.dpi, stateJson: JSON.stringify(parentChart) },
    })
    await store.annotateVersion(parent.projectId, noEnvEdit.versionId, { actor: 'human', sessionId: session.id, title: parent.title })
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: parent.artifactId, logicalName: parent.logicalName, version: noEnvEdit.ordinal, title: parent.title,
        projectId: parent.projectId, versionId: noEnvEdit.versionId, sha256: noEnvEdit.sha256, seenAt: Date.now(),
      },
    })

    const result = await runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: noEnvEdit.ordinal, ops: [titleOp], signal: new AbortController().signal,
    })
    await expect(store.getVersion(result.artifact.projectId, result.artifact.versionId)).resolves.toMatchObject({
      environmentRevision: undefined, environmentFingerprint: undefined,
    })
  })

  it('replays an unregistered source without publishing a scientific run', async () => {
    const { ctx, runtime, session, root } = await harness('chart-edit-replay', { evictCharts: true })
    const parent = chart(session)
    const result = await runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: parent.version, ops: [titleOp], signal: new AbortController().signal,
    })
    expect(result.artifact).toMatchObject({ version: 2 })
    await expect(ctx.scienceArtifactStore.getVersion(result.artifact.projectId, result.artifact.versionId))
      .resolves.toMatchObject({ contentOrigin: 'human-edit' })
    expect(session.events.filter(event => event.type === 'science/run-started')).toHaveLength(1)
    const sessionScratch = await planSessionScratch(join(root, 'dsh-home'), session)
    expect(readdirSync(sessionScratch.runs).filter(name => name.startsWith('replay-'))).toEqual([])
  })

  for (const cause of ['cancel', 'timeout'] as const) {
    it.each([true, false])(`rejects ${cause} during cold replay (cooperative=%s) and releases the session for another run`, async (trapSigint) => {
      const { ctx, runtime, session, root } = await harness(`chart-replay-${cause}`,
        { evictCharts: true })
      const parent = chart(session)
      const producerRunId = await producerRunIdOf(ctx, parent)
      const scratch = planRunScratch(await planSessionScratch(join(root, 'dsh-home'), session), producerRunId, 'python')
      writeFileSync(scratch.source, kernelAction({ action: 'sleep', sleepMs: 60_000, trapSigint,
        chartApplyResult: { chart: editExtraction, failedOps: [] } }))
      const controller = new AbortController()
      // The saved method is invoked with the exact kernel receiver inside the spy.
      // oxlint-disable-next-line typescript/unbound-method
      const execute = KernelProcess.prototype.execute
      const spy = vi.spyOn(KernelProcess.prototype, 'execute').mockImplementation(function (this: KernelProcess, request) {
        const result = execute.call(this, request)
        if (cause === 'cancel' && request.sourcePath.includes('replay-')) setTimeout(() => { controller.abort() }, 50)
        return result
      })
      const events = session.events.length
      await expect(runtime.previewChartEdit({ session, artifactId: parent.artifactId, version: parent.version,
        ops: [titleOp], signal: controller.signal })).rejects.toMatchObject({
        code: cause === 'cancel' ? 'OPERATION_CANCELLED' : 'OPERATION_TIMED_OUT',
      })
      spy.mockRestore()
      expect(session.events).toHaveLength(events)
      expect(readdirSync((await planSessionScratch(join(root, 'dsh-home'), session)).runs).some(name => name.startsWith('replay-'))).toBe(false)
      const next = await runtime.startRun({ session, language: 'python', code: kernelAction({ stdout: 'available' }),
        ...authorizePythonRun(session, `after-${cause}`), signal: new AbortController().signal })
      expect((await next.done).stdout.text).toBe('available')
    })
  }

  it.each([false, true])('cancels chart rendering itself (cold=%s) before returning a preview', async (cold) => {
    const { runtime, session } = await harness(`chart-render-cancel-${cold}`,
      { evictCharts: cold, chartApplyStatus: 'hang' }, 10_000, { chartExtractTimeoutMs: 5_000 })
    const parent = chart(session)
    const controller = new AbortController()
    // The saved method is invoked with the exact kernel receiver inside the spy.
    // oxlint-disable-next-line typescript/unbound-method
    const apply = KernelProcess.prototype.applyChart
    vi.spyOn(KernelProcess.prototype, 'applyChart').mockImplementation(function (this: KernelProcess, request) {
      const result = apply.call(this, request)
      if (!cold || request.requestPath.includes('replay-')) setTimeout(() => { controller.abort() }, 50)
      return result
    })
    await expect(runtime.previewChartEdit({ session, artifactId: parent.artifactId, version: parent.version,
      ops: [titleOp], signal: controller.signal })).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(replayScience(session.events)?.artifacts).toHaveLength(1)
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
    const unresolvedPreview = await unresolved.runtime.previewChartEdit({
      session: unresolved.session, artifactId: unresolvedParent.artifactId, version: unresolvedParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })
    expect(unresolvedPreview.failedOps).toEqual([{ index: 0, reason: 'element_not_found' }])
    expect(unresolvedPreview.chart.ops).toEqual([])
    // Every failed op's own reason rides in the thrown message, not just the
    // generic error code: a caller (`edit-message.ts`'s
    // `translateChartRuntimeError`) forwards `message` unchanged, and the
    // panel renders it verbatim once localized.
    await expect(unresolved.runtime.applyChartEdit({
      session: unresolved.session, artifactId: unresolvedParent.artifactId, version: unresolvedParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_ELEMENT_NOT_FOUND', message: expect.stringContaining('op 1 set_title — element_not_found') as string })
  })

  it('lists every failed op\'s own index, name, and reason when a multi-op request resolves none of them', async () => {
    const axisLabelOp = { op: 'set_axis_label', axes: 0, axis: 'x', text: 'Edited' } as const satisfies ScienceChartOp
    const unresolved = await harness('chart-edit-unresolved-multi', {
      chartApplyResult: {
        chart: editExtraction,
        failedOps: [{ index: 0, reason: 'font_not_found' }, { index: 1, reason: 'axes_not_found' }],
      },
    })
    const unresolvedParent = chart(unresolved.session)
    const fontOp = { op: 'set_font', axes: null, family: 'sans-serif', size: 12 } as const satisfies ScienceChartOp
    await expect(unresolved.runtime.applyChartEdit({
      session: unresolved.session, artifactId: unresolvedParent.artifactId, version: unresolvedParent.version,
      ops: [fontOp, axisLabelOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'CHART_ELEMENT_NOT_FOUND',
      message: expect.stringContaining('op 1 set_font — font_not_found; op 2 set_axis_label — axes_not_found') as string,
    })
  })

  it('rejects cumulative overflow and mismatched source provenance', async () => {
    const overflow = await harness('chart-edit-overflow')
    const overflowParent = chart(overflow.session)
    await appendHumanEdit(overflow.ctx, overflow.session, overflowParent, { ops: [titleOp] })
    await expect(overflow.runtime.applyChartEdit({
      session: overflow.session, artifactId: overflowParent.artifactId, version: 2,
      ops: Array.from({ length: 100 }, () => titleOp), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_OP_INVALID' })

    const noSource = await harness('chart-edit-no-source')
    const noSourceParent = chart(noSource.session)
    await appendHumanEdit(noSource.ctx, noSource.session, noSourceParent, { figureKey: 'missing.png' })
    await expect(noSource.runtime.applyChartEdit({
      session: noSource.session, artifactId: noSourceParent.artifactId, version: 2,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })

    const mismatch = await harness('chart-edit-language-mismatch')
    const mismatchParent = chart(mismatch.session)
    await appendHumanEdit(mismatch.ctx, mismatch.session, mismatchParent, { runtime: 'ggplot2' })
    await expect(mismatch.runtime.applyChartEdit({
      session: mismatch.session, artifactId: mismatchParent.artifactId, version: 2,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })
  }, 90_000)

  it('rejects failed and still-unregistered source replay', async () => {
    const failedReplay = await harness('chart-edit-failed-replay', { evictCharts: true })
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
    const { ctx, runtime, session } = await harness('chart-edit-partial', {
      chartApplyResult: { chart: editExtraction, failedOps: [{ index: 1, reason: 'element_not_found' }] },
    })
    const parent = chart(session)
    const result = await runtime.applyChartEdit({
      session, artifactId: parent.artifactId, version: parent.version, ops, signal: new AbortController().signal,
    })
    expect(result.failedOps).toEqual([{ index: 1, reason: 'element_not_found' }])
    const resultChart = await figureStateOf(ctx, result.artifact)
    expect(resultChart.ops).toEqual([titleOp])
  })

  it('retires a timed-out kernel and rejects replay when source scratch is gone', async () => {
    const timed = await harness('chart-edit-timeout', { chartApplyStatus: 'hang' })
    const timedParent = chart(timed.session)
    await expect(timed.runtime.applyChartEdit({
      session: timed.session, artifactId: timedParent.artifactId, version: timedParent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
    expect(replayScience(timed.session.events)?.kernels.some(kernel => kernel.state === 'exited')).toBe(true)

    const missing = await harness('chart-edit-missing-source', { evictCharts: true })
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

describe('ScienceRuntime.previewChartEdit', () => {
  it('holds the lease through delayed replay quiescence and rejects cancellation during cleanup', async () => {
    const { runtime, session, root } = await harness('chart-preview-cleanup-cancel', { evictCharts: true })
    const parent = chart(session)
    const entered = Promise.withResolvers<undefined>()
    const quiescent = Promise.withResolvers<boolean>()
    // oxlint-disable-next-line typescript/unbound-method -- call() below supplies the intercepted kernel as this.
    const originalEnd = KernelProcess.prototype.end
    vi.spyOn(KernelProcess.prototype, 'end').mockImplementation(async function (this: KernelProcess, reason) {
      const result = await originalEnd.call(this, reason)
      if (reason !== 'chart-replay-finished') return result
      entered.resolve(undefined)
      return { quiescent: false, forced: true, eventualQuiescence: quiescent.promise }
    })
    const controller = new AbortController()
    const annotation = { session, logicalName: parent.logicalName, title: parent.title,
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal }
    const authorization = authorizePythonRun(session, 'after-preview-cleanup')
    const events = session.events.length
    const preview = runtime.previewChartEdit({ session, artifactId: parent.artifactId, version: parent.version,
      ops: [titleOp], signal: controller.signal })
    const rejection = expect(preview).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    await entered.promise
    const scratch = await planSessionScratch(join(root, 'dsh-home'), session)
    const nextRun = { session, language: 'python' as const, code: kernelAction({ status: 'ok' }),
      ...authorization, signal: new AbortController().signal }
    try {
      controller.abort()
      await expect(runtime.annotateArtifact(annotation)).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
      expect(readdirSync(scratch.runs).some(name => name.startsWith('replay-'))).toBe(true)
      expect(session.events).toHaveLength(events)
    } finally {
      quiescent.resolve(true)
      await rejection
    }
    expect(readdirSync(scratch.runs).some(name => name.startsWith('replay-'))).toBe(false)
    expect((await (await runtime.startRun(nextRun)).done).terminal.status).toBe('success')
  })

  it('renders through a warm kernel without publishing a version or artifact event', async () => {
    const { runtime, session } = await harness('chart-preview-warm')
    const parent = chart(session)
    const beforeEvents = session.events.length
    const result = await runtime.previewChartEdit({
      session, artifactId: parent.artifactId, version: parent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })
    expect([...result.png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(result.chart.ops).toEqual([titleOp])
    expect(session.events).toHaveLength(beforeEvents)
    expect(replayScience(session.events)?.artifacts).toHaveLength(1)
  })

  it('replays an unregistered source and removes its private scratch without publishing a run', async () => {
    const { runtime, session, root } = await harness('chart-preview-replay', { evictCharts: true })
    const parent = chart(session)
    const result = await runtime.previewChartEdit({
      session, artifactId: parent.artifactId, version: parent.version,
      ops: [titleOp], signal: new AbortController().signal,
    })
    expect(result.chart.elements).toEqual(editExtraction.elements)
    expect(session.events.filter(event => event.type === 'science/run-started')).toHaveLength(1)
    const sessionScratch = await planSessionScratch(join(root, 'dsh-home'), session)
    expect(readdirSync(sessionScratch.runs).filter(name => name.startsWith('replay-'))).toEqual([])
  })

  it('uses the apply validation errors for stale, invalid, and unaddressable requests', async () => {
    const warm = await harness('chart-preview-validation')
    const parent = chart(warm.session)
    await expect(warm.runtime.previewChartEdit({
      session: warm.session, artifactId: parent.artifactId, version: parent.version + 1,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_STALE_VERSION' })
    await expect(warm.runtime.previewChartEdit({
      session: warm.session, artifactId: parent.artifactId, version: parent.version,
      ops: [], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_OP_INVALID' })

    const missing = await harness('chart-preview-unaddressable', { chartResult: { charts: {}, errors: {} } })
    const png = chart(missing.session)
    await expect(missing.runtime.previewChartEdit({
      session: missing.session, artifactId: png.artifactId, version: png.version,
      ops: [titleOp], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CHART_NOT_ADDRESSABLE' })
  })
})
