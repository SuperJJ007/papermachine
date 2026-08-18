// Web e2e scenario: cold replay of one `run_python` call whose auto-capture
// produced one file per accepted non-image media type plus a PNG, so real
// Chromium exercises the artifact viewer's full per-media-type content
// dispatch — a sortable CSV table, a JSON tree, rendered Markdown, and the
// existing image path — reached through the same tab strip/toolbar every
// media type shares.
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { ImageAttachmentRef, TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  ScienceArtifactId, ScienceEnvironmentProfileId, ScienceRunId, ScienceScratchKey,
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

const PANEL_EXPECTED = fileURLToPath(new URL('./snapshots/science-artifact-types/panel.expected.md', import.meta.url))
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
const FINGERPRINT = 'e'.repeat(64)
const RUN_ID = ScienceRunId('run-types-1')
const RUN_CALL_ID = CallId('call-run-types')

/** Build one closed Science session: a single `run_python` call whose auto-capture produced csv/json/md/png artifacts. */
function scienceFixture(
  csv: TextAttachmentRef, json: TextAttachmentRef, markdown: TextAttachmentRef, png: ImageAttachmentRef,
): string {
  const session = Session.create(SessionId('science-browser-types-source'))
  const origin = new Date().setHours(12, 0, 0, 0)
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
    runDirectoryRef: 'runs/run-types-1/',
  }
  session.append('science/run-started', { version: 1, run: { ...run, status: 'running' } })
  session.append('science/run-finished', {
    version: 1,
    run: {
      ...run, status: 'success', finishedAt: eventTime(runCall.seq + 2), exitCode: 0,
      stdoutBytes: 2, stderrBytes: 0, stdoutTruncated: false, stderrTruncated: false,
    },
  })

  const artifact = (
    artifactId: ReturnType<typeof ScienceArtifactId>, logicalName: string,
    attachment: TextAttachmentRef | ImageAttachmentRef,
  ) => {
    const createdAt = eventTime(runCall.seq + 3)
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId, logicalName, version: 1, title: logicalName, origin: 'auto', attachment,
        runId: RUN_ID, toolCallId: RUN_CALL_ID, requestHeaderSeq: request.seq,
        environmentRevision: 1, environmentFingerprint: FINGERPRINT, createdAt,
      },
    })
    return { artifactId, logicalName, version: 1, title: logicalName, attachment }
  }

  const items = [
    artifact(ScienceArtifactId('artifact-csv'), 'summary.csv', csv),
    artifact(ScienceArtifactId('artifact-json'), 'metrics.json', json),
    artifact(ScienceArtifactId('artifact-md'), 'report.md', markdown),
    artifact(ScienceArtifactId('artifact-png'), 'plot.png', png),
  ]

  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: RUN_CALL_ID,
      content: [{ type: 'text', text: 'status: success\nCaptured 4 artifacts.' }],
      isError: false,
    }),
    meta: {
      kind: 'science/artifact',
      version: 1,
      artifacts: items.map(item => ({
        artifactId: item.artifactId, logicalName: item.logicalName, version: item.version, title: item.title,
        attachment: {
          attachmentId: item.attachment.attachmentId,
          mediaType: item.attachment.mediaType,
          bytes: item.attachment.bytes,
          ...'width' in item.attachment ? { width: item.attachment.width, height: item.attachment.height } : {},
        },
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
    const csv = await scaffold.ctx.attachments.saveText({ data: Buffer.from(CSV_TEXT, 'utf8'), mediaType: 'text/csv', name: 'summary.csv' })
    const json = await scaffold.ctx.attachments.saveText({ data: Buffer.from(JSON_TEXT, 'utf8'), mediaType: 'application/json', name: 'metrics.json' })
    const markdown = await scaffold.ctx.attachments.saveText({ data: Buffer.from(MARKDOWN_TEXT, 'utf8'), mediaType: 'text/markdown', name: 'report.md' })
    const png = await scaffold.ctx.attachments.saveImage({ data: PNG, mediaType: 'image/png', name: 'plot.png' })
    await seedSession(scaffold, scienceFixture(csv, json, markdown, png), SEED_ID, 'science')
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

  it('renders a sortable CSV table, a JSON tree, rendered Markdown, and the existing image path, all reached from the run\'s reference chips', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-artifact-types'))
    const centerCol = page.locator('[class*="centerCol"]')
    const detailsPanel = page.locator('[class*="detailsCol"]')

    await centerCol.getByText('Captured 4 artifacts', { exact: false }).waitFor({ timeout: 15_000 })

    // Each reference chip opens its artifact's tab directly in the content view.
    await centerCol.getByRole('button', { name: /summary\.csv/ }).click()
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

    await centerCol.getByRole('button', { name: /metrics\.json/ }).click()
    await detailsPanel.getByRole('tree').waitFor({ timeout: 10_000 })
    expect(await detailsPanel.innerText()).toContain('accuracy')

    await centerCol.getByRole('button', { name: /report\.md/ }).click()
    await detailsPanel.getByRole('heading', { name: 'Result' }).waitFor({ timeout: 10_000 })
    expect(await detailsPanel.getByText('converged', { exact: false }).count()).toBeGreaterThan(0)

    await centerCol.getByRole('button', { name: /plot\.png/ }).click()
    await expect.poll(() => detailsPanel.getByRole('img', { name: 'plot.png' }).count(), { timeout: 15_000 }).toBe(1)

    // All four tabs stayed open across the chip clicks above.
    expect(await detailsPanel.getByRole('tab').count()).toBe(4)

    const aria = await captureStableAria(page, '[class*="detailsCol"]', scaffold.workspaceCwd)
    expect(aria).not.toContain('/private/host/science')
    expect(aria).not.toContain(FINGERPRINT)
    // Same non-leak as science-chart-outcome.e2e.ts: the full 64-character
    // condaHistorySha256 never reaches the rendered panel.
    expect(aria).not.toContain('a'.repeat(64))
    await compareOrRefreshGolden(
      PANEL_EXPECTED,
      ['## Details column — artifact viewer (csv/json/md/png)', aria].join('\n'),
      MODE,
    )

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)
})
