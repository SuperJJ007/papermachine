#!/usr/bin/env node
/** Drive one Science-bound agent through the keyless snapshot composition. */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { CallId } from '@deepseek-ai/dsh-llm'
import {
  decodeScienceChartState, foldScience, ScienceEnvironmentProfileId,
  type ScienceProjectId, type ScienceVersionId,
} from '@deepseek-ai/dsh-science-session'
import type {} from '@deepseek-ai/dsh-tool-science'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'

const NAME = 'science-snapshot-driver'
const [configPath, ...taskParts] = process.argv.slice(2)
if (configPath === undefined || taskParts.length === 0 || taskParts.every(part => part.trim() === '')) {
  throw new Error(`${NAME}: expected <config-path> <task...>`)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  // Three idle kernels keep the main agent's first run at the default
  // filesystem thread-pool capacity throughout persistence and previews.
  const idleSessions = []
  for (let index = 0; index < 3; index += 1) {
    const session = ctx.sessions.create(SessionId(`science-idle-${index}`), {
      meta: { agentPreset: 'science', cwd: process.cwd() },
    })
    session.append('science/mode-bound', { version: 1,
      mode: { modeId: 'science', presetId: 'science', modeRevision: 'snapshot-r3' } })
    const signal = new AbortController().signal
    await ctx.scienceRuntime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('fake'), signal })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const header = session.append('request/header', { header: { config: { provider: 'science-snapshot', model: 'science-snapshot' } }, reason: 'initial' })
    const toolCallId = CallId(`idle-kernel-${index}`)
    session.append('tool/call', { turn: 1, step: 1, callId: toolCallId, name: 'run_python', arguments: '{}' })
    const run = await ctx.scienceRuntime.startRun({ session, language: 'python', code: 'value = 99',
      toolCallId, requestHeaderSeq: header.seq, signal })
    if ((await run.done).terminal.status !== 'success') throw new Error(`${NAME}: idle kernel did not start`)
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.sessions.flush(session)
    idleSessions.push(session)
  }
  const sessionId = SessionId('science-tools-snapshot')
  await ctx.agents.create({
    sessionId,
    // The Science project artifact store keys its store directory by this
    // workspace path (this driver's own process cwd, already scrubbed from
    // every snapshot assertion below), required since S2: `bindEnvironment`
    // and `startRun` both resolve the session's owning project from it.
    meta: { agentPreset: 'science', cwd: process.cwd() },
    agentOptions: { provider: 'science-snapshot', model: 'science-snapshot' },
  })
  const result = await runFixtureTurn(ctx, {
    task: taskParts.join(' '),
    onEvent: (sessionId: string, event: SessionEvent) => {
      process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    },
  })
  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error(`${NAME}: configured Science agent is not live`)
  const chart = foldScience(agent.session.events).artifacts.find(artifact => artifact.logicalName === 'plot.png')
  if (chart === undefined) throw new Error(`${NAME}: first turn produced no plot.png artifact`)
  const readChartState = async (
    projectId: ScienceProjectId, versionId: ScienceVersionId,
  ) => {
    const figureState = await ctx!.scienceArtifactStore.getFigureState(projectId, versionId)
    return figureState === undefined ? undefined : decodeScienceChartState(JSON.parse(figureState.stateJson))
  }
  const chartState = await readChartState(chart.projectId, chart.versionId)
  if (chartState === undefined || chartState.ops.length !== 0) {
    throw new Error(`${NAME}: first-turn plot.png did not preserve its initial chart state`)
  }
  const directReceipt = await ctx.scienceEdits.applyChartOps(agent, {
    artifactId: chart.artifactId,
    version: chart.version,
    ops: [
      { op: 'set_title', axes: null, text: 'Directly edited chart' },
      { op: 'set_subtitle', axes: 0, text: 'Directly edited subtitle' },
      { op: 'set_axis_label', axes: 0, axis: 'x', text: 'Edited input' },
      { op: 'set_font', axes: null, family: 'DejaVu Sans', size: 14 },
    ],
  }, new AbortController().signal)
  const directChart = foldScience(agent.session.events).artifacts.find(artifact =>
    artifact.artifactId === directReceipt.artifactId && artifact.version === directReceipt.version)
  if (directChart === undefined) throw new Error(`${NAME}: direct chart edit committed no artifact`)
  const directVersion = await ctx.scienceArtifactStore.getVersion(directChart.projectId, directChart.versionId)
  const directChartState = await readChartState(directChart.projectId, directChart.versionId)
  if (directVersion?.contentOrigin !== 'human-edit' || directChartState?.ops.length !== 4) {
    throw new Error(`${NAME}: direct chart edit did not preserve its four cumulative operations`)
  }
  const directEvent = agent.session.events.findLast(event => event.type === 'science/artifact-saved'
    && event.data.artifact.artifactId === directChart.artifactId
    && event.data.artifact.version === directChart.version)
  if (directEvent === undefined) throw new Error(`${NAME}: direct chart edit committed no artifact event`)
  process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event: directEvent })}\n`)
  const previewRequest = { session: agent.session, artifactId: directChart.artifactId, version: directChart.version,
    signal: new AbortController().signal }
  const beforePreview = agent.session.events.length
  await ctx.scienceRuntime.previewChartEdit({ ...previewRequest,
    ops: [{ op: 'set_axis_label', axes: 0, axis: 'x', text: 'Discarded draft' }] })
  const preview = await ctx.scienceRuntime.previewChartEdit({ ...previewRequest,
    ops: [{ op: 'set_title', axes: null, text: 'Preview title' }] })
  if (agent.session.events.length !== beforePreview
    || preview.chart.elements.find(element => element.kind === 'x_label')?.current !== 'Edited input'
    || preview.chart.elements.find(element => element.kind === 'subtitle')?.current !== 'Directly edited subtitle'
    || preview.chart.ops.length !== 5) {
    throw new Error(`${NAME}: preview did not retain the committed baseline independently of the discarded draft`)
  }
  await writeFile(join(process.cwd(), 'science-chart-preview.json'),
    JSON.stringify({ chart: preview.chart, failedOps: preview.failedOps,
      liveKernelCount: [...idleSessions, agent.session].flatMap(session => foldScience(session.events).kernels)
        .filter(kernel => kernel.state === 'started').length }))
  await runFixtureTurn(ctx, {
    task: 'Inspect the direct chart edit state.',
    onEvent: (sessionId: string, event: SessionEvent) => {
      process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    },
  })
  const revisionBefore = foldScience(agent.session.events).environments.at(-1)?.revision ?? 0
  await runFixtureTurn(ctx, {
    task: 'Install numpy into the bound Python environment.',
    onEvent: (sessionId: string, event: SessionEvent) => {
      process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    },
  })
  const revisionAfter = foldScience(agent.session.events).environments.at(-1)?.revision
  if (revisionAfter !== revisionBefore + 1) {
    throw new Error(`${NAME}: install_science_packages did not append a fresh environment revision`)
  }
  let editOutput = ''
  const disposeEditListener = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    if (event.type === 'assistant/message') {
      editOutput = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
    }
  })
  try {
    await ctx.scienceEdits.submit(agent, {
      targets: [{
        artifactId: directChart.artifactId,
        logicalName: directChart.logicalName,
        version: directChart.version,
        target: { kind: 'normalized-region', x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        comment: 'Keep the scale readable at small sizes.',
      }],
      instruction: 'Use a zero-based quantitative scale.',
    })
    await agent.whenIdle()
    const edited = foldScience(agent.session.events).artifacts.findLast(artifact => artifact.logicalName === 'region-edit.png')
    if (edited === undefined) throw new Error(`${NAME}: the edit produced no region-edit.png artifact`)
    await ctx.scienceEdits.submit(agent, {
      targets: [
        {
          artifactId: directChart.artifactId,
          logicalName: directChart.logicalName,
          version: directChart.version,
          target: { kind: 'normalized-region', x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        },
        {
          artifactId: edited.artifactId,
          logicalName: edited.logicalName,
          version: edited.version,
          target: { kind: 'normalized-region', x: 0, y: 0, width: 0.5, height: 0.5 },
        },
      ],
      instruction: 'Brighten both selected regions and align their styling.',
    })
    await agent.whenIdle()
  } finally {
    disposeEditListener()
  }

  // T5 six-path acceptance, path 3 ("continue"): a plain second run
  // overwriting `plot.png` — no `edit_of`, so the store's chain-continuation
  // default applies (`baseVersionId` stays undefined) rather than the
  // explicit baseline `edit_of`/`saveArtifactAs` below use. Placed after the
  // region edits above: `scienceEdits.submit`'s targets must cite the
  // artifact's currently committed version, so a plain continuation run
  // earlier would have made those targets' hardcoded `directChart.version`
  // stale before they ever ran.
  await runFixtureTurn(ctx, {
    task: 'Continue the plotted analysis with a fresh run.',
    onEvent: (sessionId: string, event: SessionEvent) => {
      process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    },
  })
  const continued = foldScience(agent.session.events).artifacts
    .findLast(artifact => artifact.artifactId === chart.artifactId)
  if (continued === undefined || continued.version <= chart.version) {
    throw new Error(`${NAME}: the continuation run did not commit a fresh plot.png version`)
  }

  // T5 six-path acceptance, path 5 ("save as"): duplicate the direct-edited
  // version into a brand-new logical artifact. A viewer operation — no
  // authorizing tool call — so this reads `agent.session.events` for the
  // `science/artifact-saved` `saveArtifactAs` itself appended.
  const savedAs = await ctx.scienceRuntime.saveArtifactAs({
    session: agent.session,
    sourceVersionId: directChart.versionId,
    newLogicalName: 'plot-review-copy.png',
    signal: new AbortController().signal,
  })
  const saveAsEvent = agent.session.events.findLast(event => event.type === 'science/artifact-saved'
    && event.data.artifact.artifactId === savedAs.artifactId)
  if (saveAsEvent === undefined) throw new Error(`${NAME}: save-as committed no artifact event`)
  process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event: saveAsEvent })}\n`)

  await ctx.sessions.flush(agent.session)

  // T5 six-path acceptance, path 6 ("restart, replay"): dispose the whole
  // Context and boot a fresh one against the same `DSH_SCIENCE_SNAPSHOT_ROOT`
  // (so the same on-disk `dshHome`/store), then resume the persisted session
  // from durable storage. Everything from here on is read-only replay —
  // proving the Session log and the project artifact store still agree on
  // every version's provenance after a cold restart, not merely within one
  // live process.
  await ctx.fiber.dispose()
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const resumed = await ctx.agents.resume({
    resumeSessionId: sessionId,
    agentOptions: { provider: 'science-snapshot', model: 'science-snapshot' },
  })
  const resumedProjection = foldScience(resumed.agent.session.events)
  for (const [label, before] of [
    ['plot.png v1', chart], ['plot.png (continued)', continued],
    ['directly edited chart', directChart], ['saved-as copy', savedAs],
  ] as const) {
    const after = resumedProjection.artifacts.find(artifact => artifact.versionId === before.versionId)
    if (after === undefined || after.sha256 !== before.sha256) {
      throw new Error(`${NAME}: replayed session lost or diverged on ${label} after restart`)
    }
  }

  // Fourth expected file: the project artifact store's own version records
  // (the sole authority for provenance — see `science-session`'s module
  // doc), sorted by `(logicalName, ordinal)`, dumped after the restart so
  // this proves agreement survives a cold reload, not just the live run.
  const projectId = chart.projectId
  const storeArtifacts = await ctx.scienceArtifactStore.listArtifacts(projectId)
  const sourceAgreement = (await Promise.all(storeArtifacts.map(async (artifact) => {
    const versions = await ctx!.scienceArtifactStore.listVersions(projectId, artifact.artifactId)
    return versions.map(version => ({
      logicalName: artifact.logicalName,
      versionId: version.versionId,
      artifactId: version.artifactId,
      ordinal: version.ordinal,
      contentOrigin: version.contentOrigin,
      producer: {
        sessionId: version.producerSessionId,
        runId: version.producerRunId,
        toolCallId: version.producerToolCallId,
        requestHeaderSeq: version.producerRequestHeaderSeq,
        turn: version.producerTurn,
      },
      baseVersionId: version.baseVersionId,
      baseExplicit: version.baseExplicit,
      createdAt: version.createdAt,
      sha256: version.sha256,
      mediaType: version.mediaType,
      byteCount: version.byteCount,
    }))
  }))).flat().sort((a, b) => a.logicalName === b.logicalName ? a.ordinal - b.ordinal : a.logicalName.localeCompare(b.logicalName))

  // The event side of the agreement: every `science/artifact-saved` this
  // resumed replay still carries names a `versionId` the store dump above
  // also names, with a matching `sha256` — proving the session's own
  // content-identity fact was never a second copy that could drift.
  const sessionSha256ByVersionId = new Map(resumed.agent.session.events
    .filter(event => event.type === 'science/artifact-saved')
    .map(event => [event.data.artifact.versionId, event.data.artifact.sha256] as const))
  for (const record of sourceAgreement) {
    const sessionSha256 = sessionSha256ByVersionId.get(record.versionId)
    if (sessionSha256 !== undefined && sessionSha256 !== record.sha256) {
      throw new Error(`${NAME}: session and store disagree on sha256 for version ${record.versionId}`)
    }
  }
  await writeFile(join(process.cwd(), 'science-source-agreement.json'), JSON.stringify(sourceAgreement, undefined, 2))

  process.stdout.write(`${JSON.stringify({ ...result, output: editOutput })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
