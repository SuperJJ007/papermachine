// Web e2e scenario: a real composer turn invokes a persistent Science kernel
// through the Runtime suite's wire-protocol fixture, so the UI acts on the
// same run-started/run-finished and tool-result path production uses. Beyond
// the original Stop scenario, this file also proves the eight-state
// `run_python`/`run_r` row redesign, the generic adjacent-Tool-call group,
// and Think-attach end to end: a real settled success (kernel badge, plain
// stdout), two real adjacent run_python calls folding into one generated
// group title, a real kernel crash mid-run rendering the amber
// kernel-exited state, and a real reasoning block ahead of a paired run
// folding onto that same group instead of rendering its own Think row.
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

/** One model response that dispatches a fake kernel run settling per `action` (the shared kernel_python.py fixture's action DSL). */
function runEntry(action: Record<string, unknown>): ReplayEntry {
  const callId = CallId(`science-run-${Math.random().toString(36).slice(2)}`)
  const argumentsJson = JSON.stringify({ code: JSON.stringify(action) })
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

/** One model response dispatching two adjacent fake kernel runs in the same step (P3d Tool grouping). */
function pairedRunEntry(action: Record<string, unknown>): ReplayEntry {
  const firstId = CallId(`science-run-a-${Math.random().toString(36).slice(2)}`)
  const secondId = CallId(`science-run-b-${Math.random().toString(36).slice(2)}`)
  const argumentsJson = JSON.stringify({ code: JSON.stringify(action) })
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: firstId, name: 'run_python', argumentsDelta: argumentsJson },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: firstId, name: 'run_python', arguments: argumentsJson } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: secondId, name: 'run_python', argumentsDelta: argumentsJson },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: secondId, name: 'run_python', arguments: argumentsJson } },
      { type: 'usage', usage: { inputTokens: 32, outputTokens: 16 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  }
}

/**
 * One model response that reasons first, then dispatches two adjacent fake
 * kernel runs in the same step (P3d/Think-attach: the pure-reasoning block
 * must not split the two calls' Tool group apart, and must not render as
 * its own independent row).
 */
function reasoningThenPairedRunEntry(action: Record<string, unknown>, reasoningText: string): ReplayEntry {
  const firstId = CallId(`science-run-think-a-${Math.random().toString(36).slice(2)}`)
  const secondId = CallId(`science-run-think-b-${Math.random().toString(36).slice(2)}`)
  const argumentsJson = JSON.stringify({ code: JSON.stringify(action) })
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: reasoningText },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoningText } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: firstId, name: 'run_python', argumentsDelta: argumentsJson },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: firstId, name: 'run_python', arguments: argumentsJson } },
      { type: 'block-start', index: 2, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 2, id: secondId, name: 'run_python', argumentsDelta: argumentsJson },
      { type: 'block-end', index: 2, block: { type: 'tool-call', id: secondId, name: 'run_python', arguments: argumentsJson } },
      { type: 'usage', usage: { inputTokens: 32, outputTokens: 16 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  }
}

