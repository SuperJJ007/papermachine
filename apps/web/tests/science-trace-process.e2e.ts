/** Cold Science replay pins the Process strip, expanded steps, and responsive navigation. */
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ArtifactRecord, ProjectId, VersionRecord } from '@deepseek-ai/dsh-science-artifact-store'
import { ScienceEnvironmentProfileId, ScienceRunId, ScienceScratchKey } from '@deepseek-ai/dsh-science-session'
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

function processFixture(projectId: ProjectId, stored: Stored): string {
  const session = Session.create(SessionId(SEED_ID))
  const origin = Date.now() - 60_000 - 500
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
    },
  } })
  const kernel = { kernelEpoch: 1, language: 'python' as const, environmentRevision: 1, environmentFingerprint: FINGERPRINT }
  session.append('science/kernel-state', { version: 1, kernel: { ...kernel, state: 'started', at: eventTime(3) } })
  const user = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Draw a scatter plot.' }],
    source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('session/title', { title: 'Science process', messageSeqs: [user.seq], source: { kind: 'fallback' } })
  let requestSeq = 0
  const artifact = {
    artifactId: stored.artifact.artifactId, producerSessionId: session.id, logicalName: 'scatter_plot.png', version: 1,
    title: 'Scatter plot', origin: 'auto' as const, projectId, versionId: stored.version.versionId,
    sha256: stored.version.sha256, mediaType: 'image/png' as const, byteCount: stored.version.byteCount,
    runId: ScienceRunId('process-run-2'), toolCallId: CallId('process-call-2'), requestHeaderSeq: 0,
    environmentRevision: 1, environmentFingerprint: FINGERPRINT, createdAt: 0,
  }
  const calls = [
    ['run_python', { code: 'raise ValueError("fixture failure")' }],
    ['read', { file_path: '/Users/private/input.csv' }],
    ['read', { file_path: '/Users/private/schema.json' }],
    ['read', { file_path: '/Users/private/notes.md' }],
    ['run_python', { code: 'print("PRIVATE_STDOUT")' }],
    ['annotate_artifact', { logical_name: 'scatter_plot.png', version: 1, title: 'Scatter plot' }],
  ] as const
  calls.forEach(([name, args], index) => {
    const step = index + 1
    const callId = CallId(`process-call-${String(index === 4 ? 2 : index === 0 ? 1 : step + 10)}`)
    session.append('step/start', { turn: 1, step })
    const request = session.append('request/header', { header: { config: { provider: 'fixture', model: 'fixture' } }, reason: 'initial' })
    requestSeq = request.seq
    session.append('assistant/message', { turn: 1, step, message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
      source: { provider: 'fixture', model: 'fixture' },
    }) }, { surfaceOp: 'append' })
    const call = session.append('tool/call', { turn: 1, step, callId, name, arguments: JSON.stringify(args) })
    if (name === 'run_python') {
      const runId = ScienceRunId(`process-run-${index === 0 ? '1' : '2'}`)
      const run = { runId, language: 'python' as const, toolCallId: callId, requestHeaderSeq: request.seq,
        environmentRevision: 1, environmentFingerprint: FINGERPRINT, startedAt: eventTime(call.seq + 1),
        codeSha256: 'c'.repeat(64), scratchKey: ScienceScratchKey('d'.repeat(64)),
        runDirectoryRef: `runs/${runId}/`, kernelEpoch: 1 }
      session.append('science/run-started', { version: 1, run: { ...run, status: 'running' } })
      session.append('science/run-finished', { version: 1, run: { ...run, status: index === 0 ? 'failed' : 'success',
        ...(index === 0 ? { failureCode: 'EXECUTION_ERROR' } : {}),
        finishedAt: eventTime(call.seq + 2), stdoutBytes: 0, stderrBytes: 0, stdoutTruncated: false, stderrTruncated: false } })
      if (index === 4) session.append('science/artifact-saved', { version: 1, artifact: {
        ...artifact, requestHeaderSeq: request.seq, createdAt: eventTime(call.seq + 3),
      } })
    }
    session.append('tool/result', { turn: 1, step, message: createToolResultMessage({
      callId, content: [{ type: 'text', text: 'PRIVATE_TOOL_OUTPUT' }], isError: index === 0,
    }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    session.append('step/end', { turn: 1, step })
  })
  session.append('science/kernel-state', { version: 1, kernel: {
    ...kernel, state: 'exited', reason: 'idle', startedAt: eventTime(3), at: eventTime(requestSeq + 4),
  } })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0,
    cwd: '{{cwd}}', agentPreset: 'science' }), ...session.events.map(event => JSON.stringify({ ...event, time: eventTime(event.seq) })), ''].join('\n')
}

describe('web e2e: Science process view', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page
  let tripwire: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const { projectId } = await scaffold.ctx.scienceArtifactStore.openProject(scaffold.workspaceCwd)
    const stored = await scaffold.ctx.scienceArtifactStore.createArtifact(projectId, {
      logicalName: 'scatter_plot.png', data: PNG, mediaType: 'image/png', title: 'Scatter plot', origin: 'auto', originSessionId: SessionId(SEED_ID),
    })
    await seedSession(scaffold, processFixture(projectId, stored), SEED_ID, 'science')
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 720)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.locator('[role="treeitem"]').first().click()
    await page.locator('[role="treeitem"]').nth(1).click()
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
    await page.getByRole('tab', { name: 'Process', exact: true }).waitFor()
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('pins collapsed and expanded process states and preserves disclosure across Detailed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-process'))
    const process = page.getByRole('region', { name: 'Science process view' })
    const selector = '[aria-label="Science process view"]'
    expect(await page.getByRole('tab', { name: 'Process', exact: true }).getAttribute('aria-selected')).toBe('true')
    expect(await process.getByRole('list').count()).toBe(0)
    expect(await process.getByRole('group', { name: 'Step strip' }).getByRole('button').count()).toBe(6)
    const collapsed = await captureStableAria(page, selector, scaffold.workspaceCwd)
    expect(collapsed).toContain('Python kernel #1 exited (idle)')
    await process.getByRole('button', { name: 'Read file schema.json' }).click()
    expect(await process.locator('[data-highlight="true"]').innerText()).toContain('Reviewed 3 sources')
    expect(await process.getByRole('listitem').count()).toBe(4)
    const expanded = await captureStableAria(page, selector, scaffold.workspaceCwd)
    expect(expanded).not.toMatch(/PRIVATE_|\/Users\/|raise ValueError|print\(/u)
    await compareOrRefreshGolden(EXPECTED, ['## Collapsed', collapsed, '## Expanded', expanded].join('\n'), MODE)
    await process.getByRole('list').getByRole('button', { name: 'scatter_plot.png v1', exact: true }).click()
    await page.locator('[class*="detailsCol"]').getByRole('img', { name: /Scatter plot|scatter_plot/u }).waitFor()
    await process.getByRole('button', { name: 'Reviewed 3 sources' }).click()
    expect(await page.getByRole('tab', { name: 'Detailed', exact: true }).getAttribute('aria-selected')).toBe('true')
    await page.getByRole('tab', { name: 'Process', exact: true }).click()
    expect(await process.getByRole('listitem').count()).toBe(4)
    await page.setViewportSize({ width: 720, height: 720 })
    expect(await process.evaluate(root => root.scrollWidth <= root.clientWidth)).toBe(true)
    expect(await process.locator('[data-line-budget="3"]').evaluate(card => card.scrollWidth <= card.clientWidth)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
  }, 60_000)
})
