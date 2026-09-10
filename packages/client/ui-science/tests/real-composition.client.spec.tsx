// @vitest-environment jsdom
/** Science rendered on real Sidebar, Resources, Conversation, Chat and Trajectory plugins. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, within } from '@testing-library/react'
import { SlotTestRuntime, stubSettingsScope, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyChat, inject as injectChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import { apply as applyTrajectory, inject as injectTrajectory } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { apply as applySidebar, inject as injectSidebar } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { apply as applyResources, inject as injectResources } from '@deepseek-ai/dsh-client-resources/client'
import { apply as applyLayout, inject as injectLayout, type MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { apply as applyWorkspace, inject as injectWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { apply as applyLeftSidebar, inject as injectLeftSidebar } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { apply as applyScience, inject as injectScience } from '../src/client/index.ts'
import { baseProjection, libraryArtifact, rawArtifact, SESSION, versionSummary } from './science-details-view-fixtures.client.ts'

usePinnedBrowserLanguages('en-US')
const runtimes: SlotTestRuntime[] = []
let animations: PropertyDescriptor | undefined
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  animations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })
})
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  if (animations === undefined) Reflect.deleteProperty(Element.prototype, 'getAnimations')
  else Object.defineProperty(Element.prototype, 'getAnimations', animations)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function bench(fullLayout = false) {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const ctx = runtime.ctx
  if (!fullLayout) ctx.provide('uiWorkspace', { openSession: (id: typeof SESSION) => { runtime.sessions.open(id) }, openWorkspace: vi.fn() } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  if (!fullLayout) ctx.provide('layout', { openRightbar: vi.fn(), closeRightbar: vi.fn() } as never)
  ctx.provide('connection', {} as never)
  const session = { cancel: vi.fn(), readImage: vi.fn() }
  const science = {
    scienceLibrary: vi.fn().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1', artifacts: [libraryArtifact()], health: { orphan: 0, reconstructed: 0, missingContent: 0 },
    } }),
    scienceVersions: vi.fn().mockResolvedValue({ ok: true, value: { versions: [versionSummary()] } }),
    scienceChartState: vi.fn().mockResolvedValue({ ok: true, value: { chart: null } }),
  }
  const scienceEdits = { submit: vi.fn() }
  ctx.provide('remote', { science, scienceEdits, session, $host: { home: '/home/test' }, $on: () => () => {} } as never)
  ctx.provide('remote.session', session as never)
  ctx.provide('remote.science', science as never)
  ctx.provide('remote.scienceEdits', scienceEdits as never)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  if (!fullLayout) await runtime.declare({
    'rightbar': { kind: 'single', scope: 'root' },
    'main': { kind: 'keyed', scope: 'root' },
    'settings.general.item': { kind: 'list', scope: 'root' },
  })
  await runtime.sessions.add({ id: SESSION })
  runtime.sessions.behavior(SESSION).projections.set('science', baseProjection({ artifacts: [rawArtifact()] }))
  if (fullLayout) {
    runtime.releasePanelInfoSource()
    runtime.releaseWorkspaceSource()
    ctx.provide('theme', { getTheme: () => ({ active: { colorScheme: 'light', tokens: {} }, fontSize: 14 }) } as never)
    ctx.provide('remote.directoryPicker', {} as never)
    await runtime.mount({ inject: [...injectLayout], apply: applyLayout })
    await runtime.mount({ inject: [...injectWorkspace], apply: applyWorkspace })
    await runtime.mount({ inject: [...injectLeftSidebar], apply: applyLeftSidebar })
  }
  await runtime.mount({ inject: [...injectResources], apply: applyResources })
  await runtime.mount({ inject: [...injectSidebar], apply: applySidebar })
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectChat], apply: applyChat })
  await runtime.mount({ inject: [...injectTrajectory], apply: applyTrajectory })
  const scienceHandle = await runtime.mount({ inject: [...injectScience], apply: applyScience })
  const view = fullLayout ? runtime.renderRoot() : runtime.renderSlot('rightbar', { width: 420, viewportWidth: 1440, canShow: true })
  return { runtime, ctx, science, scienceHandle, view: within(view.container) }
}

describe('Science public composition', () => {
  it('returns from a global main panel before opening the footer library', async () => {
    const b = await bench(true)
    b.runtime.slots.register({ name: 'main', key: 'global-test' }, () => <div>Global test panel</div>)
    act(() => { b.ctx.layout.selectPanel('global-test' as MainPanelId) })
    expect(b.view.getByText('Global test panel')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: 'Artifact library' }))
    expect(b.view.queryByText('Global test panel')).toBeNull()
    expect(await b.view.findByRole('button', { name: 'Open Loss curve, version 1' })).toBeTruthy()
  })

  it('keeps the native guide alongside an independently deduplicated library page', async () => {
    const b = await bench()
    b.ctx.sidebarRightTabs.register({ id: 'files-test', kind: 'files', title: () => 'Files', guide: [{ order: 10, title: () => 'Files' }] })
    expect(b.ctx.sidebarRightTabs.guide().map(entry => entry.kind)).toEqual(['science-library', 'files'])
    const titles = b.runtime.slots.entries('sidebar.right.pane.tab.title').map(entry => entry.options.key)
    expect(titles).toEqual(expect.arrayContaining(['@deepseek-ai/dsh-client-ui-sidebar-right/guide', 'science-library']))
    act(() => { b.ctx.sidebarRight.openTab('science-library') })
    const library = b.ctx.sidebarRight.active()
    act(() => { b.ctx.sidebarRight.openTab('science-library') })
    expect(b.ctx.sidebarRight.active()?.id).toBe(library?.id)
    expect(await b.view.findByRole('button', { name: 'Open Loss curve, version 1' })).toBeTruthy()
    act(() => { b.ctx.sidebarRight.openTab('guide') })
    expect(b.ctx.sidebarRight.active()?.kind).toBe('guide')
    expect(await b.view.findByRole('button', { name: 'Files' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: 'Artifact library' }))
    expect(b.ctx.sidebarRight.active()?.kind).toBe('science-library')
  })

  it('opens a library card in a native artifact tab and renders all provenance sections', async () => {
    const b = await bench()
    act(() => { b.ctx.sidebarRight.openTab('science-library') })
    fireEvent.click(await b.view.findByRole('button', { name: 'Open Loss curve, version 1' }))
    expect(b.ctx.sidebarRight.active()?.contentId).toBe('dsh-resource://science-artifact/chart-1')
    expect(await b.view.findByRole('button', { name: 'Provenance' })).toBeTruthy()
    expect(b.science.scienceVersions).toHaveBeenCalledWith(SESSION, ['version:1'])
    fireEvent.click(b.view.getByRole('button', { name: 'Provenance' }))
    expect((await b.view.findAllByRole('tab')).map(tab => tab.textContent))
      .toEqual(expect.arrayContaining(['Code', 'Execution log', 'Messages', 'Environment']))
  })

  it('has sibling Chat, Trajectory and Science conversation views with no nested process view', async () => {
    const b = await bench()
    const entries = b.runtime.slots.entries('conversation.view')
    expect(entries.map(entry => entry.options.id)).toEqual(expect.arrayContaining(['chat', 'trajectory', 'science']))
    const conversation = within(b.runtime.renderSlot('main', {}, { entryKey: 'conversation' }).container)
    expect(await conversation.findByRole('tab', { name: 'Trajectory' })).toBeTruthy()
    expect(conversation.getByRole('tab', { name: 'Process' })).toBeTruthy()
    fireEvent.click(conversation.getByRole('tab', { name: 'Process' }))
    expect(conversation.getByRole('tab', { name: 'Process' }).getAttribute('aria-selected')).toBe('true')
  })

  it('removes Science registrations while leaving native Sidebar and Conversation available', async () => {
    const b = await bench()
    await b.scienceHandle.dispose()
    expect(b.runtime.slots.entries('sidebar.right.pane.tab').some(entry => entry.options.key === 'science-artifact')).toBe(false)
    expect(b.runtime.slots.entries('conversation.view').some(entry => entry.options.id === 'science')).toBe(false)
    expect(b.runtime.slots.entries('conversation.view').some(entry => entry.options.id === 'chat')).toBe(true)
  })
})
