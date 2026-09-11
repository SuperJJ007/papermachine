/** Real Science and filesystem tools producing mixed outcomes in one recorded turn. */
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { captureExpectedWorkspaceSnapshot, captureWorkspaceSnapshot, parseSnapshotManifest } from '@deepseek-ai/dsh-session-snapshot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-science-session'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { prepareSciencePrefix } from '../../../packages/science/science-runtime/tests/fixtures/snapshot-prefix.ts'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, createScienceScratch,
  fixtureUserPrompts, launchWebScaffold, openScienceSeed, recordFixture, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './science-scaffold.ts'
import { newEnglishPage } from './support.ts'
import { readPersistedEvents } from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/science-mixed', import.meta.url))
const fixture = join(directory, 'session.v3.jsonl')
const mode = webSnapshotMode()

describe('Science mixed recorded outcomes', () => {
  let scratch: string | undefined
  let scaffold: WebScaffold | undefined
  let handle: AgentHandle | undefined
  let prompt: string

  beforeAll(async () => {
    const manifestPath = join(directory, 'snapshot.yml')
    const manifest = parseSnapshotManifest(await readFile(manifestPath, 'utf8'), manifestPath)
    expect(manifest.composition).toBe('web-science-mixed')
    expect(manifest.workspace).toEqual({ setup: 'workspace-seed', final: true })
    scratch = await createScienceScratch()
    const prefix = await prepareSciencePrefix(scratch)
    const presetRoot = join(scratch, '.dsh', 'test-presets')
    const preset = join(presetRoot, 'science')
    await mkdir(preset, { recursive: true })
    await writeFile(join(preset, 'preset.yml'), 'name: Mixed outcome recording\ndescription: Test-only Science and file delivery composition.\n')
    await writeFile(join(preset, 'agent.cordis.yml'), `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}. Use relative workspace paths with file tools.
    prefix: You are a test analysis assistant. Run analyses with Science tools and create workspace reports with the file tools. Present requested workspace reports explicitly.
- id: tool-science
  name: '@deepseek-ai/dsh-tool-science'
  config:
    profileId: science
    modeRevision: science-v1
    stateHistoryLimit: 8
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
- id: tool-present
  name: '@deepseek-ai/dsh-tool-present'
`)
    const overlay = join(scratch, 'runtime.patch.yml')
    // Native file actions are part of this golden; their OS execution has separate Host tests.
    const nativeOpen = await readFile(new URL('./produced-files.overlay.yml', import.meta.url), 'utf8')
    await writeFile(overlay, `${nativeOpen}\n- id: science-runtime\n  config:\n    profiles:\n      science:\n        pythonPrefix: ${JSON.stringify(prefix)}\n- id: science-agent-presets\n  config:\n    default: science\n    includeUserRoot: false\n    roots:\n      - path: ${JSON.stringify(presetRoot)}\n        trust: system\n`)
    scaffold = await launchWebScaffold({ ...(mode === 'record' ? {} : { replayFixture: fixture }), extraOverlayPath: overlay,
      harnessHome: join(scratch, '.dsh'), compareReplaySession: true,
      replayProviders: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash', contextWindow: 128_000, reasoningEfforts: ['high'], defaultReasoningEffort: 'high' }] }] })
    await cp(join(directory, manifest.workspace!.setup!), scaffold.workspaceCwd, { recursive: true })
    if (mode === 'record') {
      const source = await readFile(new URL('../../../packages/science/science-runtime/tests/fixtures/snapshot-operation.py', import.meta.url), 'utf8')
      prompt = 'Run exactly the following Python source once with run_python, declaring plot.png as a raster artifact. '
        + 'Then annotate the captured chart with title "Mixed outcome chart" and caption "Quadratic sample". '
        + 'Use write to create report.txt with exactly "SCIENCE_MIXED_REPORT\\nThe chart plots y = x squared at x = 0, 1, 2.\\n" '
        + '(interpret the escaped newlines as actual newlines), and call present for report.txt with description "Analysis report". '
        + 'Use the relative path report.txt in write and present. Do not run any additional Python code or probe the workspace. Do not create any other workspace files. Complete these actions in this turn. Finish with SCIENCE_MIXED_DONE.\n\n```python\n'
        + source + '```'
    } else {
      const prompts = fixtureUserPrompts(await readFile(fixture, 'utf8'))
      expect(prompts).toHaveLength(1)
      prompt = prompts[0]!
    }
    handle = await scaffold.ctx.agents.create({ sessionId: SessionId('science-mixed-recording'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'science' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: ReasoningEffortId('high') },
      setup: agentCtx => scaffold!.ctx.agentPresets.mount(agentCtx, 'science').then(() => undefined) })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    if (mode === 'record') await recordFixture(scaffold, handle.agent.session.id, fixture)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length) throw new AggregateError(failures, 'Science mixed snapshot teardown failed')
  })

  it('persists a chart, a workspace write, and explicit delivery in one turn', async () => {
    const events = handle!.agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(events.filter(event => event.type === 'science/run-finished').map(event => event.data.run.status)).toEqual(['success'])
    const artifacts = events.filter(event => event.type === 'science/artifact-saved').map(event => event.data.artifact)
    expect(artifacts.at(-1)).toMatchObject({ title: 'Mixed outcome chart', caption: 'Quadratic sample' })
    expect(new Set(artifacts.map(artifact => artifact.versionId)).size).toBe(1)
    const artifact = artifacts[0]!
    const bytes = await scaffold!.ctx.scienceArtifactStore.readBlob(artifact.projectId, artifact.sha256)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256)
    expect(Buffer.from(bytes)).toEqual(await readFile(new URL('../../../packages/science/science-runtime/tests/fixtures/snapshot-plot.png', import.meta.url)))
    expect(events.filter(event => event.type === 'deliverables/presented').flatMap(event => event.data.files))
      .toEqual([{ path: 'report.txt', description: 'Analysis report' }])
    expect(handle!.agent.session.deriveMessages().some(message => message.role === 'assistant'
      && message.content.some(block => block.type === 'reasoning'))).toBe(true)
    // The scaffold stores its projection cache beside the workspace; it is not a model output.
    expect(await captureWorkspaceSnapshot(scaffold!.workspaceCwd, { ignoredRootEntries: ['.dsh-storages'] }))
      .toEqual(await captureExpectedWorkspaceSnapshot(join(directory, 'workspace.expected')))
  })

  it.skipIf(mode !== 'replay')('owns its fixture, header sidecars, and workspace oracle', async () => {
    await assertFixtureInventory(directory, ['session.v3.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json',
      'ui.expected.md', 'workspace-seed', 'workspace.expected'])
  })

  it.skipIf(mode === 'record')('renders mixed outcomes and preserves them after reload', async () => {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const console = watchConsole(page)
      await page.goto(scaffold!.authenticatedUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]')
      await openScienceSeed(page, prompt)
      await page.getByText('SCIENCE_MIXED_DONE', { exact: true }).waitFor()
      const tail = page.locator('[data-turn-tail]').filter({ has: page.locator('[data-science-turn-artifacts]') })
      const assertMixedTail = async (): Promise<void> => {
        await expect.poll(() => page.getByText('SCIENCE_MIXED_DONE', { exact: true }).isVisible()).toBe(true)
        expect(await tail.count()).toBe(1)
        await expect.poll(() => tail.locator('[data-science-turn-artifacts]').isVisible()).toBe(true)
        await expect.poll(() => tail.locator('[data-presented-files-row]').isVisible()).toBe(true)
        await expect.poll(() => tail.locator('[data-produced-files-row]').isVisible()).toBe(true)
        expect(await tail.locator('[data-science-turn-artifacts]').innerText()).toContain('Mixed outcome chart')
        expect(await tail.locator('[data-science-turn-artifacts]').getByRole('button', { name: 'Preview Mixed outcome chart version 1', exact: true }).isVisible()).toBe(true)
        expect(await tail.locator('[data-presented-files-row]').getByRole('button', { name: 'Open report.txt in sidebar', exact: true }).isVisible()).toBe(true)
        expect(await tail.locator('[data-produced-files-row]').getByRole('button', { name: 'Open report.txt', exact: true }).isVisible()).toBe(true)
      }
      await assertMixedTail()
      const evidence = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
      await mkdir(evidence, { recursive: true })
      await page.screenshot({ path: join(evidence, 'science-mixed-live.png'), fullPage: true })
      await compareOrRefreshGolden(join(directory, 'ui.expected.md'),
        await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd), mode)
      await page.reload({ waitUntil: 'load' })
      await page.getByText('SCIENCE_MIXED_DONE', { exact: true }).waitFor()
      await assertMixedTail()
      await page.screenshot({ path: join(evidence, 'science-mixed-reloaded.png'), fullPage: true })
      const keyboardTargets = [
        tail.locator('[data-science-turn-artifacts]').getByRole('button', { name: 'Preview Mixed outcome chart version 1', exact: true }),
        tail.locator('[data-presented-files-row]').getByRole('button', { name: 'Open report.txt in sidebar', exact: true }),
      ]
      for (const action of keyboardTargets) {
        await action.focus()
        await page.keyboard.press('Shift+Tab')
        expect(await page.locator(':focus').evaluate(element => element.matches(':focus-visible'))).toBe(true)
        expect(await page.locator(':focus').evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
        await page.keyboard.press('Tab')
        expect(await action.evaluate(element => element === document.activeElement)).toBe(true)
      }
      await page.screenshot({ path: join(evidence, 'science-mixed-keyboard.png'), fullPage: true })
      const logBytes = async (): Promise<readonly [string, string][]> => {
        const paths = (await readdir(scaffold!.persistenceRoot, { recursive: true }))
          .filter(path => path.endsWith('.jsonl') || path.endsWith('.jsonl.zstd')).sort()
        expect(paths.length).toBeGreaterThan(0)
        return Promise.all(paths.map(async path => [path, (await readFile(join(scaffold!.persistenceRoot, path))).toString('base64')] as [string, string]))
      }
      const logsBefore = await logBytes()
      const persistedBefore = JSON.stringify(await readPersistedEvents(scaffold!, handle!.agent.session.id))
      const fixtureBefore = await readFile(fixture)
      const process = page.locator('[data-turn-process]')
      expect(await process.count()).toBe(1)
      expect(await process.getAttribute('aria-expanded')).toBe('false')
      expect(await page.locator('[data-turn-process-member][data-turn-process-hidden="true"]').count()).toBeGreaterThan(0)
      await process.click()
      await expect.poll(() => process.getAttribute('aria-expanded')).toBe('true')
      expect(await page.locator('[data-turn-process-member][data-turn-process-hidden="true"]').count()).toBe(0)
      await assertMixedTail()
      await page.screenshot({ path: join(evidence, 'science-process-expanded.png'), fullPage: true })
      await process.click()
      await assertMixedTail()
      await page.setViewportSize({ width: 1680, height: 1400 })
      await tail.scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(evidence, 'science-process-collapsed.png'), fullPage: true })
      const setTranscript = async (from: string, to: string): Promise<void> => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: from, exact: true }).click()
        await page.getByRole('menuitem', { name: to, exact: true }).click()
        await page.keyboard.press('Escape')
      }
      await setTranscript('Compact', 'Normal')
      await expect.poll(() => process.count()).toBe(0)
      expect(await page.locator('[data-turn-process-member][data-turn-process-hidden="true"]').count()).toBe(0)
      await assertMixedTail()
      await page.reload({ waitUntil: 'load' })
      await page.getByText('SCIENCE_MIXED_DONE', { exact: true }).waitFor()
      expect(await process.count()).toBe(0)
      await assertMixedTail()
      await page.screenshot({ path: join(evidence, 'science-process-normal-restored.png'), fullPage: true })
      await setTranscript('Normal', 'Compact')
      await expect.poll(() => process.getAttribute('aria-expanded')).toBe('false')
      await assertMixedTail()
      expect(JSON.stringify(await readPersistedEvents(scaffold!, handle!.agent.session.id))).toBe(persistedBefore)
      expect(await readFile(fixture)).toEqual(fixtureBefore)
      expect(await logBytes()).toEqual(logsBefore)
      await tail.locator('[data-science-turn-artifacts]').getByRole('button', { name: 'Preview Mixed outcome chart version 1', exact: true }).click()
      const panel = page.locator('[data-rightbar-col]')
      const artifactImage = panel.getByRole('img', { name: 'Mixed outcome chart', exact: true })
      await expect.poll(() => artifactImage.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      const src = await artifactImage.getAttribute('src')
      if (src === null) throw new Error('authorized image URL is absent')
      expect(src).toContain('/api/science-artifact?')
      expect(src).not.toMatch(/^(blob:|data:)/)
      const url = new URL(src, scaffold!.baseUrl).href
      const original = await page.request.get(url)
      expect(original.status()).toBe(200)
      const originalBytes = await original.body()
      for (const failure of ['network', 'decode'] as const) {
        let intercepted = false
        await page.route(url, async (route) => {
          intercepted = true
          if (failure === 'network') await route.abort('failed')
          else {
            const response = await route.fetch()
            expect(response.status()).toBe(200)
            await route.fulfill({ response, body: Buffer.from('invalid PNG bytes'), contentType: 'image/png' })
          }
        })
        await page.reload({ waitUntil: 'load' })
        const retry = panel.getByRole('button', { name: 'Failed to load, click to retry', exact: true })
        await retry.waitFor()
        expect(intercepted).toBe(true)
        await page.screenshot({ path: join(evidence, `science-preview-${failure}-failed.png`), fullPage: true })
        await page.unroute(url)
        await retry.click()
        await expect.poll(() => artifactImage.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
        expect(await artifactImage.getAttribute('src')).toBe(src)
      }
      await page.reload({ waitUntil: 'load' })
      await expect.poll(() => artifactImage.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await page.screenshot({ path: join(evidence, 'science-preview-recovered.png'), fullPage: true })
      const downloadEvent = page.waitForEvent('download')
      await panel.getByRole('button', { name: 'Download', exact: true }).click()
      const downloaded = await downloadEvent
      const downloadPath = await downloaded.path()
      if (downloadPath === null) throw new Error('download file is unavailable')
      expect(await readFile(downloadPath)).toEqual(originalBytes)
      await page.getByRole('button', { name: 'Collapse right sidebar', exact: true }).click()

      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dark = page.getByRole('dialog').getByRole('button', { name: 'Dark', exact: true })
      await dark.click()
      await expect.poll(() => dark.getAttribute('aria-pressed')).toBe('true')
      await page.keyboard.press('Escape')
      await assertMixedTail()
      expect(await tail.evaluate(element => getComputedStyle(element).colorScheme)).toBe('dark')
      await page.screenshot({ path: join(evidence, 'science-mixed-dark.png'), fullPage: true })
      await page.setViewportSize({ width: 480, height: 900 })
      await assertMixedTail()
      for (const action of keyboardTargets) {
        await action.scrollIntoViewIfNeeded()
        const bounds = await action.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(480)
      }
      await page.screenshot({ path: join(evidence, 'science-mixed-narrow-dark.png'), fullPage: true })
      expect(console.pageErrors).toEqual([])
      expect(console.warnings).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
