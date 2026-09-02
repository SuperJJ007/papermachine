/** Cold Science replay pins the Process strip, expanded steps, and responsive navigation. */
import { Buffer } from 'node:buffer'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ArtifactRecord, ProjectId, VersionRecord } from '@deepseek-ai/dsh-science-artifact-store'
import { foldScience, ScienceEnvironmentProfileId, ScienceRunId, ScienceScratchKey } from '@deepseek-ai/dsh-science-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./snapshots/science-trace-process/process.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'science-process-web-e2e'
const FINGERPRINT = 'e'.repeat(64)
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
type Stored = { readonly artifact: ArtifactRecord; readonly version: VersionRecord }

function processFixture(projectId: ProjectId, stored: Stored, historyTail = false): string {
  const session = Session.create(SessionId(historyTail ? `${SEED_ID}-history` : SEED_ID))
  const origin = Date.now() - 120_000 - 500
  const eventTime = (seq: number): number => origin + seq * 1_000
  session.append('turn/start', { turn: 1 })
  session.append('science/mode-bound', { version: 1, mode: { modeId: 'science', presetId: 'science', modeRevision: 'process-browser' } })
  session.append('science/environment-bound', { version: 1, environment: {
    revision: 1, profileId: ScienceEnvironmentProfileId('science'), configuredAt: eventTime(1), validatedAt: eventTime(2),
    status: 'applied', python: {
      language: 'python', configuredPrefix: '/private/host/science', canonicalPrefix: '/private/host/science',
      executable: '/private/host/science/bin/python', executableIdentity: 'dev:1-ino:2', languageVersion: '3.12.0',
      condaHistorySha256: 'a'.repeat(64), bindingFingerprint: FINGERPRINT, packages: [],
      packagesSha256: 'f'.repeat(64), packagesTruncated: false, capability: 'available',
    }, r: {
      language: 'r', configuredPrefix: '/private/host/science-r', canonicalPrefix: '/private/host/science-r',
      executable: '/private/host/science-r/bin/R', executableIdentity: 'dev:1-ino:3', languageVersion: '4.4.0',
      condaHistorySha256: 'a'.repeat(64), bindingFingerprint: FINGERPRINT, packages: [],
      packagesSha256: 'f'.repeat(64), packagesTruncated: false, capability: 'available',
    },
  } })
  const kernel = { kernelEpoch: 1, language: 'python' as const, environmentRevision: 1, environmentFingerprint: FINGERPRINT }
  session.append('science/kernel-state', { version: 1, kernel: { ...kernel, state: 'started', at: eventTime(3) } })
  const user = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Draw a scatter plot.' }],
    source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('session/title', { title: historyTail ? 'Science process history' : 'Science process', messageSeqs: [user.seq], source: { kind: 'fallback' } })
  const artifact = {
    artifactId: stored.artifact.artifactId, logicalName: 'scatter_plot.png', version: 1,
    title: 'Scatter plot', projectId, versionId: stored.version.versionId,
    sha256: stored.version.sha256, seenAt: 0,
  }
  const calls = [
    ['get_science_state', {}],
    ['run_python', { code: 'raise ValueError("fixture failure")' }],
    ['read', { file_path: '/Users/private/input.csv' }],
    ['read', { file_path: '/Users/private/schema.json' }],
    ['read', { file_path: '/Users/private/notes.md' }],
    ['run_python', { code: 'plot = draw_scatter(data)\nplot.savefig("scatter_plot.png")' }],
    ['run_r', { code: 'cor(data$x, data$y)' }],
    ['annotate_artifact', { logical_name: 'scatter_plot.png', title: 'Scatter plot' }],
  ] as const
  calls.forEach(([name, args], index) => {
    const step = index + 1
    const callId = CallId(`process-call-${String(index === 5 ? 2 : index === 1 ? 1 : step + 10)}`)
    session.append('step/start', { turn: 1, step })
    const request = session.append('request/header', { header: { config: { provider: 'fixture', model: 'fixture' } }, reason: 'initial' })
    session.append('assistant/message', { turn: 1, step, message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
      source: { provider: 'fixture', model: 'fixture' },
    }) }, { surfaceOp: 'append' })
    const call = session.append('tool/call', { turn: 1, step, callId, name, arguments: JSON.stringify(args) })
    const stdout = index === 1 ? '' : name === 'run_r' ? '[1] 0.84' : 'Saved scatter_plot.png'
    const stderr = index === 1 ? 'ValueError: fixture failure' : ''
    if (name === 'run_r') session.append('science/kernel-state', { version: 1, kernel: {
      ...kernel, kernelEpoch: 2, language: 'r', state: 'started', at: eventTime(call.seq + 1),
    } })
    if (name === 'run_python' || name === 'run_r') {
      const runId = ScienceRunId(`process-run-${index === 1 ? '1' : index === 5 ? '2' : 'r'}`)
      const run = { runId, language: name === 'run_r' ? 'r' as const : 'python' as const, toolCallId: callId, requestHeaderSeq: request.seq,
        environmentRevision: 1, environmentFingerprint: FINGERPRINT, startedAt: eventTime(call.seq + 1),
        codeSha256: 'c'.repeat(64), scratchKey: ScienceScratchKey('d'.repeat(64)),
        runDirectoryRef: `runs/${runId}/`, kernelEpoch: name === 'run_r' ? 2 : 1 }
      session.append('science/run-started', { version: 1, run: { ...run, status: 'running' } })
      session.append('science/run-finished', { version: 1, run: { ...run, status: index === 1 ? 'failed' : 'success',
        ...(index === 1 ? { failureCode: 'EXECUTION_ERROR' } : {}),
        finishedAt: eventTime(call.seq + 2), stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
        stdoutTruncated: false, stderrTruncated: false } })
      if (index === 5) session.append('science/artifact-saved', { version: 1, artifact: {
        ...artifact, seenAt: eventTime(call.seq + 3),
      } })
    }
    if (name === 'annotate_artifact') session.append('science/artifact-saved', { version: 1, artifact: {
      ...artifact, seenAt: eventTime(call.seq + 1),
    } })
    const output = name === 'run_python' || name === 'run_r'
      ? `status: ${index === 1 ? 'failed' : 'success'}\n--- stdout ---\n${stdout || '(empty)'}\n--- stderr ---\n${stderr || '(empty)'}`
      : name === 'get_science_state' ? '{"profile":"science","artifacts":[]}'
        : name === 'annotate_artifact' ? 'Annotated scatter_plot.png: Scatter plot'
          : ['x,y\n1,2\n2,4', '{"columns":["x","y"]}', '120 observations; remove missing pairs.'][index - 2]!
    session.append('tool/result', { turn: 1, step, message: createToolResultMessage({
      callId, content: [{ type: 'text', text: output }], isError: index === 1,
    }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    session.append('step/end', { turn: 1, step })
  })
  for (const event of session.events.filter(event => event.type === 'science/kernel-state')) {
    const started = event.data.kernel
    if (started.state !== 'started') continue
    session.append('science/kernel-state', { version: 1, kernel: {
      ...started, state: 'exited', reason: 'idle', startedAt: started.at, at: eventTime(session.events.length),
    } })
  }
  if (historyTail) {
    // More than one real history page separates the producing calls from the latest request.
    for (let step = 9; step < 64; step++) {
      session.append('step/start', { turn: 1, step })
      session.append('assistant/message', { turn: 1, step, message: createAssistantMessage({
        content: [{ type: 'text', text: `Analysis note ${step}` }], source: { provider: 'fixture', model: 'fixture' },
      }) }, { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step })
    }
  }
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  if (historyTail) {
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Inspect the latest state.' }],
      source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 2, step: 1 })
    const callId = CallId('history-current')
    session.append('assistant/message', { turn: 2, step: 1, message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'get_science_state', arguments: '{}' }],
      source: { provider: 'fixture', model: 'fixture' },
    }) }, { surfaceOp: 'append' })
    const call = session.append('tool/call', { turn: 2, step: 1, callId, name: 'get_science_state', arguments: '{}' })
    session.append('tool/result', { turn: 2, step: 1, message: createToolResultMessage({
      callId, content: [{ type: 'text', text: 'Retained Science history' }], isError: false,
    }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    session.append('step/end', { turn: 2, step: 1 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  }
  const events = session.events.map(event => ({ ...event, time: eventTime(event.seq) }))
  foldScience(events)
  return [JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: origin,
    cwd: '{{cwd}}', agentPreset: 'science' }), ...events.map(event => JSON.stringify(event)), ''].join('\n')
}

describe('web e2e: Science process view', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page
  let tripwire: ReturnType<typeof watchConsole>
  async function openSeed(history: boolean): Promise<void> {
    // Cold sidebar rows use the workspace name until opened; identify each seed by its loaded request.
    await page.getByRole('treeitem').first().click()
    await page.locator('[role="treeitem"][aria-selected]').first().click()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByText(/^(Draw a scatter plot\.|Inspect the latest state\.)$/u).first().waitFor()
    const request = page.getByText(history ? 'Inspect the latest state.' : 'Draw a scatter plot.', { exact: true })
    if (await request.count() === 0) await page.locator('[role="treeitem"][aria-selected="false"]').click()
    await request.waitFor()
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
  }
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const { projectId } = await scaffold.ctx.scienceArtifactStore.openProject(scaffold.workspaceCwd)
    const stored = await scaffold.ctx.scienceArtifactStore.createArtifact(projectId, {
      logicalName: 'scatter_plot.png', kind: 'figure', data: PNG, mediaType: 'image/png', contentOrigin: 'run-auto', originSessionId: SessionId(SEED_ID),
    })
    await scaffold.ctx.scienceArtifactStore.annotateVersion(projectId, stored.version.versionId, { actor: 'capture', title: 'Scatter plot' })
    await seedSession(scaffold, processFixture(projectId, stored), SEED_ID, 'science')
    const historyStored = await scaffold.ctx.scienceArtifactStore.createArtifact(projectId, {
      logicalName: 'scatter_plot.png', kind: 'figure', data: PNG, mediaType: 'image/png', contentOrigin: 'run-auto',
      originSessionId: SessionId(`${SEED_ID}-history`),
    })
    await scaffold.ctx.scienceArtifactStore.annotateVersion(projectId, historyStored.version.versionId, { actor: 'capture', title: 'Scatter plot' })
    await seedSession(scaffold, processFixture(projectId, historyStored, true), `${SEED_ID}-history`, 'science')
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 960)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await openSeed(false)
    await page.getByRole('tab', { name: 'Process', exact: true }).waitFor()
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('pins collapsed and expanded process states and keeps every inspection inside Process and preserves disclosure across view switches', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-process'))
    const process = page.getByRole('region', { name: 'Science process view' })
    const selector = '[aria-label="Science process view"]'
    expect(await page.getByRole('tab', { name: 'Process', exact: true }).getAttribute('aria-selected')).toBe('true')
    expect(await process.getByRole('list').count()).toBe(0)
    expect(await process.getByRole('group', { name: 'Step strip' }).getByRole('button').count()).toBe(8)
    const evidenceDir = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
    mkdirSync(evidenceDir, { recursive: true })
    await page.screenshot({ path: `${evidenceDir}/science-process-collapsed.png`, fullPage: true })
    const collapsed = await captureStableAria(page, selector, scaffold.workspaceCwd)
    expect(collapsed).toContain('Python kernel #1 exited (idle)')
    expect(await process.locator('[data-kind="kernel"]').evaluateAll(markers =>
      markers.map(marker => marker.getAttribute('data-anchor')))).toEqual([
      'kernel:python:1:started', 'kernel:r:2:started', 'kernel:python:1:exited', 'kernel:r:2:exited',
    ])
    expect(await process.locator('[data-kind="kernel"]').first().evaluate(marker =>
      marker.getBoundingClientRect().top < document.querySelector('[data-line-budget]')!.getBoundingClientRect().top)).toBe(true)
    const card = process.locator('article[data-actor="agent"]')
    await card.getByText('Draw a scatter plot.', { exact: true }).click()
    expect(await process.getByRole('listitem').count()).toBe(6)
    await card.click({ position: { x: 3, y: 3 } })
    expect(await process.getByRole('list').count()).toBe(0)
    const disclosure = process.getByRole('button', { name: /Expand steps/u })
    await disclosure.focus()
    await page.keyboard.press('Enter')
    expect(await process.getByRole('listitem').count()).toBe(6)
    await page.keyboard.press('Space')
    expect(await process.getByRole('list').count()).toBe(0)
    await process.getByRole('button', { name: 'Read file schema.json' }).click()
    expect(await process.locator('[data-highlight="true"]').innerText()).toContain('Reviewed 3 sources')
    expect(await process.getByRole('listitem').count()).toBe(6)
    const annotation = process.getByRole('listitem').filter({ hasText: 'Annotate scatter_plot.png “Scatter plot”' })
    expect(await annotation.getByRole('button', { name: 'scatter_plot.png v1', exact: true }).count()).toBe(0)
    expect(await process.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'scatter_plot.png v1', exact: true }) })
      .getByRole('button', { name: 'Python run', exact: true }).count()).toBe(1)
    const expanded = await captureStableAria(page, selector, scaffold.workspaceCwd)
    await process.evaluate((root) => { root.scrollTop = 0 })
    await page.screenshot({ path: `${evidenceDir}/science-process-expanded.png`, fullPage: true })
    expect(expanded).not.toMatch(/PRIVATE_|\/Users\//u)
    await process.getByRole('list').getByRole('button', { name: 'scatter_plot.png v1', exact: true }).click()
    await page.locator('[class*="detailsCol"]').getByRole('img', { name: /Scatter plot|scatter_plot/u }).waitFor()
    await process.getByRole('button', { name: 'Reviewed 3 sources' }).click()
    expect(await page.getByRole('tab', { name: 'Process', exact: true }).getAttribute('aria-selected')).toBe('true')
    await process.getByRole('region', { name: 'Read file schema.json' }).waitFor()
    expect(await process.getByRole('region', { name: 'Read file input.csv' }).innerText()).toContain('1,2')
    for (const title of ['Read session state', 'Python run', 'R run', 'Annotate scatter_plot.png “Scatter plot”']) {
      const buttons = process.getByRole('list').getByRole('button', { name: title, exact: true })
      for (const button of await buttons.all()) {
        await button.click()
        expect(await button.getAttribute('aria-expanded')).toBe('true')
        expect(await page.getByRole('tab', { name: 'Process', exact: true }).getAttribute('aria-selected')).toBe('true')
      }
    }
    expect(await process.getByRole('region', { name: 'Error output', exact: true }).first().innerText()).toContain('ValueError: fixture failure')
    expect(await process.getByRole('region', { name: 'Standard output', exact: true }).last().innerText()).toContain('[1] 0.84')
    const runDetails = process.getByRole('region', { name: 'Python run', exact: true }).first()
    for (const target of [runDetails.getByRole('heading'), runDetails.locator('p').first(), runDetails.locator('b').first()]) {
      await target.click()
      expect(await process.getByRole('listitem').count()).toBe(6)
    }
    await runDetails.click({ position: { x: 3, y: 3 } })
    const outputText = runDetails.getByRole('region', { name: 'Error output' }).locator('pre')
    await outputText.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
    })
    await outputText.click()
    expect(await process.getByRole('listitem').count()).toBe(6)
    await page.evaluate(() => { window.getSelection()?.removeAllRanges() })
    for (const summary of await process.getByText('Full tool result', { exact: true }).all()) {
      await summary.click()
      expect(await process.getByRole('listitem').count()).toBe(6)
      await summary.click()
    }
    const inspected = await captureStableAria(page, selector, scaffold.workspaceCwd)
    expect(inspected).not.toMatch(/PRIVATE_|\/private\/host/u)
    await compareOrRefreshGolden(EXPECTED, ['## Collapsed', collapsed, '## Expanded', expanded, '## Inspected', inspected].join('\n'), MODE)
    await process.getByRole('button', { name: 'Copy', exact: true }).first().click()
    expect(await process.getByRole('listitem').count()).toBe(6)
    await process.evaluate((root) => { root.scrollTop = 0 })
    await page.screenshot({ path: `${evidenceDir}/science-process-inspected.png`, fullPage: true })
    await runDetails.evaluate((element) => { element.scrollIntoView({ block: 'start' }) })
    await page.screenshot({ path: `${evidenceDir}/science-process-execution.png`, fullPage: true })
    await page.getByRole('tab', { name: 'Detailed', exact: true }).click()
    await page.getByRole('tab', { name: 'Process', exact: true }).click()
    expect(await process.getByRole('listitem').count()).toBe(6)
    await page.getByRole('button', { name: 'Close details', exact: true }).click()
    await page.setViewportSize({ width: 720, height: 720 })
    await expect.poll(() => page.locator('[class*="detailsCol"]').evaluate(element => element.getBoundingClientRect().width)).toBe(0)
    await expect.poll(() => page.locator('[class*="sidebarCol"]').evaluate(element => element.getBoundingClientRect().width)).toBe(56)
    await expect.poll(() => process.evaluate(root => root.clientWidth)).toBeGreaterThan(600)
    await expect.poll(() => process.evaluate(root => root.scrollWidth <= root.clientWidth)).toBe(true)
    await page.screenshot({ path: `${evidenceDir}/science-process-narrow.png`, fullPage: true })
    expect(await process.locator('[data-line-budget="4"]').evaluate(card => card.scrollWidth <= card.clientWidth)).toBe(true)
    await page.setViewportSize({ width: 1280, height: 960 })
    await process.getByRole('button', { name: 'scatter_plot.png v1', exact: true }).last().click()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)

  it('applies light, dark and system preferences to an active Science workbench while preserving image pixels', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-process-theme'))
    await page.setViewportSize({ width: 1280, height: 720 })
    const chooseTheme = async (name: 'Light' | 'Dark' | 'System') => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const option = page.getByRole('dialog').getByRole('button', { name, exact: true })
      await option.click()
      await expect.poll(() => option.getAttribute('aria-pressed')).toBe('true')
      await page.keyboard.press('Escape')
    }
    const renderedPalette = () => page.locator('[class*="frame"], [class*="sidebarCol"], [aria-label="Science process view"]')
      .evaluateAll(elements => elements.map((element) => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, scheme: style.colorScheme }
      }))
    await chooseTheme('Light')
    const light = await renderedPalette()
    expect(light).toHaveLength(3)
    const picture = page.locator('[class*="detailsCol"]').getByRole('img', { name: /Scatter plot|scatter_plot/u })
    const imagePixels = () => picture.evaluate((image) => {
      const style = getComputedStyle(image)
      return { background: style.backgroundColor, filter: style.filter, opacity: style.opacity }
    })
    const originalPixels = await imagePixels()
    expect(originalPixels).toEqual({ background: 'rgb(255, 255, 255)', filter: 'none', opacity: '1' })
    await chooseTheme('Dark')
    const dark = await renderedPalette()
    expect(dark).toHaveLength(3)
    for (const [index, surface] of dark.entries()) {
      expect(surface.scheme).toBe('dark')
      expect(surface.background).not.toBe(light[index]!.background)
    }
    expect(await imagePixels()).toEqual(originalPixels)
    await chooseTheme('Light')
    expect(await renderedPalette()).toEqual(light)
    await page.emulateMedia({ colorScheme: 'dark' })
    await chooseTheme('System')
    await expect.poll(renderedPalette).toEqual(dark)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(renderedPalette).toEqual(light)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps records outside the loaded history page on their original turn', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-process-history'))
    await page.close()
    page = await newEnglishPage(browser, 1280)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await openSeed(true)
    const process = page.getByRole('region', { name: 'Science process view' })
    const history = process.getByRole('region', { name: 'Unassigned history' })
    await expect.poll(() => history.count()).toBe(0)
    expect(await process.locator('article[data-anchor="turn:1"]').innerText()).toContain('Runs 3')
    const current = process.locator('article[data-anchor="turn:2"]')
    expect(await current.innerText()).toContain('Runs 0')
    expect(await current.getByRole('button', { name: 'scatter_plot.png v1', exact: true }).count()).toBe(0)
    const evidenceDir = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
    mkdirSync(evidenceDir, { recursive: true })
    await page.screenshot({ path: `${evidenceDir}/science-process-history.png`, fullPage: true })
    await process.locator('article[data-anchor="turn:1"]').getByRole('button', { name: 'scatter_plot.png v1', exact: true }).click()
    await page.locator('[class*="detailsCol"]').getByRole('img', { name: /Scatter plot|scatter_plot/u }).waitFor()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('button', { name: 'Load earlier', exact: true }).click()
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
    await expect.poll(() => history.count()).toBe(0)
    expect(await process.locator('article[data-anchor="turn:1"]').innerText()).toContain('Runs 3')
    expect(await current.innerText()).toContain('Runs 0')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
