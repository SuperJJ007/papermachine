import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const launch = vi.hoisted(() => ({
  resolveHome: vi.fn<() => Promise<string>>(),
  setName: vi.fn(),
  setPath: vi.fn(),
  lock: vi.fn<() => boolean>(),
  whenReady: vi.fn<() => Promise<void>>(),
  startHost: vi.fn<() => Promise<never>>(),
  exit: vi.fn(),
  quit: vi.fn(),
}))

vi.mock('@deepseek-ai/dsh-home-paths', () => ({ resolvePaperMachineHome: launch.resolveHome }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    setName: launch.setName,
    setPath: launch.setPath,
    requestSingleInstanceLock: launch.lock,
    whenReady: launch.whenReady,
    getLocale: () => 'en',
    getVersion: () => '0.1.5-rc.1',
    on: vi.fn(),
    exit: launch.exit,
    quit: launch.quit,
  },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  BrowserWindow: vi.fn(),
  ipcMain: {},
  Menu: {},
}))
vi.mock('../src/project-manager.ts', () => ({
  DesktopProjectManager: class {
    recover(): void {}
    async applyRelease(): Promise<void> {}
  },
}))
vi.mock('../src/host-process.ts', () => ({
  DesktopHostProcess: class {
    start = launch.startHost
  },
}))
vi.mock('../src/update-coordinator.ts', () => ({ DesktopUpdateCoordinator: vi.fn() }))

const roots: string[] = []
const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('DSH_DESKTOP_DEV_PROJECT_DIR', '')
  vi.stubEnv('DSH_DESKTOP_DIAGNOSTIC_FILE', undefined)
  vi.stubEnv('DSH_HOME', '/official-home-must-not-be-used')
  vi.stubEnv('PAPERMACHINE_HOME', undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  launch.lock.mockReturnValue(true)
  launch.startHost.mockRejectedValue(new Error('fixture stops at Host startup'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (resourcesDescriptor === undefined) Reflect.deleteProperty(process, 'resourcesPath')
  else Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop main initialization', () => {
  it('awaits browser-data setup before locking and starts the Host only after ready', async () => {
    const root = mkdtempSync(join(tmpdir(), 'papermachine-main-'))
    roots.push(root)
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: join(root, 'resources') })
    const home = join(root, 'home')
    const requested = Promise.withResolvers<undefined>()
    const selected = Promise.withResolvers<string>()
    const ready = Promise.withResolvers<undefined>()
    launch.resolveHome.mockImplementation(() => {
      requested.resolve(undefined)
      return selected.promise
    })
    launch.whenReady.mockReturnValue(ready.promise)

    let evaluated = false
    const importing = import('../src/main.ts').then(() => { evaluated = true })
    await requested.promise
    expect(evaluated).toBe(false)
    expect(launch.setPath).not.toHaveBeenCalled()
    expect(launch.lock).not.toHaveBeenCalled()
    expect(launch.whenReady).not.toHaveBeenCalled()
    selected.resolve(home)
    await importing

    const userData = join(home, 'desktop', 'electron-user-data')
    expect(existsSync(userData)).toBe(true)
    expect(launch.setName).toHaveBeenCalledExactlyOnceWith('PaperMachine')
    expect(launch.setPath.mock.calls).toEqual([['userData', userData], ['sessionData', userData]])
    expect(launch.setName.mock.invocationCallOrder[0]).toBeLessThan(launch.lock.mock.invocationCallOrder[0]!)
    expect(launch.setPath.mock.invocationCallOrder[1]).toBeLessThan(launch.lock.mock.invocationCallOrder[0]!)
    expect(launch.lock.mock.invocationCallOrder[0]).toBeLessThan(launch.whenReady.mock.invocationCallOrder[0]!)
    expect(process.env.DSH_HOME).toBe(home)
    expect(process.env.PAPERMACHINE_HOME).toBe(home)
    expect(launch.startHost).not.toHaveBeenCalled()

    ready.resolve(undefined)
    await vi.waitFor(() => { expect(launch.exit).toHaveBeenCalledExactlyOnceWith(1) })
    expect(launch.startHost).toHaveBeenCalledOnce()
    expect(launch.whenReady.mock.invocationCallOrder[0]).toBeLessThan(launch.startHost.mock.invocationCallOrder[0]!)
  })

  it('never schedules a Host when another instance owns the selected home', async () => {
    const home = mkdtempSync(join(tmpdir(), 'papermachine-second-instance-'))
    roots.push(home)
    launch.resolveHome.mockResolvedValue(home)
    launch.lock.mockReturnValue(false)
    await import('../src/main.ts')
    expect(launch.quit).toHaveBeenCalledOnce()
    expect(launch.whenReady).not.toHaveBeenCalled()
    expect(launch.startHost).not.toHaveBeenCalled()
  })
})
