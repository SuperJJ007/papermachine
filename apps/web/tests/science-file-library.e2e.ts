// Web e2e scenario: two cold sessions in one project contribute artifacts to
// one project-level file library, which also exposes a read-only workspace file.
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-science-artifact-store'
import type {} from '@deepseek-ai/dsh-science-session'
import type {} from '@deepseek-ai/dsh-session-title'
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

const EXPECTED = fileURLToPath(new URL('./snapshots/science-file-library/library.expected.md', import.meta.url))
const SHOT_GRID = fileURLToPath(new URL('../../../.artifacts/s4-file-library-grid.png', import.meta.url))
const SHOT_LIST = fileURLToPath(new URL('../../../.artifacts/s4-file-library-list-search.png', import.meta.url))
const SHOT_FILES = fileURLToPath(new URL('../../../.artifacts/s4-file-library-project-files.png', import.meta.url))
const SHOT_CROSS_SESSION = fileURLToPath(new URL('../../../.artifacts/s4-file-library-cross-session.png', import.meta.url))
const SHOT_HEADER = fileURLToPath(new URL('../../../.artifacts/s4-file-library-header-alignment.png', import.meta.url))
const MODE = webSnapshotMode()
const SESSION_A = 'science-file-library-a'
const SESSION_B = 'science-file-library-b'

function sessionFixture(id: string, title: string): string {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('science/mode-bound', {
    version: 1,
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'science-r5-file-library' },
  })
  const message = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `Create the ${title} project outputs.` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title,
    messageSeqs: [message.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const header = {
    type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
    createdAt: 0, cwd: '{{cwd}}', agentPreset: 'science',
  }
  return [
    JSON.stringify(header),
    ...session.events.map((event, index) => JSON.stringify({ ...event, time: index + 1 })),
    '',
  ].join('\n')
}

describe('web e2e: project Science file library', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const { projectId } = await scaffold.ctx.scienceArtifactStore.openProject(scaffold.workspaceCwd)
    await scaffold.ctx.scienceArtifactStore.createArtifact(projectId, {
      logicalName: 'alpha.csv', mediaType: 'text/csv', data: Buffer.from('name,value\nalpha,1\n'),
      originSessionId: SessionId(SESSION_A), origin: 'auto', title: 'Alpha results',
    })
    await scaffold.ctx.scienceArtifactStore.createArtifact(projectId, {
      logicalName: 'notes.md', mediaType: 'text/markdown', data: Buffer.from('# Notes from A\n'),
      originSessionId: SessionId(SESSION_A), origin: 'auto', title: 'Research notes',
    })
    await scaffold.ctx.scienceArtifactStore.createArtifact(projectId, {
      logicalName: 'beta.json', mediaType: 'application/json', data: Buffer.from('{"source":"B"}'),
      originSessionId: SessionId(SESSION_B), origin: 'auto', title: 'Beta metrics',
    })
    await writeFile(`${scaffold.workspaceCwd}/seed.csv`, 'label,score\nproject,42\n')
    await seedSession(scaffold, sessionFixture(SESSION_A, 'Source session A'), SESSION_A, 'science')
    await seedSession(scaffold, sessionFixture(SESSION_B, 'Current session B'), SESSION_B, 'science')

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.locator('[role="treeitem"]').first().click()
    const currentSession = page.locator('[role="treeitem"]').nth(1)
    await currentSession.waitFor({ timeout: 10_000 })
    await currentSession.click()
    await page.getByRole('button', { name: 'Files', exact: true }).click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens cross-session artifacts and workspace files from the library', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-file-library'))
    const details = page.locator('[class*="detailsCol"]')
    await expect.poll(() => details.getByText('3 artifacts', { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    expect(await details.getByText(/v1 · text\/csv · Source session A/).count()).toBe(1)
    expect(await details.getByText(/v1 · application\/json · This session/).count()).toBe(1)
    await page.waitForTimeout(400)
    await page.screenshot({ path: SHOT_GRID, fullPage: true })
    await page.screenshot({ path: SHOT_HEADER, fullPage: true })

    await details.getByPlaceholder('Search').fill('Alpha')
    expect(await details.getByRole('button', { name: /Alpha results/ }).count()).toBe(1)
    expect(await details.getByRole('button', { name: /Research notes/ }).count()).toBe(0)
    await details.getByPlaceholder('Search').fill('')
    await details.getByRole('combobox', { name: 'Artifact sort' }).selectOption({ label: 'Name' })
    await details.getByRole('button', { name: 'Switch grid or list view' }).click()
    await details.getByPlaceholder('Search').fill('Alpha')
    await page.screenshot({ path: SHOT_LIST, fullPage: true })
    await details.getByPlaceholder('Search').fill('')

    await details.getByRole('button', { name: /Alpha results/ }).click()
    await details.getByRole('table', { name: 'alpha.csv' }).waitFor({ timeout: 10_000 })
    expect(await details.getByText('alpha', { exact: true }).count()).toBeGreaterThan(0)
    await details.getByRole('button', { name: 'Provenance', exact: true }).click()
    expect(await details.getByText('Source session A', { exact: true }).count()).toBe(1)
    expect(await details.getByRole('button', { name: 'Back to original conversation', exact: true }).isDisabled()).toBe(true)
    await page.screenshot({ path: SHOT_CROSS_SESSION, fullPage: true })
    await details.getByRole('button', { name: 'Alpha results', exact: true }).click()
    await details.getByRole('button', { name: 'File library', exact: true }).click()
    await details.getByRole('button', { name: 'Close Alpha results', exact: true }).click()

    await details.getByRole('button', { name: 'Project files', exact: true }).click()
    await expect.poll(() => details.getByText('1 project files', { exact: true }).count()).toBe(1)
    await page.screenshot({ path: SHOT_FILES, fullPage: true })
    await details.getByRole('button', { name: /seed\.csv/ }).click()
    await details.getByRole('table', { name: 'seed.csv' }).waitFor({ timeout: 10_000 })
    expect(await details.getByText('project', { exact: true }).count()).toBeGreaterThan(0)
    await details.getByRole('button', { name: 'Close seed.csv', exact: true }).click()
    await expect.poll(() => details.getByText('3 artifacts', { exact: true }).count()).toBe(1)

    await compareOrRefreshGolden(
      EXPECTED,
      ['## Details column — project file library', await captureStableAria(page, '[class*="detailsCol"]', scaffold.workspaceCwd)].join('\n'),
      MODE,
    )
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)
})
