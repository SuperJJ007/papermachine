// Web e2e scenario: cold Science chart and Outcome replay. A stored Session
// and attachment fixture enters through the shipped Web composition so real
// Chromium exercises projection replay, session-scoped attachment reads,
// dedicated tool rows, reload, and lightbox keyboard behavior.
import { Buffer } from 'node:buffer'
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
  launchWebScaffold,
  seedSession,
  watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED_ID = 'science-chart-outcome-web-e2e'
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

  it('replays stored and missing chart objects with both Outcome occurrences before and after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-chart-outcome'))
    const openSeed = async (): Promise<void> => {
      const groupRow = page.locator('[role="treeitem"]').first()
      await groupRow.waitFor({ timeout: 15_000 })
      if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
      const sessionRow = page.locator('[role="treeitem"]').nth(1)
      await sessionRow.waitFor({ timeout: 10_000 })
      await sessionRow.click()
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
    expect(await page.getByRole('button', { name: 'Failed to load, click to retry' }).count()).toBe(2)

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
})
