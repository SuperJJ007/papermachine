// Web e2e scenario: cold Science chart and Outcome replay, plus the Science
// session-header action and read-only Details entry it opens. A stored
// Session fixture citing one project-store-backed chart version and one
// deliberately unresolvable one enters through the shipped Web composition
// so real Chromium exercises projection replay, dedicated tool rows, reload,
// lightbox keyboard behavior, and the routed Details column's client-safe
// environment/run/chart/Outcome rendering. Artifact-content reads through
// the project store are wired in a later slice (S4); until then the
// artifact viewer's per-version content pane stays unverified here.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type JsonValue,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  ScienceArtifactId,
  ScienceEnvironmentProfileId,
  ScienceProjectId,
  replayScience,
  ScienceRunId,
  ScienceScratchKey,
  ScienceVersionId,
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

const ARTIFACTS_EXPECTED = fileURLToPath(
  new URL('./snapshots/science-artifacts/panel-and-provenance.expected.md', import.meta.url),
)
const MODE = webSnapshotMode()
const SEED_ID = 'science-chart-outcome-web-e2e'
const SEED_TITLE = 'Science chart replay'
// A shared, already-committed non-Science fixture (also seeded by
// details-session-lifecycle.e2e.ts and others): a closed session with no
// agentPreset, giving the header-action test a real non-Science Session
// without inventing a second recording.
const STANDARD_FIXTURE = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const STANDARD_SEED_ID = 'science-chart-outcome-standard-web-e2e'
const STANDARD_SEED_TITLE = 'Use the read tool twice'
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))
const FINGERPRINT = 'b'.repeat(64)
const PROJECT_ID = ScienceProjectId('project-browser-1')
const RUN_ID = ScienceRunId('run-browser-1')
const SECOND_RUN_ID = ScienceRunId('run-browser-2')
const CANCELLED_RUN_ID = ScienceRunId('run-browser-cancelled')
const CHART_ID = ScienceArtifactId('chart-browser-1')
const RUN_CALL_ID = CallId('call-run-browser')
const SECOND_RUN_CALL_ID = CallId('call-run-browser-2')
const CANCELLED_RUN_CALL_ID = CallId('call-run-browser-cancelled')
const FIRST_CHART_CALL_ID = CallId('call-chart-browser-1')
const SECOND_CHART_CALL_ID = CallId('call-chart-browser-2')
const FIRST_OUTCOME_CALL_ID = CallId('call-outcome-browser-1')
const SECOND_OUTCOME_CALL_ID = CallId('call-outcome-browser-2')

/** Append one settled tool result with the exact durable presentation value. */
function appendToolResult(
  session: Session,
  callId: ReturnType<typeof CallId>,
  callSeq: number,
  text: string,
  meta?: JsonValue,
  turn = 1,
  error?: { readonly name: string; readonly code: string },
): void {
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text }],
      isError: error !== undefined,
    }),
    ...meta === undefined ? {} : { meta },
    ...error === undefined ? {} : { error },
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
}

/** Store coordinates and content facts one committed Science chart version carries. */
interface ChartContent {
  readonly versionId: ReturnType<typeof ScienceVersionId>
  readonly sha256: string
  readonly mediaType: ScienceArtifactMediaType
  readonly byteCount: number
}

/** Deterministic fixture digest: a real sha256 over a fixed label, not a store-verified content hash. */
function fixtureDigest(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}

