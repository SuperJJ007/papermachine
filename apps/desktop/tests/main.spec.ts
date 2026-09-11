import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const launch = vi.hoisted(() => ({
  resolveHome: vi.fn<(configured?: string) => Promise<string>>(), setName: vi.fn(), setPath: vi.fn(),
  lock: vi.fn<() => boolean>(), whenReady: vi.fn<() => Promise<void>>(),
  startHost: vi.fn(), stopHost: vi.fn(), exit: vi.fn(), quit: vi.fn(),
  osHome: '', choice: vi.fn(), confirmation: vi.fn(), relaunch: vi.fn(), updateInstall: vi.fn(), mutate: vi.fn(),
  install: vi.fn(), applyRelease: vi.fn(), overlay: vi.fn(),
  status: vi.fn(), windows: [] as Array<InstanceType<typeof FakeWindow>>,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  events: new Map<string, (...args: unknown[]) => unknown>(),
  order: [] as string[], buildMenu: vi.fn(),
}))
// Electron's dynamically named IPC/event callbacks have heterogeneous signatures.
class FakeWindow {
  destroyed = false
  url = ''
  listeners = new Map<string, () => void>()
  frame = { url: '' }
  webContents = {
    mainFrame: this.frame, setWindowOpenHandler: vi.fn(), on: vi.fn(), send: vi.fn(),
    getURL: () => this.url, reload: vi.fn(), openDevTools: vi.fn(),
  }
  constructor(readonly options: { webPreferences: { preload: string } }) { launch.windows.push(this) }
  static getAllWindows() { return launch.windows.filter(window => !window.destroyed) }
  once(name: string, fn: () => void) { this.listeners.set(name, fn) }
  on(name: string, fn: () => void) { this.listeners.set(name, fn) }
  async loadURL(url: string) { this.url = url; this.frame.url = url; launch.order.push(url) }
  show() { launch.order.push('show') }
  focus() {}
  close() { this.destroyed = true; this.listeners.get('closed')?.() }
  isDestroyed() { return this.destroyed }
  isMinimized() { return false }
  restore() {}
  setSize() {}
  setTitle() {}
}
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => launch.osHome }))
vi.mock('@deepseek-ai/dsh-home-paths', () => ({ resolvePaperMachineHome: launch.resolveHome }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true, setName: launch.setName, setPath: launch.setPath,
    requestSingleInstanceLock: launch.lock, whenReady: launch.whenReady,
    getLocale: () => 'en', getVersion: () => '0.1.5-rc.1', getPreferredSystemLanguages: () => ['en'],
    setAboutPanelOptions: vi.fn(),
    getAppPath: () => '/app', on: (name: string, handler: (...args: unknown[]) => unknown) => launch.events.set(name, handler),
    relaunch: launch.relaunch,
    exit: launch.exit, quit: launch.quit,
  },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn(), isProtocolHandled: () => false },
  dialog: { showErrorBox: vi.fn(), showOpenDialog: launch.choice, showMessageBox: launch.confirmation },
  get BrowserWindow() { return FakeWindow },
  ipcMain: {
    removeHandler: (name: string) => { launch.handlers.delete(name) },
    handle: (name: string, handler: (...args: unknown[]) => unknown) => launch.handlers.set(name, handler),
  },
  nativeTheme: { shouldUseDarkColors: false },
  Menu: { buildFromTemplate: launch.buildMenu, setApplicationMenu: vi.fn() },
}))
vi.mock('../src/project-manager.ts', () => ({ DesktopProjectManager: class { recover() {} applyRelease = launch.applyRelease; mutate = launch.mutate } }))
vi.mock('../src/host-process.ts', () => ({ DesktopHostProcess: class { start = launch.startHost; stop = launch.stopHost } }))
vi.mock('../src/update-coordinator.ts', () => ({ DesktopUpdateCoordinator: class { install = launch.updateInstall } }))
vi.mock('../src/product-environment.ts', () => ({ ProductEnvironment: class {
  status = launch.status
  install = launch.install
  writeOverlay = launch.overlay
} }))
const roots: string[] = []
const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
function sender(window = launch.windows[0]!) { return { sender: window.webContents, senderFrame: window.frame } }
function handler(name: string) {
  return async (...args: unknown[]): Promise<unknown> => launch.handlers.get(`papermachine:setup-${name}`)!(...args)
}
async function boot() {
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(launch.windows[0]?.url).toContain('onboarding.html') })
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); launch.windows.length = 0; launch.order.length = 0
  launch.handlers.clear(); launch.events.clear()
  const home = mkdtempSync(join(tmpdir(), 'papermachine-main-')); roots.push(home)
  launch.osHome = home
  launch.choice.mockResolvedValue({ canceled: true, filePaths: [] })
  launch.confirmation.mockResolvedValue({ response: 1 })
  launch.updateInstall.mockResolvedValue({ phase: 'ready' })
  launch.mutate.mockResolvedValue(undefined)
  launch.resolveHome.mockResolvedValue(home); launch.lock.mockReturnValue(true)
  launch.whenReady.mockResolvedValue(undefined); launch.startHost.mockResolvedValue({}); launch.stopHost.mockResolvedValue(undefined)
  launch.status.mockResolvedValue({ kind: 'unbound' })
  launch.applyRelease.mockImplementation(async () => { launch.order.push('seed') })
  launch.install.mockImplementation(async () => { launch.order.push('conda') })
  vi.stubEnv('DSH_DESKTOP_DEV_PROJECT_DIR', ''); vi.stubEnv('DSH_DESKTOP_DIAGNOSTIC_FILE', undefined)
  vi.stubEnv('DSH_HOME', '/official-home-must-not-be-used'); vi.stubEnv('PAPERMACHINE_HOME', undefined)
  mkdirSync(join(home, 'resources/product'), { recursive: true })
  writeFileSync(join(home, 'resources/product/host.json'), JSON.stringify({ schemaVersion: 1, logMaxBytes: 1048576, logMaxRotatedFiles: 3 }))
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: join(home, 'resources') })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const window of launch.windows) window.close()
  vi.restoreAllMocks(); vi.unstubAllEnvs()
  if (resourcesDescriptor === undefined) Reflect.deleteProperty(process, 'resourcesPath')
  else Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
