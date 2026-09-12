import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
const windows: JSDOM[] = []
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close() })
function renderer(locale = 'en') {
  const dom = new JSDOM(readFileSync(new URL('../renderer/onboarding.html', import.meta.url), 'utf8'))
  windows.push(dom)
  const { window } = dom
  let publish: ((message: string) => void) | undefined
  const bridge = {
    state: async () => ({
      locale: resolveDesktopLocale(locale), home: '/tmp/product-home', version: '0.1.2',
      status: { kind: 'unbound' }, defaultSource: 'official',
      declaration: { packages: ['python', 'r-base'], estimatedDownloadBytes: 850000000, sources: [{ id: 'official', name: '<unsafe-name>' }] },
    }),
    install: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    continue: vi.fn(), chooseHome: vi.fn(), resetHome: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined),
    progress: (listener: (message: string) => void) => { publish = listener },
  }
  const context = createContext({ window: { paperMachineSetup: bridge }, document: window.document })
  new Script(readFileSync(new URL('../renderer/onboarding.js', import.meta.url), 'utf8')).runInContext(context)
  return { window, bridge, progress: (value: string) => publish?.(value) }
}
describe('onboarding renderer', () => {
  it('shows localized setup and safely renders package source names', async () => {
    const { window } = renderer('zh-CN')
    await vi.waitFor(() => { expect(window.document.querySelector('#install')?.textContent).toBe('安装环境') })
    expect(window.document.querySelector('#summary')?.textContent).toBe('2 个软件包 · 下载 850 MB')
    expect(window.document.querySelector('option')?.textContent).toBe('<unsafe-name>')
    expect(window.document.querySelector('unsafe-name')).toBeNull()
    expect(window.document.querySelector('#version')?.textContent).toBe('0.1.2')
  })
  it('blocks overlapping controls, presents progress, and restores retry after failure', async () => {
    const { window, bridge, progress } = renderer()
    await vi.waitFor(() => { expect(window.document.querySelector('#install')?.textContent).toBe('Install environment') })
    const install = window.document.querySelector<HTMLButtonElement>('#install')!
    const pending = Promise.withResolvers<undefined>()
    bridge.install.mockReturnValue(pending.promise)
    install.click()
    expect(install.disabled).toBe(true)
    expect(window.document.querySelector<HTMLButtonElement>('#choose-home')!.disabled).toBe(true)
    expect(window.document.querySelector<HTMLElement>('#cancel')!.hidden).toBe(false)
    progress('Verifying environment')
    expect(window.document.querySelector('#status')?.textContent).toBe('Verifying environment')
    pending.reject(new Error('mirror unavailable'))
    await vi.waitFor(() => { expect(install.disabled).toBe(false) })
    expect(window.document.querySelector('#status')?.textContent).toContain('mirror unavailable')
    expect(window.document.querySelector<HTMLElement>('#cancel')!.hidden).toBe(true)
  })
})

it('keeps recovery diagnostics visible when copying to the clipboard fails', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/recovery.html', import.meta.url), 'utf8'))
  windows.push(dom)
  const copy = vi.fn().mockRejectedValue(new Error('clipboard unavailable'))
  const bridge = {
    state: async () => ({ locale: resolveDesktopLocale('en'), message: 'original startup failure' }),
    copy,
  }
  new Script(readFileSync(new URL('../renderer/recovery.js', import.meta.url), 'utf8'))
    .runInContext(createContext({ window: { paperMachineRecovery: bridge }, document: dom.window.document }))
  await vi.waitFor(() => { expect(dom.window.document.querySelector('#copy')?.textContent).toBe('Copy diagnostics') })
  dom.window.document.querySelector<HTMLButtonElement>('#copy')!.click()
  await vi.waitFor(() => { expect(dom.window.document.querySelector('#copy-status')?.textContent).toContain('clipboard unavailable') })
  expect(dom.window.document.querySelector('#message')?.textContent).toBe('original startup failure')
})
