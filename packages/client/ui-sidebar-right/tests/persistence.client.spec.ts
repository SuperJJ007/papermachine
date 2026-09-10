// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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
  expect(restored.getSnapshot()).toEqual(first.getSnapshot())
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
