// Web e2e scenario: cold Science chart and Outcome replay, plus the Science
// session-header action and read-only Details entry it opens. A stored
// Session and attachment fixture enters through the shipped Web composition
// so real Chromium exercises projection replay, session-scoped attachment
// reads, dedicated tool rows, reload, lightbox keyboard behavior, and the
// routed Details column's client-safe environment/run/chart/Outcome
// rendering.
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type JsonValue,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  ScienceChartId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from '@deepseek-ai/dsh-science-session'
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
const RUN_ID = ScienceRunId('run-browser-1')
const CHART_ID = ScienceChartId('chart-browser-1')
const RUN_CALL_ID = CallId('call-run-browser')
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
): void {
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text }],
      isError: false,
    }),
    ...meta === undefined ? {} : { meta },
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
}

/** Build one valid closed Science session around stored and missing attachments. */
function scienceFixture(stored: ImageAttachmentRef): string {
  const session = Session.create(SessionId('science-browser-source'))
  const origin = new Date().setHours(12, 0, 0, 0)
  const eventTime = (seq: number): number => origin + seq * 1_000
  const missing: ImageAttachmentRef = {
    ...stored,
    attachmentId: AttachmentId(`sha256:${'f'.repeat(64)}`),
    name: 'missing.png',
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
  }
  session.append('science/run-started', { version: 1, run: { ...run, status: 'running' } })
  session.append('science/run-finished', {
    version: 1,
    run: {
      ...run,
      status: 'success',
      finishedAt: eventTime(runCall.seq + 2),
      exitCode: 0,
      stdoutBytes: 2,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  })
  appendToolResult(session, RUN_CALL_ID, runCall.seq, 'run complete')

  const appendChart = (
    version: number,
    callId: ReturnType<typeof CallId>,
    attachment: ImageAttachmentRef,
  ): void => {
    const call = session.append('tool/call', {
      turn: 1, step: 1, callId, name: 'save_chart', arguments: '{}',
    })
    const createdAt = eventTime(call.seq + 1)
    session.append('science/chart-saved', {
      version: 1,
      chart: {
        chartId: CHART_ID,
        logicalName: 'observed-series',
        version,
        title: version === 1 ? 'Observed series' : 'Missing revision',
        caption: version === 1 ? 'Durable browser fixture' : 'Missing object fixture',
        attachment,
        runId: RUN_ID,
        toolCallId: callId,
        requestHeaderSeq: request.seq,
        environmentRevision: 1,
        environmentFingerprint: FINGERPRINT,
        createdAt,
      },
    })
    appendToolResult(session, callId, call.seq, `chart v${String(version)} saved`, {
      kind: 'science/chart',
      version: 1,
      chartId: CHART_ID,
      logicalName: 'observed-series',
      chartVersion: version,
      title: version === 1 ? 'Observed series' : 'Missing revision',
      caption: version === 1 ? 'Durable browser fixture' : 'Missing object fixture',
      runId: RUN_ID,
      attachment: {
        attachmentId: attachment.attachmentId,
        mediaType: attachment.mediaType,
        bytes: attachment.bytes,
        width: attachment.width,
        height: attachment.height,
        ...attachment.name === undefined ? {} : { name: attachment.name },
      },
      createdAt,
    })
  }

  const appendOutcome = (
    revision: number,
    callId: ReturnType<typeof CallId>,
    chartVersion: number,
  ): void => {
    const call = session.append('tool/call', {
      turn: 1, step: 1, callId, name: 'publish_outcome', arguments: '{}',
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
    })
  }

  appendChart(1, FIRST_CHART_CALL_ID, stored)
  appendOutcome(1, FIRST_OUTCOME_CALL_ID, 1)
  appendChart(2, SECOND_CHART_CALL_ID, missing)
  appendOutcome(2, SECOND_OUTCOME_CALL_ID, 2)
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

describe('web e2e: Science chart and Outcome replay', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const stored = await scaffold.ctx.attachments.saveImage({
      data: PNG,
      mediaType: 'image/png',
      name: 'observed.png',
    })
    await seedSession(scaffold, scienceFixture(stored), SEED_ID, 'science')
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
    if (await page.getByText('Updated finding', { exact: true }).count() > 0) return 'science'
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
      await page.getByText('Updated finding', { exact: true }).waitFor({ timeout: 15_000 })
    }

    await openSeed()
    await expect.poll(() => page.getByRole('img', { name: 'observed.png' }).count(), {
      timeout: 15_000,
    }).toBe(2)
    for (const image of await page.getByRole('img', { name: 'observed.png' }).all()) {
      expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }
    expect(await page.getByText('Initial finding', { exact: true }).count()).toBe(1)
    expect(await page.getByText('Updated finding', { exact: true }).count()).toBe(1)
    expect(await page.getByText('observed-series', { exact: true }).count()).toBe(2)
    await expect.poll(() => page.getByRole('button', { name: 'Failed to load, click to retry' }).count(), {
      timeout: 15_000,
    }).toBe(2)

    const aria = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    expect(aria).toContain('Initial finding')
    expect(aria).toContain('Updated finding')
    expect(aria).toContain('The missing object is reported without hiding the publication.')
    expect(aria).not.toContain('/private/host/science')
    expect(aria).not.toContain(FINGERPRINT)

    const opener = page.getByRole('button', { name: 'View original: observed.png' }).first()
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Original' })
    await dialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => page.getByRole('button', { name: 'Close', exact: true })
      .evaluate(element => element === document.activeElement))
      .toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)
    await expect.poll(() => opener.evaluate(element => element === document.activeElement)).toBe(true)

    await page.reload({ waitUntil: 'load' })
    await openSeed()
    await expect.poll(() => page.getByRole('img', { name: 'observed.png' }).count(), {
      timeout: 15_000,
    }).toBe(2)
    expect(await page.getByRole('button', { name: 'Failed to load, click to retry' }).count()).toBe(2)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)

  it('shows the Science header action only for the Science session and opens client-safe Details', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-header-details'))
    const detailsPanel = page.locator('[class*="detailsCol"]')
    const scienceAction = page.getByRole('button', { name: 'Science details' })

    // A Standard (non-Science) Session shows no action at all.
    await openSessionByTitle(STANDARD_SEED_TITLE)
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await scienceAction.count()).toBe(0)

    // The built-in `science` preset session shows the action; activating it
    // opens the Details column on the routed `science` entry.
    await openSessionByTitle(SEED_TITLE)
    await page.getByText('Updated finding', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => scienceAction.count(), { timeout: 10_000 }).toBe(1)
    await scienceAction.click()
    await detailsPanel.getByText('Science', { exact: true }).waitFor({ timeout: 10_000 })

    // Client-safe environment, run, chart, and Outcome states from the same
    // projection the transcript rows already reused — no second reader.
    expect(await detailsPanel.getByText('Profile: browser-profile', { exact: true }).count()).toBe(1)
    expect(await detailsPanel.getByText('Revision 1', { exact: true }).count()).toBe(1)
    expect(await detailsPanel.getByText('Available', { exact: true }).count()).toBe(1)
    expect(await detailsPanel.getByText('version 3.13.5', { exact: true }).count()).toBe(1)
    expect(await detailsPanel.getByText('fingerprint bbbbbbbbbbbb', { exact: true }).count()).toBe(1)
    expect(await detailsPanel.getByText('Success', { exact: true }).count()).toBe(1)
    // Only the latest accepted chart version renders (v2, the missing object).
    expect(await detailsPanel.getByText('Missing revision', { exact: true }).count()).toBe(1)
    expect(await detailsPanel.getByText('v2', { exact: true }).count()).toBe(1)
    expect(await detailsPanel.getByRole('button', { name: 'Failed to load, click to retry' }).count()).toBe(1)
    expect(await detailsPanel.getByText('Updated finding', { exact: true }).count()).toBe(1)
    expect(await detailsPanel.getByText('chart chart-browser-1 v2', { exact: true }).count()).toBe(1)

    // No absolute Host path, executable identity, condaHistorySha256, or the
    // full 64-character fingerprint ever reaches the rendered panel — only
    // the twelve-character preview asserted above.
    const detailsText = await detailsPanel.innerText()
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

  it('activating a transcript chart row opens the exact version, the version rail walks both, and provenance is session-gated', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-provenance'))
    const detailsPanel = page.locator('[class*="detailsCol"]')

    await openSessionByTitle(SEED_TITLE)
    // Scoped to the transcript: an earlier case leaves the Details column
    // open, and the artifact panel's Outcome section renders this same title.
    await page.locator('[class*="centerCol"]').getByText('Updated finding', { exact: true })
      .waitFor({ timeout: 15_000 })

    // Activating the v2 transcript row (the one with the missing attachment)
    // selects that exact version and opens the Details column directly in
    // detail mode — no intermediate gallery click.
    await page.getByText('Missing revision', { exact: true }).first().click()
    const rail = detailsPanel.getByLabel('Versions')
    await rail.waitFor({ timeout: 10_000 })
    expect(await rail.getByRole('button').count()).toBe(2)
    expect(await detailsPanel.getByText('Missing revision', { exact: true }).count()).toBe(1)

    // The rail walks to the other durable version.
    await rail.getByText('v1', { exact: true }).click()
    await detailsPanel.getByText('Observed series', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await detailsPanel.getByText('Durable browser fixture', { exact: true }).count()).toBe(1)
    await rail.getByText('v2', { exact: true }).click()
    await detailsPanel.getByText('Missing revision', { exact: true }).waitFor({ timeout: 10_000 })

    // Header controls appear once a version is selected; provenance opens
    // the wide center-column tab with all four parts.
    const provenanceButton = detailsPanel.getByRole('button', { name: 'Provenance' })
    await provenanceButton.waitFor({ timeout: 10_000 })
    expect(await detailsPanel.getByRole('button', { name: 'Expand' }).count()).toBe(1)
    await provenanceButton.click()
    // Scoped to the center column: the Details panel stays open beside it and
    // labels its own Environment section with the same word.
    const centerCol = page.locator('[class*="centerCol"]')
    await centerCol.getByText('Execution log', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await centerCol.getByText('Code', { exact: true }).count()).toBe(1)
    expect(await centerCol.getByText('Conversation', { exact: true }).count()).toBe(1)
    expect(await centerCol.getByText('Environment', { exact: true }).count()).toBe(1)
    // The durable digest anchor renders even though the fixture's run
    // arguments carry no `code` field (the code part itself reports unavailable).
    expect(await centerCol.getByText(`SHA-256 ${'c'.repeat(64)}`, { exact: true }).count()).toBe(1)

    // The assembled golden for both new surfaces: the artifact panel sitting
    // on a selected version (its version rail and header controls) beside the
    // provenance view's four parts. Assertions above pin individual facts;
    // this pins the whole rendered accessibility tree, so a regression that
    // drops or reorders a region changes this file.
    await compareOrRefreshGolden(ARTIFACTS_EXPECTED, [
      '## Details column — artifact panel',
      await captureStableAria(page, '[class*="detailsCol"]', scaffold.workspaceCwd),
      '',
      '## Center column — provenance view',
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd),
    ].join('\n'), MODE)

    // The provenance tab is absent (not merely empty) for a Standard session.
    await openSessionByTitle(STANDARD_SEED_TITLE)
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await page.getByRole('tab', { name: 'Provenance' }).count()).toBe(0)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)
})
