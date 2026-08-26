// Web e2e scenario: a completed Science turn with a context-injection
// message and recorded step timing must NOT show the injection row or the
// per-turn run-time/TTFT/throughput metadata in the transcript flow — both
// stay reconstructable from the durable log, and Science's own denser
// transcript cells and Turn-end artifact groups make the main flow noisy if
// they persist. A non-Science Session (turn-tail-actions.e2e.ts) keeps both,
// proving the suppression is Session-scoped, not a global removal.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
// Type-only: brings the `science/mode-bound` SessionEventMap merge into this program.
import type {} from '@deepseek-ai/dsh-science-session/types'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/science-transcript-chrome', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/science-transcript-chrome/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'science-transcript-chrome-web-e2e'
const DONE = 'SCIENCE_CHROME_DONE'

/** One completed Science turn: a context-injection message ahead of a timed assistant reply. */
function scienceFixture(): string {
  const session = Session.create(SessionId('science-transcript-chrome-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  session.append('science/mode-bound', {
    version: 1,
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'science-chrome-browser' },
  })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Summarize the dataset.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Science transcript chrome',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  // A non-user source classifies as an injected-context row (message.ts).
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Skill instructions body.' }],
    source: { kind: 'plugin', plugin: 'demo-skill', form: 'instructions' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  // Timing is derived (assistant-timing.ts), not a settable field: step/start
  // opens it, this token delta stamps first-token time, and the settled
  // assistant/message's own event time closes it — the ttft/duration the
  // suppressed footer would otherwise show.
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: DONE } })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: DONE }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
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
    ...session.events.map(event => JSON.stringify({ ...event, time: eventTimeOrigin + event.seq * 1_000 })),
    '',
  ].join('\n')
}

describe('web e2e: Science transcript flow drops process-detail chrome', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, scienceFixture(), SEED_ID, 'science')
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

  it.skipIf(MODE === 'record')('hides the context-injection row and the run-time/TTFT/throughput metadata', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-transcript-chrome'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    const centerCol = page.locator('[class*="centerCol"]')
    // The durable content the row would otherwise carry never reaches the flow.
    expect(await centerCol.getByText('Skill instructions body.', { exact: false }).count()).toBe(0)
    expect(await centerCol.getByRole('button', { name: /Context injection/ }).count()).toBe(0)
    // Scoped to the turn-tail footer itself (TurnTailNodeView's
    // data-turn-tail root): the unrelated composer StatsLine dock further
    // down this same column legitimately keeps its own "TTFT avg … tok/s"
    // aggregate text.
    const turnTail = centerCol.locator('[data-turn-tail]')
    expect(await turnTail.getByText(/Ran for|TTFT|tok\/s/).count()).toBe(0)
    // The action row itself (copy/branch) is unaffected — only the metrics text drops.
    expect(await centerCol.getByRole('button', { name: 'Branch into a new conversation' }).count()).toBe(1)

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