/** Build one valid closed Science session around stored and missing chart object versions. */
function scienceFixture(png: Uint8Array): string {
  const session = Session.create(SessionId('science-browser-source'))
  // `seedSession` materializes each event's envelope time as this fixture's
  // own creation-time anchor plus that event's delta from the fixture's
  // first event (see scaffold.ts) — a wall-clock noon origin lands after
  // that anchor whenever the suite runs before local noon, failing
  // Science's payload-precedes-event.time invariants (validatedAt,
  // startedAt, createdAt, publishedAt). Anchoring to `Date.now()` half a
  // second before `seedSession`'s own anchor keeps every payload timestamp
  // ordered correctly against both the event it belongs to and the prior
  // fact it depends on, regardless of time of day.
  const origin = Date.now() - 60_000 - 500
  const eventTime = (seq: number): number => origin + seq * 1_000
  const stored: ChartContent = {
    versionId: ScienceVersionId(fixtureDigest('observed-series:v1')),
    sha256: createHash('sha256').update(png).digest('hex'),
    mediaType: 'image/png',
    byteCount: png.byteLength,
  }
  // A distinct committed version whose bytes the project artifact store
  // never actually holds, exercising the artifact viewer's load-failure path.
  const missing: ChartContent = {
    versionId: ScienceVersionId(fixtureDigest('observed-series:v2-missing')),
    sha256: fixtureDigest('observed-series:v2-missing-object'),
    mediaType: 'image/png',
    byteCount: png.byteLength,
  }

  session.append('turn/start', { turn: 1 })
  session.append('science/mode-bound', {
    version: 1,
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'science-r5-browser' },
  })
  session.append('science/environment-bound', {
    version: 1,
    environment: {
      revision: 1,
      profileId: ScienceEnvironmentProfileId('browser-profile'),
      configuredAt: eventTime(1),
      validatedAt: eventTime(2),
      status: 'applied',
      python: {
        language: 'python',
        configuredPrefix: '/private/host/science',
        canonicalPrefix: '/private/host/science',
        executable: '/private/host/science/bin/python',
        executableIdentity: 'dev:1-ino:2',
        languageVersion: '3.13.5',
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
    content: [{ type: 'text', text: 'Replay the accepted Science result.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Science chart replay',
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
      language: 'python',
      state: 'started',
      environmentRevision: 1,
      environmentFingerprint: FINGERPRINT,
      at: eventTime(request.seq + 1),
    },
  })
  const runCall = session.append('tool/call', {
    turn: 1, step: 1, callId: RUN_CALL_ID, name: 'run_python', arguments: '{}',
  })
  const run = {
    runId: RUN_ID,
    language: 'python' as const,
    toolCallId: RUN_CALL_ID,
    requestHeaderSeq: request.seq,
    environmentRevision: 1,
    environmentFingerprint: FINGERPRINT,
    startedAt: eventTime(runCall.seq + 1),
    codeSha256: 'c'.repeat(64),
    scratchKey: ScienceScratchKey('d'.repeat(64)),
    runDirectoryRef: 'runs/run-browser-1/',
    kernelEpoch: 1,
  }
  session.append('science/run-started', { version: 1, run: { ...run, status: 'running' } })
  session.append('science/run-finished', {
    version: 1,
    run: {
      ...run,
      status: 'success',
      finishedAt: eventTime(runCall.seq + 2),
      stdoutBytes: 2,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  })
  const artifactPresentation = (
    version: number,
    content: ChartContent,
    title: string,
  ): JsonValue => ({
    kind: 'science/artifact',
    version: 2,
    artifacts: [{
      artifactId: CHART_ID,
      logicalName: 'observed-series',
      version,
      title,
      content: { versionId: content.versionId, mediaType: content.mediaType, byteCount: content.byteCount },
    }],
  })

  const appendCapturedChart = (
    version: number,
    content: ChartContent,
    sourceRunId: ReturnType<typeof ScienceRunId>,
    sourceCallId: ReturnType<typeof CallId>,
    sourceCallSeq: number,
    resultText: string,
    turn: number,
  ): void => {
    const title = 'observed-series'
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: CHART_ID,
        logicalName: 'observed-series',
        version,
        title,
        origin: 'auto',
        projectId: PROJECT_ID,
        versionId: content.versionId,
        sha256: content.sha256,
        mediaType: content.mediaType,
        byteCount: content.byteCount,
        runId: sourceRunId,
        toolCallId: sourceCallId,
        requestHeaderSeq: request.seq,
        environmentRevision: 1,
        environmentFingerprint: FINGERPRINT,
        createdAt: eventTime(sourceCallSeq + 3),
      },
    })
    appendToolResult(session, sourceCallId, sourceCallSeq, resultText, artifactPresentation(version, content, title), turn)
  }

  const appendChart = (
    version: number,
    callId: ReturnType<typeof CallId>,
    content: ChartContent,
    sourceRunId: ReturnType<typeof ScienceRunId>,
    turn: number,
  ): void => {
    const call = session.append('tool/call', {
      turn, step: 1, callId, name: 'annotate_artifact', arguments: '{}',
    })
    const createdAt = eventTime(call.seq + 1)
    const title = version === 1 ? 'Observed series' : 'Missing revision'
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: CHART_ID,
        logicalName: 'observed-series',
        version,
        title,
        caption: version === 1 ? 'Durable browser fixture' : 'Missing object fixture',
        origin: 'model',
        projectId: PROJECT_ID,
        versionId: content.versionId,
        sha256: content.sha256,
        mediaType: content.mediaType,
        byteCount: content.byteCount,
        runId: sourceRunId,
        toolCallId: callId,
        requestHeaderSeq: request.seq,
        environmentRevision: 1,
        environmentFingerprint: FINGERPRINT,
        createdAt,
      },
    })
    appendToolResult(session, callId, call.seq, `artifact "observed-series" v${String(version)} curated`, artifactPresentation(version, content, title), turn)
  }

  const appendOutcome = (
    revision: number,
    callId: ReturnType<typeof CallId>,
    chartVersion: number,
    turn: number,
  ): void => {
    const call = session.append('tool/call', {
      turn, step: 1, callId, name: 'publish_outcome', arguments: '{}',
    })
    const publishedAt = eventTime(call.seq + 1)
    const publication = {
      revision,
      title: revision === 1 ? 'Initial finding' : 'Updated finding',
      summaryMarkdown: revision === 1
        ? 'The **stored chart** remains replayable.'
        : 'The missing object is reported without hiding the publication.',
      evidence: [{ kind: 'chart' as const, chartId: CHART_ID, version: chartVersion }],
      publishedAt,
      toolCallId: callId,
      requestHeaderSeq: request.seq,
      environmentRevisions: [1],
    }
    session.append('science/outcome-published', { version: 1, outcome: publication })
    appendToolResult(session, callId, call.seq, `Outcome revision ${String(revision)}`, {
      kind: 'science/outcome',
      version: 1,
      revision,
      title: publication.title,
      summaryMarkdown: publication.summaryMarkdown,
      evidence: [{ kind: 'chart', chart_id: CHART_ID, version: chartVersion }],
      publishedAt,
    }, turn)
  }

  appendCapturedChart(1, stored, RUN_ID, RUN_CALL_ID, runCall.seq, 'run complete', 1)
  appendChart(1, FIRST_CHART_CALL_ID, stored, RUN_ID, 1)
  appendOutcome(1, FIRST_OUTCOME_CALL_ID, 1, 1)
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Revise the accepted Science result.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 2, step: 1 })
  const secondRunCall = session.append('tool/call', {
    turn: 2, step: 1, callId: SECOND_RUN_CALL_ID, name: 'run_python', arguments: '{}',
  })
  const secondRun = {
    ...run,
    runId: SECOND_RUN_ID,
    toolCallId: SECOND_RUN_CALL_ID,
    startedAt: eventTime(secondRunCall.seq + 1),
    runDirectoryRef: 'runs/run-browser-2/',
  }
  session.append('science/run-started', { version: 1, run: { ...secondRun, status: 'running' } })
  session.append('science/run-finished', {
    version: 1,
    run: {
      ...secondRun,
      status: 'success',
      finishedAt: eventTime(secondRunCall.seq + 2),
      stdoutBytes: 2,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  })
  appendCapturedChart(2, missing, SECOND_RUN_ID, SECOND_RUN_CALL_ID, secondRunCall.seq, 'revised run complete', 2)
  appendChart(2, SECOND_CHART_CALL_ID, missing, SECOND_RUN_ID, 2)
  appendOutcome(2, SECOND_OUTCOME_CALL_ID, 2, 2)
  const cancelledRunCall = session.append('tool/call', {
    turn: 2, step: 1, callId: CANCELLED_RUN_CALL_ID, name: 'run_python', arguments: '{}',
  })
  const cancelledRun = {
    ...run,
    runId: CANCELLED_RUN_ID,
    toolCallId: CANCELLED_RUN_CALL_ID,
    startedAt: eventTime(cancelledRunCall.seq + 1),
    runDirectoryRef: 'runs/run-browser-cancelled/',
  }
  session.append('science/run-started', { version: 1, run: { ...cancelledRun, status: 'running' } })
  session.append('science/run-finished', {
    version: 1,
    run: {
      ...cancelledRun,
      status: 'cancelled',
      finishedAt: eventTime(cancelledRunCall.seq + 2),
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      failureCode: 'CANCELLED',
      failureMessage: 'tool call aborted',
    },
  })
  appendToolResult(
    session,
    CANCELLED_RUN_CALL_ID,
    cancelledRunCall.seq,
    'Error: tool call aborted',
    undefined,
    2,
    { name: 'AbortError', code: 'ABORTED' },
  )
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })

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

