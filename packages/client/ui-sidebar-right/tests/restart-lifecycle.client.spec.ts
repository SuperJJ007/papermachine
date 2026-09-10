// @vitest-environment jsdom
/** Persisted tabs survive provider and sidebar lifetimes independently of their registrations. */
import { afterEach, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSidebarRightStore } from '../src/client/stores.ts'
import { createSidebarRightController } from '../src/client/service.ts'
import { SidebarRightTabRegistry } from '../src/client/tab-registry.ts'

const session = 'restart-session' as SessionId
const seed = () => ({ kind: 'guide', title: 'Start' })
const key = `dsh.sidebar.right.v2.${session}`
afterEach(() => { localStorage.clear() })

it('preserves a split through kind withdrawal, resource release and restoration before kind registration', () => {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const definition = { id: 'test/library', kind: 'science-library', title: () => 'Library' }
  const unregister = tabs.register(definition)
  const first = createSidebarRightStore(seed).create(session)
  const pins: AbortSignal[] = []
  const { controller, adopt } = createSidebarRightController(tabs, (_address, signal) => { pins.push(signal) })
  const release = adopt(session, first)
  first.actions.openContent(session, { kind: definition.kind, contentId: 'sidebar://science-library', title: 'Library' }, () => {})
  first.actions.splitPane(session, undefined)
  const layout = first.getSnapshot().bySession[session]!.layout
  const saved = localStorage.getItem(key)
  expect(Object.keys(layout.tabs)).toHaveLength(2)
  unregister()
  expect(tabs.get(definition.kind)).toBeUndefined()
  expect(localStorage.getItem(key)).toBe(saved)
  release()
  controller.tabDomain.dispose()
  expect(pins.every(signal => signal.aborted)).toBe(true)
  expect(localStorage.getItem(key)).toBe(saved)

  const next = new Context()
  let unregisterNext = () => {}
  try {
    const restored = createSidebarRightStore(seed).create(session)
    const nextTabs = new SidebarRightTabRegistry(next)
    const pin = vi.fn()
    const nextController = createSidebarRightController(nextTabs, pin)
    const stop = nextController.adopt(session, restored)
    expect(restored.getSnapshot().bySession[session]!.layout).toEqual(layout)
    expect(pin).toHaveBeenCalledTimes(2)
    unregisterNext = nextTabs.register(definition)
    expect(localStorage.getItem(key)).toBe(saved)
    const library = Object.values(layout.tabs).find(tab => tab.kind === definition.kind)!
    nextController.controller.closeIn(session, library.id)
    expect(restored.getSnapshot().bySession[session]!.layout.tabs[library.id]).toBeUndefined()
    stop()
    nextController.controller.tabDomain.dispose()
  } finally {
    unregisterNext()
  }
})

it('keeps the restored split during the first production renderer commit before its library plugin mounts', async () => {
  const first = createSidebarRightStore(seed).create(session)
  first.actions.openContent(session, { kind: 'science-library', contentId: 'sidebar://science-library', title: 'Library' }, () => {})
  first.actions.splitPane(session, undefined)
  const saved = localStorage.getItem(key)
  const runtime = await SlotTestRuntime.create()
  const animations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })
  try {
    runtime.ctx.provide('layout', { openRightbar: vi.fn(), closeRightbar: vi.fn() } as never)
    runtime.ctx.provide('resources', { pin: vi.fn() } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.declare({
      'rightbar': { kind: 'single', scope: 'root' },
      'conversation.session.header.corner': { kind: 'single', scope: 'session' },
    })
    await runtime.sessions.add({ id: session })
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderSlot('rightbar', { width: 576, viewportWidth: 1440, canShow: true })
    expect(view.container.querySelectorAll('[data-dockkit-tab]')).toHaveLength(2)
    expect(localStorage.getItem(key)).toBe(saved)
  } finally {
    await runtime.dispose()
    if (animations === undefined) Reflect.deleteProperty(Element.prototype, 'getAnimations')
    else Object.defineProperty(Element.prototype, 'getAnimations', animations)
  }
})
