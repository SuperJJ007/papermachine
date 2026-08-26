// Web e2e scenario: cold replay of one `run_r` call whose auto-capture
// produced one file per accepted text media type plus a PNG, so real
// Chromium exercises the artifact viewer's full per-media-type content
// dispatch — a sortable CSV table, a JSON tree, rendered Markdown, and the
// existing image path — reached through the same tab strip/toolbar every
// media type shares.
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ArtifactRecord, ProjectId, VersionRecord } from '@deepseek-ai/dsh-science-artifact-store'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  ScienceArtifactId, ScienceEnvironmentProfileId, ScienceRunId, ScienceScratchKey,
} from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactMediaType } from '@deepseek-ai/dsh-science-session'
import {
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const PANEL_EXPECTED = fileURLToPath(new URL('./snapshots/science-artifact-types/panel.expected.md', import.meta.url))
const TRANSCRIPT_EXPECTED = fileURLToPath(new URL('./snapshots/science-artifact-types/transcript.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'science-artifact-types-web-e2e'
const SEED_TITLE = 'Science artifact types'
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))
const CSV_TEXT = 'name,score\nada,10\nbob,2\ncleo,33\n'
const JSON_TEXT = '{"accuracy":0.97,"epochs":12}'
const MARKDOWN_TEXT = '# Result\n\nThe model **converged**.\n'
/** Generate a large inline-data fixture without committing hundreds of kilobytes of static JSON. */
function makeVegaLiteText(rowCount: number): string {
  return JSON.stringify({
    title: 'Scores',
    mark: 'point',
    data: { values: Array.from({ length: rowCount }, (_, index) => ({
      name: `participant-${String(index)}`, score: index % 101, exposure: index,
    })) },
    encoding: {
      x: { field: 'exposure', type: 'quantitative' },
      y: { field: 'score', type: 'quantitative' },
    },
  })
}
const VEGA_LITE_TEXT = makeVegaLiteText(3_000)
const FINGERPRINT = 'e'.repeat(64)
const RUN_ID = ScienceRunId('run-types-1')
const RUN_CALL_ID = CallId('call-run-types')
type StoredArtifact = { readonly artifact: ArtifactRecord; readonly version: VersionRecord }

/** Build one closed Science session: a single `run_r` call whose auto-capture produced csv/json/md/png/Vega-Lite artifacts. */
function scienceFixture(projectId: ProjectId, stored: readonly StoredArtifact[]): string {
  const session = Session.create(SessionId('science-browser-types-source'))
  // `seedSession` materializes each event's envelope time as this fixture's
  // own creation-time anchor plus that event's delta from the fixture's
  // first event (see scaffold.ts) — a wall-clock noon origin lands after
  // that anchor whenever the suite runs before local noon, failing
  // Science's payload-precedes-event.time invariants (validatedAt,
  // startedAt, createdAt). Anchoring to `Date.now()` half a second before
  // `seedSession`'s own anchor keeps every payload timestamp ordered
  // correctly against both the event it belongs to and the prior fact it
  // depends on, regardless of time of day.
  const origin = Date.now() - 60_000 - 500
  const eventTime = (seq: number): number => origin + seq * 1_000

  session.append('turn/start', { turn: 1 })
  session.append('science/mode-bound', {
    version: 1,
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'science-r5-types-browser' },
  })
  session.append('science/environment-bound', {
    version: 1,
    environment: {
      revision: 1,
      profileId: ScienceEnvironmentProfileId('browser-profile'),
      configuredAt: eventTime(1),
      validatedAt: eventTime(2),
      status: 'applied',
      r: {
        language: 'r',
        configuredPrefix: '/private/host/science',
        canonicalPrefix: '/private/host/science',
        executable: '/private/host/science/bin/Rscript',
        executableIdentity: 'dev:1-ino:2',
        languageVersion: '4.5.0',
        condaHistorySha256: 'a'.repeat(64),
        bindingFingerprint: FINGERPRINT,
        packages: [{ name: 'pip', version: '24.0' }],
        packagesSha256: 'f'.repeat(64),
        packagesTruncated: false,
        capability: 'available',
      },
    },
  })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Summarize the experiment as csv, json, markdown, and a chart.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: SEED_TITLE,
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const request = session.append('request/header', {
    header: { config: { provider: 'fixture', model: 'fixture' } },
    reason: 'initial',
  })

  session.append('science/kernel-state', {
    version: 1,
    kernel: {
      kernelEpoch: 1,
      language: 'r',
      state: 'started',
      environmentRevision: 1,
      environmentFingerprint: FINGERPRINT,
      at: eventTime(request.seq + 1),
    },
  })
  const runCall = session.append('tool/call', {
    turn: 1, step: 1, callId: RUN_CALL_ID, name: 'run_r', arguments: '{}',
  })
  const run = {
    runId: RUN_ID,
    language: 'r' as const,
    toolCallId: RUN_CALL_ID,
    requestHeaderSeq: request.seq,
    environmentRevision: 1,
    environmentFingerprint: FINGERPRINT,
    startedAt: eventTime(runCall.seq + 1),
    codeSha256: 'c'.repeat(64),
    scratchKey: ScienceScratchKey('d'.repeat(64)),
    runDirectoryRef: 'runs/run-types-1/',
    kernelEpoch: 1,
  }
  session.append('science/run-started', { version: 1, run: { ...run, status: 'running' } })
  session.append('science/run-finished', {
    version: 1,
    run: {
      ...run, status: 'success', finishedAt: eventTime(runCall.seq + 2),
      stdoutBytes: 2, stderrBytes: 0, stdoutTruncated: false, stderrTruncated: false,
    },
  })

  const artifact = (
    artifactId: ReturnType<typeof ScienceArtifactId>, logicalName: string,
    mediaType: ScienceArtifactMediaType, storedArtifact: StoredArtifact,
  ) => {
    const createdAt = eventTime(runCall.seq + 3)
    const { version } = storedArtifact
    const { versionId, sha256, byteCount } = version
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId, logicalName, version: 1, title: logicalName, origin: 'auto',
        producerSessionId: session.id,
        projectId, versionId, sha256, mediaType, byteCount,
        runId: RUN_ID, toolCallId: RUN_CALL_ID, requestHeaderSeq: request.seq,
        environmentRevision: 1, environmentFingerprint: FINGERPRINT, createdAt,
      },
    })
    return { artifactId, logicalName, version: 1, title: logicalName, versionId, mediaType, byteCount }
  }

  const items = [
    artifact(stored[0]!.artifact.artifactId, 'summary.csv', 'text/csv', stored[0]!),
    artifact(stored[1]!.artifact.artifactId, 'metrics.json', 'application/json', stored[1]!),
    artifact(stored[2]!.artifact.artifactId, 'report.md', 'text/markdown', stored[2]!),
    artifact(stored[3]!.artifact.artifactId, 'plot.png', 'image/png', stored[3]!),
    artifact(stored[4]!.artifact.artifactId, 'scores.vl.json', 'application/vnd.vega-lite+json', stored[4]!),
  ]

  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: RUN_CALL_ID,
      content: [{ type: 'text', text: 'status: success\nCaptured 5 artifacts.' }],
      isError: false,
    }),
    meta: {
      kind: 'science/artifact',
      version: 2,
      artifacts: items.map(item => ({
        artifactId: item.artifactId, logicalName: item.logicalName, version: item.version, title: item.title,
        content: { versionId: item.versionId, mediaType: item.mediaType, byteCount: item.byteCount },
      })),
    },
  }, { surfaceOp: 'append', sourceEventSeqs: [runCall.seq] })

  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const header = {
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    id: '{{sessionId}}',
    createdAt: 0,
    cwd: '{{cwd}}',
    agentPreset: 'science',
  }
  return [
    JSON.stringify(header),
    ...session.events.map(event => JSON.stringify({ ...event, time: eventTime(event.seq) })),
    '',
  ].join('\n')
}

