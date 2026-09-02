/** Cold restore keeps complete Science trajectory ownership beyond the first history page. */
import { Buffer } from 'node:buffer'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ArtifactRecord, ProjectId, VersionRecord } from '@deepseek-ai/dsh-science-artifact-store'
import {
  foldScience, ScienceEnvironmentProfileId, ScienceRunId, ScienceScratchKey,
} from '@deepseek-ai/dsh-science-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  launchWebScaffold, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED_ID = 'science-cold-restore-web-e2e'
const FINGERPRINT = 'e'.repeat(64)
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
const CALLS_BY_TURN = [4, 1, 1, 2, 1, 1, 4, 6, 5, 2, 1, 1] as const
const RUNS_BY_TURN = [3, 1, 1, 2, 1, 1, 3, 3, 2, 1, 0, 1] as const
type Stored = { readonly artifact: ArtifactRecord; readonly version: VersionRecord }

function coldRestoreFixture(projectId: ProjectId, stored: readonly Stored[]): string {
  const session = Session.create(SessionId(SEED_ID))
  const origin = Date.now() - 300_000
  const eventTime = (seq: number): number => origin + seq * 100
  let runOrdinal = 0
  let artifactOrdinal = 0
  const artifactRuns = new Set([1, 10, 15, 19])

  for (let turn = 1; turn <= 12; turn++) {
    session.append('turn/start', { turn })
    if (turn === 1) {
      session.append('science/mode-bound', { version: 1, mode: {
        modeId: 'science', presetId: 'science', modeRevision: 'cold-restore-browser',
      } })
      session.append('science/environment-bound', { version: 1, environment: {
        revision: 1, profileId: ScienceEnvironmentProfileId('science'), configuredAt: eventTime(1),
        validatedAt: eventTime(2), status: 'applied', python: {
          language: 'python', configuredPrefix: '/redacted/science', canonicalPrefix: '/redacted/science',
          executable: '/redacted/science/bin/python', executableIdentity: 'dev:1-ino:2', languageVersion: '3.12.0',
          condaHistorySha256: 'a'.repeat(64), bindingFingerprint: FINGERPRINT, packages: [],
          packagesSha256: 'f'.repeat(64), packagesTruncated: false, capability: 'available',
        },
      } })
      session.append('science/kernel-state', { version: 1, kernel: {
        kernelEpoch: 1, language: 'python', environmentRevision: 1,
        environmentFingerprint: FINGERPRINT, state: 'started', at: eventTime(3),
      } })
    }
    const user = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `Redacted request ${String(turn)}.` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    if (turn === 1) session.append('session/title', {
      title: 'Science cold restore', messageSeqs: [user.seq], source: { kind: 'fallback' },
    })

    const callCount = CALLS_BY_TURN[turn - 1]!
    const runCount = RUNS_BY_TURN[turn - 1]!
    for (let step = 1; step <= callCount; step++) {
      const isRun = turn === 1 ? step > 1 : step <= runCount
      const name = isRun ? 'run_python' : turn === 1 ? 'glob' : 'read'
      const callId = CallId(`cold-restore-call-${String(turn)}-${String(step)}`)
      const args = isRun ? { code: `value_${String(turn)}_${String(step)} = ${String(turn + step)}` }
        : name === 'glob' ? { pattern: '*.csv' } : { file_path: `inputs/file-${String(turn)}-${String(step)}.csv` }
      session.append('step/start', { turn, step })
      let requestSeq = 0
      if (isRun) requestSeq = session.append('request/header', {
        header: { config: { provider: 'fixture', model: 'fixture' } }, reason: 'initial',
      }).seq
      session.append('assistant/message', { turn, step, message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
        source: { provider: 'fixture', model: 'fixture' },
      }) }, { surfaceOp: 'append' })
      const call = session.append('tool/call', { turn, step, callId, name, arguments: JSON.stringify(args) })
      if (isRun) {
        runOrdinal++
        const runId = ScienceRunId(`cold-restore-run-${String(runOrdinal)}`)
        const run = {
          runId, language: 'python' as const, toolCallId: callId, requestHeaderSeq: requestSeq,
          environmentRevision: 1, environmentFingerprint: FINGERPRINT, startedAt: eventTime(call.seq + 1),
          codeSha256: String(runOrdinal).padStart(64, '0'), scratchKey: ScienceScratchKey(String(runOrdinal).padStart(64, '1')),
          runDirectoryRef: `runs/${runId}/`, kernelEpoch: 1,
        }
        session.append('science/run-started', { version: 1, run: { ...run, status: 'running' } })
        session.append('science/run-finished', { version: 1, run: {
          ...run, status: 'success', finishedAt: eventTime(call.seq + 2), stdoutBytes: 0, stderrBytes: 0,
          stdoutTruncated: false, stderrTruncated: false,
        } })
        if (artifactRuns.has(runOrdinal)) {
          const selected = stored[artifactOrdinal++]!
          session.append('science/artifact-saved', { version: 1, artifact: {
            artifactId: selected.artifact.artifactId, logicalName: selected.artifact.logicalName, version: 1,
            title: `Result ${String(artifactOrdinal)}`, projectId, versionId: selected.version.versionId,
            sha256: selected.version.sha256, seenAt: eventTime(call.seq + 3),
          } })
        }
      }
      session.append('tool/result', { turn, step, message: createToolResultMessage({
        callId, content: [{ type: 'text', text: isRun ? 'status: success' : 'redacted result' }], isError: false,
      }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
      session.append('step/end', { turn, step })
    }

    if (turn === 4) {
      for (let index = 1; index <= 21; index++) {
        const step = callCount + index
        session.append('step/start', { turn, step })
        session.append('assistant/message', { turn, step, message: createAssistantMessage({
          content: [{ type: 'text', text: `Redacted analysis ${String(index)}.` }],
          source: { provider: 'fixture', model: 'fixture' },
        }) }, { surfaceOp: 'append' })
        session.append('step/end', { turn, step })
      }
    }
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }

  const events = session.events.map(event => ({ ...event, time: eventTime(event.seq) }))
  foldScience(events)
  return [JSON.stringify({
    type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: origin,
    cwd: '{{cwd}}', agentPreset: 'science',
  }), ...events.map(event => JSON.stringify(event)), ''].join('\n')
}

describe('cold Science trajectory fixture', () => {
  it('contains the redacted incident cardinalities and passes strict replay', () => {
    const stored = Array.from({ length: 4 }, (_, index) => ({
      artifact: { artifactId: `artifact-${String(index + 1)}`, logicalName: `result-${String(index + 1)}.png` },
      version: { versionId: `version-${String(index + 1)}`, sha256: String(index + 1).repeat(64) },
    })) as unknown as Stored[]
    const lines = coldRestoreFixture('project' as ProjectId, stored).trim().split('\n').slice(1)
    const events = lines.map(line => JSON.parse(line) as {
      readonly seq: number
      readonly type: string
      readonly surfaceOp?: string
      readonly data: { readonly turn?: number }
    })
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(12)
    expect(events.filter(event => event.type === 'tool/call')).toHaveLength(29)
    expect(events.filter(event => event.type === 'science/run-started')).toHaveLength(19)
    expect(events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(4)
    const appendedMessages = events.filter(event => event.surfaceOp === 'append'
      && (event.type === 'user/message' || event.type === 'assistant/message'))
    const cutoff = appendedMessages.at(-50)?.seq
    if (cutoff === undefined) throw new Error('fixture did not produce one complete cold history page')
    const coldTail = events.filter(event => event.seq >= cutoff)
    expect(coldTail.filter(event => event.type === 'tool/call')).toHaveLength(21)
    expect(coldTail.filter(event => event.type === 'science/run-started')).toHaveLength(12)
    expect(coldTail.find(event => event.type === 'assistant/message')?.data.turn).toBe(4)
  })
})

describe('web e2e: cold Science trajectory restore', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const { projectId } = await scaffold.ctx.scienceArtifactStore.openProject(scaffold.workspaceCwd)
    const stored: Stored[] = []
    for (let index = 1; index <= 4; index++) {
      stored.push(await scaffold.ctx.scienceArtifactStore.createArtifact(projectId, {
        logicalName: `result-${String(index)}.png`, kind: 'figure', data: PNG, mediaType: 'image/png',
        contentOrigin: 'run-auto', originSessionId: SessionId(SEED_ID),
      }))
    }
    await seedSession(scaffold, coldRestoreFixture(projectId, stored), SEED_ID, 'science')
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 1280)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('treeitem').first().click()
    await page.locator('[role="treeitem"][aria-selected]').first().click()
    await page.getByText('Redacted request 12.', { exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
  }, 120_000)

  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('restores every turn, call, run, and artifact before earlier messages load', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-science-cold-restore'))
    const process = page.getByRole('region', { name: 'Science process view' })
    await expect.poll(() => process.innerText()).toContain('Turns 12 · Steps 29 · Runs 19 · Artifacts 4')
    expect(await process.getByRole('region', { name: 'Unassigned history' }).count()).toBe(0)
    const firstTurn = process.locator('article[data-anchor="turn:1"]')
    expect(await firstTurn.innerText()).toContain('Request unavailable for this turn')
    expect(await firstTurn.innerText()).toContain('Runs 3')
    expect(await process.locator('article[data-anchor="turn:4"]').innerText()).toContain('Runs 2')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
