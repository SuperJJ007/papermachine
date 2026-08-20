// Web e2e scenario: a real composer turn invokes a persistent Science kernel,
// parks in a cooperative run, and stops through the browser control. The
// fake driver is the Runtime suite's wire-protocol fixture, so the UI acts on
// the same run-started/run-finished and tool-result path production uses.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { replayScience } from '@deepseek-ai/dsh-science-session'
import ScienceRuntime from '@deepseek-ai/dsh-science-runtime'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import { createFakePythonPrefix, DirectSandbox, installTestKernelSet } from './science-persistent-kernel-test-helpers.ts'

const MODE = webSnapshotMode()
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./science-preset.overlay.yml', import.meta.url))
const PROMPT = 'Run the prepared Science kernel action now.'

/** One model response that dispatches a fake kernel run which waits for SIGINT. */
function sleepingRunEntry(): ReplayEntry {
  const callId = CallId('science-stop-run-python')
  const argumentsJson = JSON.stringify({
    code: JSON.stringify({ action: 'sleep', sleepMs: 60_000, trapSigint: true }),
  })
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: callId, name: 'run_python', argumentsDelta: argumentsJson },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'run_python', arguments: argumentsJson } },
      { type: 'usage', usage: { inputTokens: 32, outputTokens: 16 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  }
}

describe.skipIf(MODE === 'record')('web e2e: Science persistent-kernel Stop', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let scratch: string
  let replayRoot: string
  let liveSession: Session | undefined
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scratch = await mkdtemp(join(REPO_ROOT, '.web-science-stop-scratch-'))
    replayRoot = await mkdtemp(join(tmpdir(), 'dsh-web-science-stop-'))
    const replayFixture = join(replayRoot, 'session.jsonl')
    const replayOverride = join(replayRoot, 'replay.override.json')
    await writeFile(replayFixture, '{"type":"session","version":0,"id":"science-stop","createdAt":0}\n')
    await writeFile(replayOverride, JSON.stringify([sleepingRunEntry()]))
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      replayFixture,
      replayOverride,
      agentPresets: {
        roots: [{ path: join(REPO_ROOT, 'apps/cli/config/agent-presets'), trust: 'system' }],
        default: 'science',
      },
    })
    const isolated = scaffold.ctx.isolate('subprocess').isolate('sandbox')
    await isolated.plugin(LocalSubprocessRuntime)
    await isolated.plugin(DirectSandbox)
    await isolated.plugin(ScienceRuntime, {
      dshHome: join(scratch, 'dsh-home'),
      profiles: { science: { pythonPrefix: createFakePythonPrefix(scratch) } },
    })
    installTestKernelSet(isolated, isolated.scienceRuntime)
    scaffold.ctx.on('session/event', (session, event: SessionEvent) => {
      liveSession = session
      sessionEvents.push(event)
    })

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    await rm(replayRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    await rm(scratch, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Science Stop browser fixture teardown failed')
  })

  it('stops a dispatched run_python call through the browser and commits cancelled/CANCELLED', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-persistent-stop'))
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 15_000 })
    const settled = scaffold.whenTurnSettled(90_000)
    await input.fill(PROMPT)
    await input.press('Enter')

    await expect.poll(() => sessionEvents.some(event => event.type === 'science/run-started'), { timeout: 30_000 }).toBe(true)
    const runningRow = page.locator('[data-tool="science-run"][data-state="running"]')
    await runningRow.waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Stop generating' }).click()

    await settled
    const session = liveSession
    if (session === undefined) throw new Error('Science Stop session was not retained after its turn settled')
    const run = replayScience(session.events)?.runs.at(-1)
    expect(run).toMatchObject({ status: 'cancelled', failureCode: 'CANCELLED' })
    expect(session.events.find(event => event.type === 'tool/result' && event.data.error?.code === 'ABORTED')).toBeDefined()

    const stoppedRow = page.locator('[data-tool="science-run"][data-state="stopped"]')
    await stoppedRow.waitFor({ timeout: 15_000 })
    expect(await stoppedRow.getByText('Run stopped', { exact: true }).count()).toBe(1)
  }, 120_000)
})