describe('web e2e: Science artifact per-media-type rendering', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const opened = await scaffold.ctx.scienceArtifactStore.openProject(scaffold.workspaceCwd)
    const definitions = [
      { logicalName: 'summary.csv', data: Buffer.from(CSV_TEXT, 'utf8'), mediaType: 'text/csv' },
      { logicalName: 'metrics.json', data: Buffer.from(JSON_TEXT, 'utf8'), mediaType: 'application/json' },
      { logicalName: 'report.md', data: Buffer.from(MARKDOWN_TEXT, 'utf8'), mediaType: 'text/markdown' },
      { logicalName: 'plot.png', data: PNG, mediaType: 'image/png' },
      { logicalName: 'scores.vl.json', data: Buffer.from(VEGA_LITE_TEXT, 'utf8'), mediaType: 'application/vnd.vega-lite+json' },
    ] as const
    const stored: StoredArtifact[] = []
    for (const definition of definitions) {
      stored.push(await scaffold.ctx.scienceArtifactStore.createArtifact(opened.projectId, {
        ...definition,
        originSessionId: SessionId(SEED_ID),
        origin: 'auto',
        title: definition.logicalName,
      }))
    }
    await seedSession(scaffold, scienceFixture(opened.projectId, stored), SEED_ID, 'science')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders each media type from the Turn-end artifact group', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-artifact-types'))
    const centerCol = page.locator('[class*="centerCol"]')
    const detailsPanel = page.locator('[class*="detailsCol"]')
    expect(VEGA_LITE_TEXT.length).toBeGreaterThan(100_000)
    expect(VEGA_LITE_TEXT.length).toBeLessThan(8_000_000)

    await centerCol.getByText('Files produced this turn: 5', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await centerCol.getByText('Captured 5 artifacts', { exact: false }).count()).toBe(0)
    await compareOrRefreshGolden(
      TRANSCRIPT_EXPECTED,
      [
        '## Center column — collapsed Science transcript cells and Turn-end artifacts',
        await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd),
      ].join('\n'),
      MODE,
    )

    // Each Turn-end card opens its artifact's tab directly in the content view.
    await centerCol.getByRole('listitem', { name: /summary\.csv/ }).click()
    const table = detailsPanel.getByRole('table', { name: 'summary.csv' })
    await table.waitFor({ timeout: 10_000 })
    expect(await detailsPanel.getByRole('columnheader', { name: /name/i }).count()).toBe(1)
    expect(await detailsPanel.getByRole('columnheader', { name: /score/i }).count()).toBe(1)
    expect((await table.innerText()).split('\n').map(line => line.trim())).toEqual(
      expect.arrayContaining(['ada\t10', 'bob\t2', 'cleo\t33']),
    )
    // Sort by score ascending: bob (2) sorts before ada (10) and cleo (33).
    await detailsPanel.getByRole('button', { name: /Sort by score/ }).click()
    const rowsAscending = await table.locator('tbody tr').allInnerTexts()
    expect(rowsAscending[0]).toContain('bob')

    await centerCol.getByRole('listitem', { name: /metrics\.json/ }).click()
    await detailsPanel.getByRole('tree').waitFor({ timeout: 10_000 })
    expect(await detailsPanel.innerText()).toContain('accuracy')

    await centerCol.getByRole('listitem', { name: /report\.md/ }).click()
    await detailsPanel.getByRole('heading', { name: 'Result' }).waitFor({ timeout: 10_000 })
    expect(await detailsPanel.getByText('converged', { exact: false }).count()).toBeGreaterThan(0)

    await centerCol.getByRole('listitem', { name: /plot\.png/ }).click()
    await expect.poll(() => detailsPanel.getByRole('img', { name: 'plot.png' }).count(), { timeout: 15_000 }).toBe(1)

    await centerCol.getByRole('listitem', { name: /scores\.vl\.json/ }).click()
    await detailsPanel.locator('[data-testid="vega-lite-view"] svg').waitFor({ timeout: 15_000 })
    await detailsPanel.getByRole('button', { name: 'X axis', exact: true }).click()
    const exactOutline = detailsPanel.locator('[data-vega-selection-outline="exact"]')
    await exactOutline.waitFor({ timeout: 10_000 })
    expect((await exactOutline.boundingBox())?.width).toBeGreaterThan(0)

    // The R-produced spec uses the same direct style-edit Remote as a
    // Python-produced spec; origin language never enters viewer admission.
    await detailsPanel.getByRole('button', { name: 'Mark style', exact: true }).click()
    await detailsPanel.getByLabel('Color').fill('#ff0000')
    await detailsPanel.getByRole('button', { name: 'Commit as new version' }).click()
    await detailsPanel.getByText('Human-edited version committed.', { exact: true }).waitFor({ timeout: 15_000 })

    // All five document tabs stay open while the active chart advances to
    // the directly edited version.
    expect(await detailsPanel.getByRole('tab').count()).toBe(5)

    const aria = await captureStableAria(page, '[class*="detailsCol"]', scaffold.workspaceCwd)
    expect(aria).not.toContain('/private/host/science')
    expect(aria).not.toContain(FINGERPRINT)
    // Same non-leak as science-chart-outcome.e2e.ts: the full 64-character
    // condaHistorySha256 never reaches the rendered panel.
    expect(aria).not.toContain('a'.repeat(64))
    await compareOrRefreshGolden(
      PANEL_EXPECTED,
      ['## Details column — artifact viewer (csv/json/md/png/Vega-Lite)', aria].join('\n'),
      MODE,
    )

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)
})
