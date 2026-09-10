// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSidebarRightStore } from '../src/client/stores.ts'
import { createSidebarRightController } from '../src/client/service.ts'
import { SidebarRightTabRegistry } from '../src/client/tab-registry.ts'

beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear() })

it('restores per-session tabs and pins them immediately after adoption without another write', () => {
  const sessionId = 'restored' as SessionId
  const address = 'dsh-resource://file/session/restored/report.md'
  const seed = () => ({ kind: 'files', title: 'Files' })
  const first = createSidebarRightStore(seed).create(sessionId)
  first.actions.openContent(sessionId, { kind: 'document', contentId: address, title: 'Report' }, () => {})
  const restored = createSidebarRightStore(seed).create(sessionId)
  expect(restored.getSnapshot().bySession[sessionId]).toEqual({
    ...first.getSnapshot().bySession[sessionId], history: { entries: [], cursor: 0 },
  })
  expect(createSidebarRightStore(seed).create('other').getSnapshot().bySession).toEqual({})
  const pins: Array<{ address: string; signal: AbortSignal }> = []
  const { controller, adopt } = createSidebarRightController(
    new SidebarRightTabRegistry(new Context()),
    (held, signal) => { pins.push({ address: held, signal }) },
  )
  const release = adopt(sessionId, restored)
  expect(pins.map(pin => pin.address)).toEqual([address])
  release()
  const releaseAgain = adopt(sessionId, restored)
  expect(pins).toHaveLength(1)
  releaseAgain()
  controller.tabDomain.dispose()
  expect(pins[0]!.signal.aborted).toBe(true)
})

it('discards P4 tab preferences and seeds the registered default on expansion', () => {
  localStorage.setItem('dsh.sidebar.right.v1.old', JSON.stringify({ bySession: { old: { invalid: true } } }))
  const restored = createSidebarRightStore(() => ({ kind: 'files', title: 'Files' })).create('old')
  expect(restored.getSnapshot().bySession).toEqual({})
  restored.actions.setExpanded('old', true)
  expect(Object.values(restored.getSnapshot().bySession.old!.layout.tabs).map(tab => tab.kind)).toEqual(['files'])
})

// These mutation fixtures deliberately violate arbitrary nested JSON fields.
interface MalformedSurface {
  minted: unknown
  layout: {
    rootId: unknown
    activePaneId: unknown
    mode: unknown
    nodes: Record<string, Record<string, unknown>>
    tabs: Record<string, unknown>
  }
}

for (const [label, corrupt] of Object.entries({
  'invalid mode': (s: MalformedSurface) => { s.layout.mode = 'invalid' },
  'invalid split axis': (s: MalformedSurface) => {
    s.layout.nodes.split3 = { id: 'split3', kind: 'split', axis: 'invalid', children: ['pane1', 'pane2'], sizes: [0.5, 0.5] }
    s.layout.rootId = 'split3'; s.minted = 3
  },
  'missing root': (s: MalformedSurface) => { s.layout.rootId = 'pane999' },
  'cycle': (s: MalformedSurface) => {
    s.layout.nodes.split3 = { id: 'split3', kind: 'split', axis: 'row', children: ['split3', 'pane1'], sizes: [0.5, 0.5] }
    s.layout.rootId = 'split3'; s.minted = 3
  },
  'missing tab': (s: MalformedSurface) => { s.layout.nodes.pane1!.tabs = ['tab2']; s.layout.nodes.pane1!.activeTabId = 'tab2' },
  'invalid active pane': (s: MalformedSurface) => { s.layout.activePaneId = 'pane999' },
  'reused identity counter': (s: MalformedSurface) => { s.minted = 0 },
  'orphan tab': (s: MalformedSurface) => { s.layout.tabs.tab2 = { id: 'tab2', kind: 'files', contentId: 'files', title: 'Files' } },
})) {
  it(`rejects ${label} and remains usable`, () => {
    const first = createSidebarRightStore(() => ({ kind: 'files', title: 'Files' })).create('invalid')
    first.actions.open('invalid')
    // Deliberately malformed JSON fixtures cannot retain the production layout type.
    const saved = JSON.parse(localStorage.getItem('dsh.sidebar.right.v2.invalid')!) as { bySession: Record<string, MalformedSurface> }
    corrupt(saved.bySession.invalid!)
    localStorage.setItem('dsh.sidebar.right.v2.invalid', JSON.stringify(saved))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const restored = createSidebarRightStore(() => ({ kind: 'files', title: 'Files' })).create('invalid')
      expect(restored.getSnapshot().bySession).toEqual({})
      expect(error).toHaveBeenCalledOnce()
      restored.actions.setExpanded('invalid', true)
      expect(Object.values(restored.getSnapshot().bySession.invalid!.layout.tabs).map(tab => tab.kind)).toEqual(['files'])
    } finally { error.mockRestore() }
  })
}

it('restores split and floating layouts and mints new identities after reload', () => {
  const seed = () => ({ kind: 'files', title: 'Files' })
  const first = createSidebarRightStore(seed).create('complex')
  first.actions.openContent('complex', { kind: 'document', contentId: 'report', title: 'Report' }, () => {})
  first.actions.splitPane('complex')
  let figure: TabId | undefined
  first.actions.openContent('complex', { kind: 'document', contentId: 'figure', title: 'Figure' }, (id) => { figure = id })
  if (figure === undefined) throw new Error('Figure tab missing')
  first.actions.floatTab('complex', figure, { x: 10, y: 20, width: 300, height: 200 })
  const before = first.getSnapshot().bySession.complex!
  const restored = createSidebarRightStore(seed).create('complex')
  expect(restored.getSnapshot().bySession.complex!.layout).toEqual(before.layout)
  expect(restored.getSnapshot().bySession.complex!.history).toEqual({ entries: [], cursor: 0 })
  restored.actions.openContent('complex', { kind: 'document', contentId: 'new', title: 'New' }, () => {})
  expect(restored.getSnapshot().bySession.complex!.minted).toBeGreaterThan(before.minted)
})

it.each([null, [], 'invalid'])('rejects non-object preferences %j without disabling the sidebar', (saved) => {
  localStorage.setItem('dsh.sidebar.right.v2.invalid-root', JSON.stringify(saved))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const restored = createSidebarRightStore(() => ({ kind: 'files', title: 'Files' })).create('invalid-root')
    expect(restored.getSnapshot().bySession).toEqual({})
    expect(error).toHaveBeenCalledOnce()
  } finally { error.mockRestore() }
})
