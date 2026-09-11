/** Recorded portable artifact capture and a separately reported capture rejection. */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { prepareSciencePrefix } from '../../../packages/science/science-runtime/tests/fixtures/snapshot-prefix.ts'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, createScienceScratch,
  fixtureUserPrompts, launchWebScaffold, openScienceSeed, recordFixture, webSnapshotMode, type WebScaffold,
} from './science-scaffold.ts'
import { newEnglishPage } from './support.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/science-logical-name', import.meta.url))
const fixture = join(directory, 'session.v3.jsonl')
const mode = webSnapshotMode()

// POSIX permits the ADS-like test file; Windows rejects it before capture.
describe.skipIf(process.platform === 'win32')('Science logical name recorded session', () => {
  let scratch: string | undefined
  let scaffold: WebScaffold | undefined
  let handle: AgentHandle | undefined
  let prompts: string[]

  beforeAll(async () => {
    scratch = await createScienceScratch()
    const prefix = await prepareSciencePrefix(scratch)
    const overlay = join(scratch, 'runtime.patch.yml')
    await writeFile(overlay, `- id: science-runtime\n  config:\n    profiles:\n      science:\n        pythonPrefix: ${JSON.stringify(prefix)}\n`)
    scaffold = await launchWebScaffold({ ...(mode === 'record' ? {} : { replayFixture: fixture }),
      extraOverlayPath: overlay, harnessHome: join(scratch, '.dsh'), compareReplaySession: true })
    if (mode === 'record') {
      prompts = await Promise.all(['logical-name-operation.py', 'logical-name-invalid-operation.py'].map(async (name, index) => {
        const source = await readFile(new URL(`../../../packages/science/science-runtime/tests/fixtures/${name}`, import.meta.url), 'utf8')
        return 'Run exactly this Python source once with run_python. Do not run any additional tools or retry. '
          + 'Report interpreter status and artifact capture status separately. Finish with '
          + (index === 0 ? 'SCIENCE_NAMES_DONE' : 'SCIENCE_CAPTURE_FAILURE_DONE') + '.\n\n```python\n' + source + '```'
      }))
    } else prompts = fixtureUserPrompts(await readFile(fixture, 'utf8'))
    expect(prompts).toHaveLength(2)
    handle = await scaffold.ctx.agents.create({ sessionId: SessionId('science-logical-name-recording'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'science' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold!.ctx.agentPresets.mount(agentCtx, 'science').then(() => undefined) })
    for (const prompt of prompts) {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
    }
    if (mode === 'record') await recordFixture(scaffold, handle.agent.session.id, fixture)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length) throw new AggregateError(failures, 'Science logical name teardown failed')
  })

  it('persists Unicode paths, continues another turn, and rejects the whole invalid batch', async () => {
    const events = handle!.agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(events.filter(event => event.type === 'science/run-finished').map(event => event.data.run.status)).toEqual(['success', 'success'])
    const artifacts = events.filter(event => event.type === 'science/artifact-saved').map(event => event.data.artifact)
    expect(artifacts.map(artifact => artifact.logicalName).sort()).toEqual(['_probe/p.csv', '中文 数据/结果.csv'])
    for (const artifact of artifacts) {
      expect(Buffer.from(await scaffold!.ctx.scienceArtifactStore.readBlob(artifact.projectId, artifact.sha256)).toString('utf8')).toBe('x,y\n1,2\n')
    }
    const results = events.filter(event => event.type === 'tool/result')
    expect(JSON.stringify(results)).toContain('invalid-logical-name')
    expect(JSON.stringify(results)).toContain('interpreter status above is unchanged')
  })

  it.skipIf(mode === 'record')('renders both durable outcomes after a browser reload', async () => {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold!.authenticatedUrl, { waitUntil: 'load' })
      await openScienceSeed(page, prompts[0]!, 'ungrouped')
      await page.getByText('SCIENCE_CAPTURE_FAILURE_DONE', { exact: false }).last().waitFor()
      await page.locator('[data-science-turn-artifacts]').waitFor()
      await compareOrRefreshGolden(join(directory, 'ui.expected.md'),
        await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd), mode)
      await page.reload({ waitUntil: 'load' })
      await page.locator('[data-science-turn-artifacts]').waitFor()
    } finally {
      await browser.close()
    }
  })

  it.skipIf(mode !== 'replay')('owns the recorded generation and header sidecars', async () => {
    await assertFixtureInventory(directory, ['session.v3.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json', 'ui.expected.md'])
  })
})
