/** Recorded Science preset execution, durable artifact curation and browser cold replay. */
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-science-session'
import { prepareSciencePrefix } from '../../../packages/science/science-runtime/tests/fixtures/snapshot-prefix.ts'
import {
  assertFixtureInventory, captureStableAria, createScienceScratch, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, openScienceSeed, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './science-scaffold.ts'
import { newEnglishPage } from './support.ts'

const repo = fileURLToPath(new URL('../../..', import.meta.url))
const directory = join(repo, 'snapshots/web/science-preset')
const fixture = join(directory, 'session.v3.jsonl')
const mode = webSnapshotMode()

describe('Science preset recorded session', () => {
  let scaffold: WebScaffold | undefined
  let handle: AgentHandle | undefined
  let scratch: string | undefined
  let prompt: string

  beforeAll(async () => {
    scratch = await createScienceScratch()
    const prefix = await prepareSciencePrefix(scratch)
    const overlay = join(scratch, 'runtime.patch.yml')
    await writeFile(overlay, `- id: science-runtime\n  config:\n    profiles:\n      science:\n        pythonPrefix: ${JSON.stringify(prefix)}\n`)
    scaffold = await launchWebScaffold({ replayFixture: fixture, extraOverlayPath: overlay,
      harnessHome: join(scratch, '.dsh'), compareReplaySession: true })
    const prompts = fixtureUserPrompts(await readFile(fixture, 'utf8'))
    expect(prompts).toHaveLength(1)
    prompt = prompts[0]!
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('science-preset-recording'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'science' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold!.ctx.agentPresets.mount(agentCtx, 'science').then(() => undefined),
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    if (mode === 'record') await recordFixture(scaffold, handle.agent.session.id, fixture)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length) throw new AggregateError(failures, 'Science preset snapshot teardown failed')
  })

  it('binds Science before the request and retains the restricted model tool set', () => {
    const session = handle!.agent.session
    const events = session.snapshotEvents()
    const seq = (type: string): number => {
      const event = events.find(event => event.type === type)
      if (!event) throw new Error(`missing ${type}`)
      return event.seq
    }
    expect(seq('science/mode-bound')).toBeLessThan(seq('science/environment-bound'))
    expect(seq('science/environment-bound')).toBeLessThan(seq('request/header'))
    expect(seq('request/header')).toBeLessThan(seq('tool/call'))
    const tools = session.requestHeader()!.tools!.map(tool => tool.name)
    expect(tools).toEqual(expect.arrayContaining(['get_science_state', 'run_python', 'run_r', 'annotate_artifact', 'install_science_packages']))
    expect(tools).not.toEqual(expect.arrayContaining(['bash']))
    expect(tools).not.toEqual(expect.arrayContaining(['write']))
    const system = session.deriveMessages().filter(message => message.role === 'system')
      .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
    expect(system).toContain('Science agent')
    expect(events.filter(event => event.type === 'science/run-finished').map(event => event.data.run.status)).toEqual(['success'])
  })

  it('reuses one immutable artifact version and agrees with cold projection and stored bytes', async () => {
    const session = handle!.agent.session
    const events = session.snapshotEvents()
    const artifacts = events.filter(event => event.type === 'science/artifact-saved').map(event => event.data.artifact)
    expect(artifacts).toHaveLength(3)
    expect(artifacts.map(artifact => artifact.version)).toEqual([1, 1, 1])
    expect(new Set(artifacts.map(artifact => artifact.versionId)).size).toBe(1)
    expect(artifacts.at(-1)).toMatchObject({ title: 'Main plot', caption: 'Deterministic snapshot chart' })
    const artifact = artifacts[0]!
    const store = scaffold!.ctx.scienceArtifactStore
    const version = await store.getVersion(artifact.projectId, artifact.versionId)
    expect(version).toBeDefined()
    const bytes = await store.readBlob(artifact.projectId, artifact.sha256)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256)
    expect(Buffer.from(bytes)).toEqual(await readFile(new URL('../../../packages/science/science-runtime/tests/fixtures/snapshot-plot.png', import.meta.url)))
    const cold = Session.fromRestore(session.id, [...events], session.header, SessionLogOffset(0), 'detached')
    const liveProjection = scaffold!.ctx.sessionProjections.snapshot(session).values.science!
    const coldProjection = scaffold!.ctx.sessionProjections.snapshot(cold).values.science!
    expect(coldProjection.artifacts).toEqual(liveProjection.artifacts)
    expect(coldProjection.runs).toEqual(liveProjection.runs)
    expect(coldProjection.environment).toEqual(liveProjection.environment)
    expect(coldProjection.metrics).toEqual(liveProjection.metrics)
    // A restored process cannot own the recorded live kernel; its interruption is an explicit cold-state fact.
    expect(liveProjection.kernels.map(kernel => kernel.state)).toEqual(['started'])
    expect(coldProjection.kernels.map(kernel => kernel.state)).toEqual(['interrupted'])
    const history = {
      liveKernelStates: liveProjection.kernels.map(kernel => kernel.state),
      coldKernelStates: coldProjection.kernels.map(kernel => kernel.state),
      metrics: coldProjection.metrics,
      runStatuses: coldProjection.runs.map(run => run.status),
      artifactVersions: artifacts.map(artifact => artifact.version),
    }
    const agreement = { publications: artifacts.length, immutableVersions: new Set(artifacts.map(artifact => artifact.versionId)).size,
      pngSha256: createHash('sha256').update(bytes).digest('hex'), pngBytes: bytes.length,
      lastTitle: artifacts.at(-1)!.title, lastCaption: artifacts.at(-1)!.caption }
    const compare = async (name: string, value: unknown): Promise<void> => {
      const path = fileURLToPath(new URL(`./expected/science-projections/${name}.expected.json`, import.meta.url))
      const json = JSON.stringify(value, null, 2) + '\n'
      if (mode === 'refresh') await writeFile(path, json)
      else if (mode === 'replay') expect(json).toBe(await readFile(path, 'utf8'))
    }
    await compare('cold-history', history)
    await compare('source-agreement', agreement)
  })

  it.skipIf(mode === 'record')('renders the recorded tool turn and reconstructs it after browser reload', async () => {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const console = watchConsole(page)
      await page.goto(scaffold!.authenticatedUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]')
      await openScienceSeed(page, prompt)
      await page.getByText('SCIENCE_SNAPSHOT_DONE', { exact: true }).waitFor()
      await compareOrRefreshGolden(join(directory, 'ui.expected.md'),
        await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd), mode)
      await page.reload({ waitUntil: 'load' })
      await page.getByText('SCIENCE_SNAPSHOT_DONE', { exact: true }).waitFor()
      await page.getByRole('tab', { name: 'Process', exact: true }).click()
      const process = page.getByRole('region', { name: 'Science process view' })
      await process.getByRole('button', { name: /Expand steps/u }).click()
      const steps = process.getByRole('list', { name: 'Turn steps' })
      await steps.getByRole('button', { name: 'Read session state', exact: true }).first().click()
      const state = steps.getByRole('region', { name: 'Read session state', exact: true })
      expect(await state.getByRole('region', { name: 'Input arguments', exact: true }).innerText()).toContain('{}')
      await steps.getByRole('button', { name: 'Python run', exact: true }).click()
      const run = steps.getByRole('region', { name: 'Python run', exact: true })
      expect(await run.getByRole('region', { name: 'Code', exact: true }).innerText()).toContain('print("SCIENCE_SNAPSHOT_RUN_OK")')
      expect(await run.getByRole('region', { name: 'Input arguments', exact: true }).innerText()).toContain('raster_artifacts')
      expect(await run.getByRole('region', { name: 'Standard output', exact: true }).innerText()).toContain('SCIENCE_SNAPSHOT_RUN_OK')
      expect(await process.getByText('Input arguments unavailable in loaded history', { exact: true }).count()).toBe(0)
      expect(await process.getByText('Result unavailable in loaded history', { exact: true }).count()).toBe(0)
      const emptyInput = await captureStableAria(page,
        '[data-call-id][aria-label="Read session state"] [aria-label="Input arguments"]', scaffold!.workspaceCwd)
      const runDetails = await captureStableAria(page, '[data-call-id][aria-label="Python run"]', scaffold!.workspaceCwd)
      await compareOrRefreshGolden(join(directory, 'process.expected.md'),
        `## Empty arguments\n\n${emptyInput}\n\n## Run details\n\n${runDetails}`, mode)
      expect(await page.getByRole('tab', { name: 'Process', exact: true }).getAttribute('aria-selected')).toBe('true')
      expect(console.pageErrors).toEqual([])
      expect(console.warnings).toEqual([])
    } finally {
      await browser.close()
    }
  })

  it.skipIf(mode !== 'replay')('keeps the selected generation and sidecar ownership closed', async () => {
    await assertFixtureInventory(directory, ['session.v3.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json', 'ui.expected.md', 'process.expected.md'])
  })
})