describe('desktop main initialization', () => {
  it('opens isolated onboarding before installing seed and conda, then opens the app with a separate preload', async () => {
    await boot()
    expect(launch.buildMenu).toHaveBeenCalledWith(expect.arrayContaining([{ role: 'editMenu' }]))
    expect(launch.applyRelease).not.toHaveBeenCalled()
    expect(launch.startHost).not.toHaveBeenCalled()
    expect(existsSync(join(process.env.PAPERMACHINE_HOME!, 'desktop/electron-user-data'))).toBe(true)
    const setup = launch.windows[0]!
    expect(setup.options).toMatchObject({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    expect(setup.options.webPreferences.preload).toContain('preload-onboarding.cjs')
    await handler('install')(sender(), 'official', undefined)
    expect(launch.order.indexOf('show')).toBeLessThan(launch.order.indexOf('seed'))
    expect(launch.order.indexOf('seed')).toBeLessThan(launch.order.indexOf('conda'))
    expect(launch.windows[1]!.url).toBe('dsh-app://app/index.html')
    expect(launch.windows[1]!.options.webPreferences.preload).toContain('preload-app.cjs')
    expect(setup.isDestroyed()).toBe(true)
  })
  it('rejects setup IPC from app content, sibling shell pages and subframes', async () => {
    await boot()
    const setup = launch.windows[0]!
    for (const url of ['dsh-app://app/index.html', 'dsh-app://shell/plugin-manager.html']) {
      setup.frame.url = url
      await expect(handler('install')(sender(), 'official')).rejects.toThrow()
    }
    setup.frame.url = setup.url
    await expect(handler('install')({ sender: setup.webContents, senderFrame: { url: setup.url } }, 'official')).rejects.toThrow()
    expect(launch.install).not.toHaveBeenCalled()
  })
  it('stops a failed Host start and leaves onboarding available for retry', async () => {
    launch.startHost.mockRejectedValueOnce(new Error('host failed'))
    await boot()
    await expect(handler('install')(sender(), 'official')).rejects.toThrow('host failed')
    expect(launch.stopHost).toHaveBeenCalledOnce()
    expect(launch.windows[0]!.isDestroyed()).toBe(false)
    await handler('continue')(sender())
    expect(launch.windows[1]!.url).toBe('dsh-app://app/index.html')
  })
  it('waits for aborted provisioning to unwind before quitting and never starts its Host', async () => {
    const pending = Promise.withResolvers<undefined>()
    let signal: AbortSignal | undefined
    launch.install.mockImplementation(async (_source, _packages, value: AbortSignal) => { signal = value; await pending.promise })
    await boot()
    const installing = handler('install')(sender(), 'official')
    const failed = expect(installing).rejects.toThrow()
    await vi.waitFor(() => { expect(signal).toBeDefined() })
    const preventDefault = vi.fn()
    launch.events.get('before-quit')!({ preventDefault })
    expect(signal!.aborted).toBe(true)
    expect(launch.quit).not.toHaveBeenCalled()
    pending.resolve(undefined)
    await failed
    await vi.waitFor(() => { expect(launch.quit).toHaveBeenCalledOnce() })
    expect(launch.startHost).not.toHaveBeenCalled()
  })
  it('holds one operation across updater download and rejects both plugin and environment mutations', async () => {
    await boot()
    const pending = Promise.withResolvers<{ phase: 'ready' }>()
    launch.updateInstall.mockReturnValue(pending.promise)
    const updating = launch.handlers.get(DESKTOP_IPC.updatesInstall)!(sender())
    await vi.waitFor(() => { expect(launch.updateInstall).toHaveBeenCalledOnce() })
    await expect(handler('install')(sender(), 'official')).rejects.toThrow('another operation')
    const add = launch.handlers.get(DESKTOP_IPC.pluginsAdd)!
    await expect(add(sender(), 'some-plugin@1.0.0')).rejects.toThrow('another operation')
    expect(launch.mutate).not.toHaveBeenCalled()
    pending.resolve({ phase: 'ready' })
    await updating
  })
  it('rejects updater installation while a plugin transaction owns the profile', async () => {
    await boot()
    const pending = Promise.withResolvers<undefined>()
    launch.mutate.mockReturnValue(pending.promise)
    const mutating = launch.handlers.get(DESKTOP_IPC.pluginsAdd)!(sender(), 'some-plugin@1.0.0')
    await vi.waitFor(() => { expect(launch.mutate).toHaveBeenCalledOnce() })
    await expect(launch.handlers.get(DESKTOP_IPC.updatesInstall)!(sender())).rejects.toThrow('another operation')
    expect(launch.updateInstall).not.toHaveBeenCalled()
    pending.resolve(undefined)
    await mutating
  })
  it('does not change the home pointer until the chosen canonical directory is confirmed', async () => {
    await boot()
    const directory = join(launch.osHome, 'new-location')
    const selected = join(directory, 'PaperMachine')
    launch.choice.mockResolvedValue({ canceled: false, filePaths: [directory] })
    launch.resolveHome.mockResolvedValue(selected)
    await handler('home')(sender())
    expect(launch.resolveHome).toHaveBeenLastCalledWith(selected)
    expect(existsSync(join(launch.osHome, '.papermachine-home'))).toBe(false)
    expect(launch.relaunch).not.toHaveBeenCalled()
    launch.confirmation.mockResolvedValue({ response: 0 })
    await handler('home')(sender())
    expect(readFileSync(join(launch.osHome, '.papermachine-home'), 'utf8')).toBe(`${selected}\n`)
    expect(launch.relaunch).toHaveBeenCalledOnce()
    expect(process.env.PAPERMACHINE_HOME).toBeUndefined()
    expect(launch.applyRelease).not.toHaveBeenCalled()
  })
  it('reopens the workspace at the same origin without reinstalling the runtime', async () => {
    await boot()
    await handler('install')(sender(), 'official')
    launch.windows[1]!.close()
    launch.events.get('activate')!()
    expect(launch.windows[2]!.url).toBe('dsh-app://app/index.html')
    expect(launch.applyRelease).toHaveBeenCalledOnce()
    expect(launch.startHost).toHaveBeenCalledOnce()
  })
  it('offers shell-owned recovery when home resolution fails without installing or starting a Host', async () => {
    launch.resolveHome.mockRejectedValue(new Error('saved home is unavailable'))
    await import('../src/main.ts')
    await vi.waitFor(() => { expect(launch.windows[0]?.url).toBe('dsh-app://shell/recovery.html') })
    expect(launch.applyRelease).not.toHaveBeenCalled()
    expect(launch.startHost).not.toHaveBeenCalled()
    const state = launch.handlers.get('papermachine:recovery-state')!
    expect(state(sender())).toMatchObject({ message: 'saved home is unavailable' })
    launch.windows[0]!.frame.url = 'dsh-app://app/index.html'
    expect(() => state(sender())).toThrow()
  })
  it('never schedules a Host when another instance owns the home', async () => {
    launch.lock.mockReturnValue(false)
    await import('../src/main.ts')
    expect(launch.quit).toHaveBeenCalledOnce()
    expect(launch.whenReady).not.toHaveBeenCalled()
  })
})