describe('web e2e: Science chart and Outcome replay', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, scienceFixture(PNG), SEED_ID, 'science')
    // A non-Science Session (no agentPreset), seeded alongside the Science
    // one so the header-action test can assert real absence rather than an
    // absence that only holds because no other Session exists yet.
    await seedSession(scaffold, await readFile(STANDARD_FIXTURE, 'utf8'), STANDARD_SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Center-column content uniquely identifies which of the two seeded
   * Sessions is current (a freshly seeded row's sidebar label falls back to
   * the shared workspace basename until opened once, and selecting a row
   * also promotes it to most-recently-used — reordering the list — so
   * neither the label nor the row's position is a stable selector).
   */
  async function currentSeedIdentity(): Promise<'science' | 'standard' | 'unknown'> {
    if (await page.getByText('Outcome published · revision 2', { exact: true }).count() > 0) return 'science'
    if (await page.getByText('DONE', { exact: true }).count() > 0) return 'standard'
    return 'unknown'
  }

  /**
   * Select the Session named `title` (one of {@link SEED_TITLE},
   * {@link STANDARD_SEED_TITLE}) — the only two rows this scaffold ever
   * seeds — by content rather than position: while the wrong one is current,
   * click whichever sibling row is not `aria-selected` to reach the other.
   */
  async function openSessionByTitle(title: string): Promise<void> {
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const want = title === SEED_TITLE ? 'science' : 'standard'
    await expect.poll(async () => {
      if (await currentSeedIdentity() === want) return true
      const rows = page.locator('[role="treeitem"]')
      const rowCount = await rows.count()
      for (let index = 1; index < rowCount; index += 1) {
        const row = rows.nth(index)
        if (await row.getAttribute('aria-selected') !== 'true') {
          await row.click()
          break
        }
      }
      return false
    }, { timeout: 20_000, interval: 500 }).toBe(true)
  }

  it('replays stored and missing chart objects with both Outcome occurrences before and after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-chart-outcome'))
    const openSeed = async (): Promise<void> => {
      await openSessionByTitle(SEED_TITLE)
      await page.getByText('Outcome published · revision 2', { exact: true }).waitFor({ timeout: 15_000 })
    }

    await openSeed()
    expect(await page.getByText('Outcome published · revision 1', { exact: true }).count()).toBe(1)
    expect(await page.getByText('Outcome published · revision 2', { exact: true }).count()).toBe(1)
    expect(await page.getByText('Initial finding', { exact: true }).count()).toBe(0)
    expect(await page.getByText('Updated finding', { exact: true }).count()).toBe(0)
    expect(await page.getByRole('listitem', { name: /observed-series v1/u }).count()).toBe(1)
    expect(await page.getByRole('listitem', { name: /observed-series v2/u }).count()).toBe(1)
    expect(await page.locator('[data-tool="science-artifact"]').count()).toBe(0)

    const aria = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    expect(aria).toContain('Outcome published · revision 1')
    expect(aria).toContain('Outcome published · revision 2')
    expect(aria).not.toContain('The missing object is reported without hiding the publication.')
    expect(aria).not.toContain('/private/host/science')
    expect(aria).not.toContain(FINGERPRINT)

    await page.reload({ waitUntil: 'load' })
    await openSeed()
    expect(await page.getByRole('listitem', { name: /observed-series v1/u }).count()).toBe(1)
    expect(await page.getByRole('listitem', { name: /observed-series v2/u }).count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)

  it('renders a canonical post-dispatch abort as stopped while replay retains CANCELLED', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-cancelled-run'))
    await openSessionByTitle(SEED_TITLE)
    const row = page.locator('[data-tool="science-run"][data-state="stopped"]')
    await row.waitFor({ timeout: 15_000 })
    expect(await row.getByText('Run stopped', { exact: true }).count()).toBe(1)
    expect(await row.getByText('Error: tool call aborted', { exact: true }).count()).toBe(0)
    await row.getByRole('button').first().click()
    expect(await row.getByText('Error: tool call aborted', { exact: true }).count()).toBe(1)

    const session = scaffold.ctx.sessions.get(SessionId(SEED_ID))
    if (session === undefined) throw new Error('Science cancelled-run fixture was not seeded')
    expect(replayScience(session.events)?.runs.find(run => run.runId === CANCELLED_RUN_ID))
      .toMatchObject({ status: 'cancelled', failureCode: 'CANCELLED' })
  })

  it('shows the Science header action only for the Science session and opens the client-safe landing view', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-header-details'))
    const detailsPanel = page.locator('[class*="detailsCol"]')
    const scienceAction = page.getByRole('button', { name: 'Science details' })

    // A Standard (non-Science) Session shows no action at all.
    await openSessionByTitle(STANDARD_SEED_TITLE)
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await scienceAction.count()).toBe(0)

    // The built-in `science` preset session shows the action; activating it
    // opens the Details column with no tab open: the latest-artifact gallery.
    await openSessionByTitle(SEED_TITLE)
    await page.getByText('Outcome published · revision 2', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => scienceAction.count(), { timeout: 10_000 }).toBe(1)
    await scienceAction.click()
    await detailsPanel.getByText('Science', { exact: true }).waitFor({ timeout: 10_000 })

    // Only the latest accepted chart version renders in the gallery (v2, the missing object).
    expect(await detailsPanel.getByRole('button', { name: 'Open Missing revision, version 2' }).count()).toBe(1)
    expect(await detailsPanel.getByRole('button', { name: 'Failed to load, click to retry' }).count()).toBe(1)
    expect(await detailsPanel.getByText('Updated finding', { exact: true }).count()).toBe(0)
    // No Environment strip or Runs list on the landing view (removed with
    // the dashboard); those facts now live only in the per-artifact
    // Provenance drill-in, checked below.
    expect(await detailsPanel.getByText('Profile:', { exact: false }).count()).toBe(0)

    // Drill into the artifact's Provenance → Environment sub-tab: the same
    // client-safe projection, rendered as JSON.
    await detailsPanel.getByRole('button', { name: 'Open Missing revision, version 2' }).click()
    await detailsPanel.getByRole('button', { name: 'Provenance' }).click()
    await detailsPanel.getByRole('tab', { name: 'Environment' }).click()
    // Shiki-highlighted JSON tokenizes the text across spans, so poll the
    // panel's flattened text rather than matching a single text node.
    await expect.poll(async () => (await detailsPanel.innerText()).includes('"profileId"'), { timeout: 10_000 }).toBe(true)

    const detailsText = await detailsPanel.innerText()
    // Client-safe facts reach the panel: profile id, revision, per-language
    // capability, language version, and the twelve-character fingerprint
    // preview.
    expect(detailsText).toContain('"profileId": "browser-profile"')
    expect(detailsText).toContain('"revision": 1')
    expect(detailsText).toContain('"capability": "available"')
    expect(detailsText).toContain('"languageVersion": "3.13.5"')
    expect(detailsText).toContain('"fingerprintPreview": "bbbbbbbbbbbb"')
    // No absolute Host path, executable identity, condaHistorySha256, or the
    // full 64-character fingerprint ever reaches the rendered panel — only
    // the twelve-character preview asserted above.
    expect(detailsText).not.toContain('/private/host/science')
    expect(detailsText).not.toContain('/private/host/science/bin/python')
    expect(detailsText).not.toContain('dev:1-ino:2')
    expect(detailsText).not.toContain(FINGERPRINT)
    expect(detailsText).not.toContain('a'.repeat(64))

    // Switching to a non-Science Session shows no action either.
    await openSessionByTitle(STANDARD_SEED_TITLE)
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await scienceAction.count()).toBe(0)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)

  it('activating a transcript chart row opens its tab, the toolbar steps versions, and the provenance drill-in jumps to the transcript', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-provenance'))
    const detailsPanel = page.locator('[class*="detailsCol"]')
    const centerCol = page.locator('[class*="centerCol"]')

    await openSessionByTitle(SEED_TITLE)
    // Scoped to the transcript: an earlier case leaves the Details column
    // open, and the artifact viewer's landing view renders this same title.
    await centerCol.getByText('Outcome published · revision 2', { exact: true }).waitFor({ timeout: 15_000 })

    // Execution cells stay folded; exact artifact versions open from their Turn-end cards.
    const runRows = centerCol.locator('[data-tool="science-run"]')
    expect(await runRows.count()).toBe(3)
    const firstRun = runRows.nth(0)
    const secondRun = runRows.nth(1)
    expect(await firstRun.innerText()).not.toContain('run complete')
    expect(await secondRun.innerText()).not.toContain('revised run complete')
    // Scoped to the toolbar's stepper label, not the ArtifactMetaRail's own
    // "Version" definition, which renders the identical "v1"/"v2" text.
    const stepperLabel = detailsPanel.locator('[class*="stepperLabel"]')
    await centerCol.getByRole('listitem', { name: /observed-series v1/u }).click()
    await stepperLabel.getByText('v1', { exact: true }).waitFor({ timeout: 10_000 })
    await centerCol.getByRole('listitem', { name: /observed-series v2/u }).click()
    await stepperLabel.getByText('v2', { exact: true }).waitFor({ timeout: 10_000 })

    // The v2 run chip opens its exact version directly in the content view —
    // no intermediate gallery click.
    const tab = detailsPanel.getByRole('tab', { name: 'Missing revision' })
    await tab.waitFor({ timeout: 10_000 })
    expect(await tab.getAttribute('aria-selected')).toBe('true')

    // The version stepper walks to the other durable version and back.
    const prevVersion = detailsPanel.getByRole('button', { name: 'Previous version' })
    const nextVersion = detailsPanel.getByRole('button', { name: 'Next version' })
    expect(await nextVersion.isDisabled()).toBe(true)
    await prevVersion.click()
    // The stepped-to title shows twice: once as the tab label, once in the toolbar.
    await detailsPanel.getByText('Observed series', { exact: true }).first().waitFor({ timeout: 10_000 })
    expect(await detailsPanel.getByText('Durable browser fixture', { exact: true }).count()).toBe(1)
    expect(await prevVersion.isDisabled()).toBe(true)

    // Maximize opens the shared lightbox from the toolbar (not the image's
    // own click-to-open state) — v1's attachment is stored, so the load
    // resolves. (v2's is the deliberately missing object; maximize on it is
    // covered by the loader-rejection unit coverage instead.)
    await detailsPanel.getByRole('button', { name: 'Expand' }).click()
    await page.getByRole('dialog', { name: 'Original' }).waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)

    await nextVersion.click()
    await detailsPanel.getByText('Missing revision', { exact: true }).first().waitFor({ timeout: 10_000 })

    // Provenance drills in: a breadcrumb over four sub-tabs. The sub-tab
    // selection is a sticky preference carried across tabs (not reset here),
    // so select Code explicitly rather than assuming a fresh default.
    await detailsPanel.getByRole('button', { name: 'Provenance' }).click()
    await detailsPanel.getByRole('navigation', { name: 'Provenance' }).waitFor({ timeout: 10_000 })
    await detailsPanel.getByRole('tab', { name: 'Code' }).click()
    // The durable digest anchor renders even though the fixture's run
    // arguments carry no `code` field (the code part itself reports unavailable).
    expect(await detailsPanel.getByText(`SHA-256 ${'c'.repeat(64)}`, { exact: true }).count()).toBe(1)

    await detailsPanel.getByRole('tab', { name: 'Execution log' }).click()
    await detailsPanel.getByText('stdout 2 bytes, stderr 0 bytes', { exact: true }).waitFor({ timeout: 10_000 })

    // The assembled golden: the tab strip, toolbar (version label, expand,
    // download, close tab), and the drill-in's breadcrumb/sub-tabs/Execution
    // log body, all inside the Details column — the whole rendered
    // accessibility tree, so a regression that drops or reorders a region
    // changes this file.
    await compareOrRefreshGolden(
      ARTIFACTS_EXPECTED,
      [
        '## Details column — artifact viewer',
        await captureStableAria(page, '[class*="detailsCol"]', scaffold.workspaceCwd),
      ].join('\n'),
      MODE,
    )

    // The Messages sub-tab's jump reaches the real transcript: the center
    // column switches to Trajectory and reveals the target call.
    await detailsPanel.getByRole('tab', { name: 'Messages' }).click()
    await detailsPanel.getByRole('button', { name: 'Jump to transcript' }).click()
    await expect.poll(() => centerCol.getByRole('tab', { name: 'Trajectory' }).getAttribute('aria-selected'))
      .toBe('true')

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)
})