/** A plain closing reply with no further tool call, so a turn whose run settled normally still ends. */
function textFinishEntry(text: string): ReplayEntry {
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 16, outputTokens: 8 } },
      { type: 'finish', reason: { kind: 'stop' } },
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
    await writeFile(replayOverride, JSON.stringify([
      // Consumed in order, one entry per model call, across every `it` below
      // (one shared session/page): the original Stop scenario's single call
      // (its turn ends via cancellation, no follow-up), then one entry per
      // later scenario's run(s) plus its closing text reply.
      sleepingRunEntry(),
      runEntry({ action: 'reply', status: 'ok', stdout: 'max deviation = 0.0 px\nlongest label: 72 chars' }),
      textFinishEntry('Done.'),
      pairedRunEntry({ action: 'reply', status: 'ok', stdout: 'ok' }),
      textFinishEntry('Both finished.'),
      runEntry({ action: 'crash' }),
      textFinishEntry('The kernel exited; here is what happened.'),
      reasoningThenPairedRunEntry(
        { action: 'reply', status: 'ok', stdout: 'ok' },
        'I should run the paired action twice to confirm it is stable.',
      ),
      textFinishEntry('Both finished, after thinking it through.'),
    ]))
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

  it('renders a settled successful run with its kernel badge and full stdout, real kernel epoch included', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-run-success'))
    const input = page.locator('textarea').first()
    const settled = scaffold.whenTurnSettled(60_000)
    await input.fill('Run the short successful action now.')
    await input.press('Enter')
    await settled

    const successRow = page.locator('[data-tool="science-run"][data-state="success"]').last()
    await successRow.waitFor({ timeout: 15_000 })
    await expect.poll(async () => successRow.locator('text=/Kernel #\\d+/').count()).toBe(1)
    expect(await successRow.getByText(/Success · \d/u).count()).toBe(1)
    expect(await successRow.getByText('max deviation = 0.0 px\nlongest label: 72 chars').count()).toBe(1)
  }, 90_000)

  it('folds two adjacent run_python calls into one generated Tool group, both nested rows real and settled', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-tool-group'))
    const input = page.locator('textarea').first()
    const settled = scaffold.whenTurnSettled(60_000)
    await input.fill('Run the paired action twice now.')
    await input.press('Enter')
    await settled

    const groupHeader = page.getByRole('button', { name: /Ran 2 code executions/u })
    await groupHeader.waitFor({ timeout: 15_000 })
    expect(await page.getByText('2 steps', { exact: true }).count()).toBeGreaterThanOrEqual(1)
    // The group is collapsed by default; open it to reach the nested member rows.
    await groupHeader.click()
    expect(await page.locator('[data-tool="science-run"][data-state="success"]').count()).toBeGreaterThanOrEqual(2)
  }, 90_000)

  it('renders a mid-run kernel crash as the amber kernel-exited state, naming the exited and next epoch', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-kernel-died'))
    const input = page.locator('textarea').first()
    const settled = scaffold.whenTurnSettled(60_000)
    await input.fill('Run the crashing action now.')
    await input.press('Enter')
    await settled

    const diedRow = page.locator('[data-tool="science-run"][data-state="kernel-died"]')
    await diedRow.waitFor({ timeout: 15_000 })
    expect(await diedRow.getByText('Interrupted · kernel exited', { exact: true }).count()).toBe(1)
    expect(await diedRow.locator('text=/Kernel #\\d+ exited partway/').count()).toBe(1)
    expect(await diedRow.locator('text=/start kernel #\\d+/').count()).toBe(1)

    const session = liveSession
    if (session === undefined) throw new Error('Kernel-died session was not retained after its turn settled')
    const run = replayScience(session.events)?.runs.at(-1)
    expect(run).toMatchObject({ status: 'failed', failureCode: 'KERNEL_DIED' })
  }, 90_000)

  it('folds a Think step ahead of two adjacent run_python calls onto the group, with no independent Think row', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-think-attach'))
    const input = page.locator('textarea').first()
    const settled = scaffold.whenTurnSettled(60_000)
    await input.fill('Think it through, then run the paired action twice.')
    await input.press('Enter')
    await settled

    const groupHeader = page.getByRole('button', { name: /Ran 2 code executions/u }).last()
    await groupHeader.waitFor({ timeout: 15_000 })
    // The group is collapsed by default; the attached Think fold is part of a
    // member row, so it is not mounted until the group opens.
    await groupHeader.click()
    // Exactly one Think disclosure for this turn: the reasoning attached
    // onto the group instead of also rendering as its own standalone row.
    const thinkRows = page.locator('[data-variant="think"]')
    expect(await thinkRows.count()).toBe(1)
    await thinkRows.first().getByText('Think', { exact: true }).click()
    await expect.poll(async () => thinkRows.first().getByText(
      'I should run the paired action twice to confirm it is stable.', { exact: true },
    ).count()).toBe(1)
  }, 90_000)
})
