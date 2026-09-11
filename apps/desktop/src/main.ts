/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { basename, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  clipboard,
  ipcMain,
  Menu,
  protocol,
  nativeTheme,
  type IpcMainInvokeEvent,
} from 'electron'
import { resolvePaperMachineHome } from '@deepseek-ai/dsh-home-paths'
import { homedir } from 'node:os'
import { ProductEnvironment } from './product-environment.ts'
import { DesktopOperation } from './desktop-operation.ts'
import { PAPER_MACHINE_VERSION } from './product.ts'
import { writeFileAtomic } from './atomic-write.ts'
import { parseDesktopHostConfig } from './host-config.ts'
import { resolveWindowThemePreference, windowBackgroundColor } from './window-theme.ts'
import { resolveDefaultSourceId } from './source-selection.ts'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from './project-manager.ts'
import { DesktopHostProcess } from './host-process.ts'
import { DESKTOP_IPC, type DesktopUpdateState } from './ipc.ts'
import { formatDesktopMessage, resolveDesktopLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'

const SCHEME = 'dsh-app'
let windowBackground: string | undefined
let focusPrimaryWindow = (): void => {}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    codeCache: true,
  },
}])

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

interface RuntimeResources {
  readonly node: string
  readonly pnpm: string
  readonly seed: string
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = (development ? process.env.DSH_DESKTOP_NODE_BINARY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const seed = (development ? process.env.DSH_DESKTOP_SEED_DIR : undefined) ?? join(process.resourcesPath, 'seed')
  return { node, pnpm, seed }
}

function developmentProject(): string | undefined {
  const configured = process.env.DSH_DESKTOP_DEV_PROJECT_DIR
  if (configured === undefined || configured === '') return undefined
  if (app.isPackaged) throw new Error('dsh desktop: development project override is unavailable in packaged applications')
  return resolve(configured)
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

function createWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow({
    ...(windowBackground === undefined ? {} : { backgroundColor: windowBackground }),
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    const current = new URL(window.webContents.getURL())
    if (target.protocol !== current.protocol || target.hostname !== current.hostname) event.preventDefault()
  })
  return window
}

function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null || senderFrame !== event.sender.mainFrame) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}

async function serveShellAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const root = resolve(app.getAppPath(), 'renderer')
  const url = new URL(request.url)
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response(null, { status: 400 })
  }
  const target = resolve(normalize(join(root, pathname)))
  if (target !== root && !target.startsWith(root + sep)) return new Response(null, { status: 403 })
  try {
    const body = request.method === 'HEAD' ? null : await readFile(target)
    return new Response(body, { headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

async function main(home: string): Promise<void> {
  const resources = runtimeResources()
  const paths = resolveDesktopPaths(home)
  const development = developmentProject()
  const activeProject = development ?? paths.profile
  const hostInspectPort = developmentHostInspectPort(development !== undefined)
  const manager = new DesktopProjectManager(paths, resources)
  const operations = new DesktopOperation()
  const productResources = app.isPackaged ? join(process.resourcesPath, 'product') : join(app.getAppPath(), 'resources')
  const environment = new ProductEnvironment(home, productResources)
  windowBackground = windowBackgroundColor(await resolveWindowThemePreference(home), nativeTheme.shouldUseDarkColors)
  app.setAboutPanelOptions({ applicationName: 'PaperMachine', applicationVersion: PAPER_MACHINE_VERSION, version: `dsh ${app.getVersion()}` })
  let setupWindow: BrowserWindow | undefined
  let quitComplete = false
  let quitting = false
  if (development === undefined) manager.recover()
  let host: DesktopHostProcess | undefined
  let mainWindow: BrowserWindow | undefined
  let pluginWindow: BrowserWindow | undefined
  let shellInstallerOwnsQuit = false
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const locale = resolveDesktopLocale(app.getLocale())
  const messages = locale.messages
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const managementPreload = fileURLToPath(new URL('./preload.cjs', import.meta.url))

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
    }
    return state
  }

  const hostConfig = parseDesktopHostConfig(JSON.parse(await readFile(join(productResources, 'host.json'), 'utf8')))
  const startHost = async (projectDir = activeProject, allowUnbound = false): Promise<DesktopHostProcess> => {
    await environment.writeOverlay(projectDir, allowUnbound)
    const next = new DesktopHostProcess(resources.node, projectDir, home, hostInspectPort, {
      log: { path: join(home, 'logs/host.log'), maxBytes: hostConfig.logMaxBytes, maxRotatedFiles: hostConfig.logMaxRotatedFiles },
      watchdogEntry: fileURLToPath(new URL('./watchdog.js', import.meta.url)),
      onExit: (error) => {
        if (host !== next) return
        host = undefined
        void next.stop().then(openSetup).then(() => { setupWindow?.webContents.send('papermachine:setup-progress', error.message) }).catch(reportStartupFailure)
      },
    })
    try {
      await next.start()
      return next
    } catch (error) {
      await next.stop()
      throw error
    }
  }
  const hooks: DesktopProjectHooks = {
    healthCheck: async (projectDir) => {
      const active = host
      host = undefined
      await active?.stop()
      let healthFailure: unknown
      let probe: DesktopHostProcess | undefined
      try {
        probe = await startHost(projectDir, true)
        await probe.stop()
      } catch (error) {
        healthFailure = error
        await probe?.stop().catch(() => undefined)
      }
      let restartFailure: unknown
      if (active !== undefined) {
        try {
          host = await startHost()
        } catch (error) {
          restartFailure = error
        }
      }
      if (healthFailure !== undefined && restartFailure !== undefined) {
        throw new AggregateError([
          errorOf(healthFailure, 'desktop project: staged health check failed'),
          errorOf(restartFailure, 'desktop project: active backend restart failed'),
        ], 'desktop project: staged health check and active backend restart failed')
      }
      if (healthFailure !== undefined) throw errorOf(healthFailure, 'desktop project: staged health check failed')
      if (restartFailure !== undefined) throw errorOf(restartFailure, 'desktop project: active backend restart failed')
    },
    beforeActivate: async () => {
      const active = host
      host = undefined
      await active?.stop()
    },
    afterActivate: async () => {
      host = await startHost()
    },
  }

  let runtimeReady = false
  const ensureRuntime = async (): Promise<void> => {
    if (runtimeReady) return
    setupWindow?.webContents.send('papermachine:setup-progress', messages.setupRuntime)
    if (development === undefined) {
      await manager.applyRelease(resources.seed, app.getVersion(), {
        ...hooks,
        beforeActivate: async () => {},
        afterActivate: async () => {},
      })
    }
    runtimeReady = true
  }

  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      shellInstallerOwnsQuit = true
      const active = host
      host = undefined
      await active?.stop()
    },
  )
  const installUpdate = async (): Promise<DesktopUpdateState> => operations.run(async () => {
    const state = await updates.install()
    if (state.phase === 'error') shellInstallerOwnsQuit = false
    return state
  })

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'shell') return serveShellAsset(request)
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    const active = host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  const mutate = async (event: IpcMainInvokeEvent, mutation: Parameters<DesktopProjectManager['mutate']>[0]): Promise<void> => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) {
      throw new Error('dsh desktop: plugin package changes require a packaged application')
    }
    await operations.run(async () => { await manager.mutate(mutation, hooks) })
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
  }
  ipcMain.handle(DESKTOP_IPC.localeGet, (event) => {
    assertDesktopSender(event, ['shell'])
    return locale
  })
  ipcMain.handle(DESKTOP_IPC.pluginsList, (event) => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) return []
    return manager.listPlugins()
  })
  ipcMain.handle(DESKTOP_IPC.pluginsAdd, (event, spec: unknown) => {
    if (typeof spec !== 'string') throw new Error('dsh desktop: plugin spec must be a string')
    return mutate(event, { type: 'plugin-add', spec })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsRemove, (event, name: unknown) => {
    if (typeof name !== 'string') throw new Error('dsh desktop: plugin name must be a string')
    return mutate(event, { type: 'plugin-remove', name })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsUpdate, (event, name: unknown, version: unknown) => {
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error('dsh desktop: plugin name and version must be strings')
    }
    return mutate(event, { type: 'plugin-update', name, version })
  })
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertDesktopSender(event, ['shell'])
    return updates.check()
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertDesktopSender(event, ['shell'])
    if (operations.busy) throw new Error('desktop: another operation is running')
    await installUpdate()
  })

  const checkAndPrompt = async (manual: boolean): Promise<void> => {
    const state = await updates.check()
    if (state.phase === 'error') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'error',
          title: messages.updateCheckFailedTitle,
          message: state.message ?? messages.unknownError,
        })
      }
      return
    }
    if (state.phase !== 'available') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          title: messages.updateCheckTitle,
          message: state.message ?? messages.updateCurrent,
        })
      }
      return
    }
    const result = await dialog.showMessageBox({
      type: 'info',
      title: messages.updateTitle,
      message: messages.updateAvailable,
      detail: formatDesktopMessage(messages.updateDetail, { version: state.version ?? '' }),
      buttons: [messages.installAndRestart, messages.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0) return
    if (operations.busy) return
    const installed = await installUpdate()
    if (installed.phase === 'error') {
      await dialog.showMessageBox({
        type: 'error',
        title: messages.updateFailedTitle,
        message: installed.message ?? messages.unknownError,
      })
    }
  }

  const openPluginWindow = (): void => {
    if (pluginWindow !== undefined && !pluginWindow.isDestroyed()) {
      pluginWindow.focus()
      return
    }
    pluginWindow = createWindow(managementPreload)
    pluginWindow.setSize(900, 620)
    pluginWindow.setTitle(messages.pluginWindowTitle)
    pluginWindow.once('ready-to-show', () => { pluginWindow?.show() })
    pluginWindow.once('closed', () => { pluginWindow = undefined })
    void pluginWindow.loadURL(`${SCHEME}://shell/plugin-manager.html`)
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: process.platform === 'darwin' ? app.name : messages.application,
    submenu: [
      {
        label: development === undefined ? messages.pluginsMenu : messages.pluginsMenuPackagedOnly,
        accelerator: 'CmdOrCtrl+,',
        enabled: development === undefined,
        click: openPluginWindow,
      },
      { label: messages.changeEnvironment, click: () => { if (!operations.busy) void openSetup() } },
      { label: messages.checkUpdatesMenu, click: () => { void checkAndPrompt(true) } },
      { type: 'separator' },
      { role: 'about' },
      { role: 'quit' },
    ],
  }, { role: 'editMenu' }]))

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload)
    mainWindow = window
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
    const updateCheck = setTimeout(() => {
      if (!quitting && !operations.busy) void checkAndPrompt(false).catch(reportStartupFailure)
    }, 10_000)
    updateCheck.unref()
    window.on('closed', () => {
      clearTimeout(updateCheck)
      if (mainWindow === window) mainWindow = undefined
    })
    return window
  }
  focusPrimaryWindow = () => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) {
      const replacement = createMainWindow()
      void replacement.loadURL(`${SCHEME}://app/index.html`)
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const openWorkspace = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted()
    await ensureRuntime()
    signal.throwIfAborted()
    host = await startHost()
    signal.throwIfAborted()
    if (mainWindow === undefined || mainWindow.isDestroyed()) mainWindow = createMainWindow()
    await mainWindow.loadURL(`${SCHEME}://app/index.html`)
    setupWindow?.close()
    if (development !== undefined && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
    publishUpdate(updateState)
  }

  const openSetup = async (): Promise<void> => {
    if (setupWindow !== undefined && !setupWindow.isDestroyed()) { setupWindow.show(); setupWindow.focus(); return }
    const window = createWindow(fileURLToPath(new URL('./preload-onboarding.cjs', import.meta.url)))
    setupWindow = window
    window.once('closed', () => { setupWindow = undefined })
    await window.loadURL(`${SCHEME}://shell/onboarding.html`)
    window.show()
  }
  const assertSetupSender = (event: IpcMainInvokeEvent): void => {
    assertDesktopSender(event, ['shell'])
    if (event.sender !== setupWindow?.webContents || new URL(event.senderFrame?.url ?? 'about:blank').pathname !== '/onboarding.html') {
      throw new Error('desktop: rejected setup IPC from another renderer')
    }
  }
  ipcMain.handle('papermachine:setup-state', async (event) => {
    assertSetupSender(event)
    const declaration = await environment.declaration()
    return {
      locale, home, version: PAPER_MACHINE_VERSION, declaration, status: await environment.status(),
      defaultSource: resolveDefaultSourceId(declaration.sources, {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, languages: app.getPreferredSystemLanguages(),
      }),
    }
  })
  ipcMain.handle('papermachine:setup-install', async (event, source: unknown, packages: unknown) => {
    assertSetupSender(event)
    if (typeof source !== 'string' || (packages !== undefined && (!Array.isArray(packages) || !packages.every(value => typeof value === 'string')))) {
      throw new Error('desktop: invalid environment install request')
    }
    await operations.run(async (signal) => {
      const active = host
      host = undefined
      await active?.stop()
      signal.throwIfAborted()
      await ensureRuntime()
      signal.throwIfAborted()
      await environment.install(source, packages, signal, (progress) => {
        if (!setupWindow?.isDestroyed()) setupWindow?.webContents.send('papermachine:setup-progress', progress.message)
      })
      await openWorkspace(signal)
    })
  })
  ipcMain.handle('papermachine:setup-cancel', (event) => { assertSetupSender(event); operations.cancel() })
  ipcMain.handle('papermachine:setup-continue', async (event) => {
    assertSetupSender(event)
    await operations.run(async (signal) => {
      const active = host
      host = undefined
      await active?.stop()
      await openWorkspace(signal)
    })
  })
  ipcMain.handle('papermachine:setup-home', async (event) => {
    assertSetupSender(event)
    await operations.run(async (signal) => { await changeInstallLocation(signal) })
  })
  ipcMain.handle('papermachine:setup-reset-home', async (event) => {
    assertSetupSender(event)
    await operations.run(async (signal) => { await resetInstallLocation(signal) })
  })
  focusPrimaryWindow = () => {
    const window = setupWindow ?? mainWindow
    if (window === undefined || window.isDestroyed()) {
      if (host !== undefined) {
        const replacement = createMainWindow()
        void replacement.loadURL(`${SCHEME}://app/index.html`)
      } else { void openSetup() }
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (shellInstallerOwnsQuit || quitComplete) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    void operations.shutdown().then(async () => {
      const active = host
      host = undefined
      await active?.stop()
      quitComplete = true
      app.quit()
    }).catch(reportStartupFailure)
  })

  // The shell page becomes visible before any seed extraction or package process.
  await openSetup()
  if ((await environment.status()).kind === 'bound') {
    await operations.run(openWorkspace).catch((error: unknown) => {
      setupWindow?.webContents.send('papermachine:setup-progress', String(error))
    })
  }

}

async function prepareApplication(): Promise<string | undefined> {
  const home = await resolvePaperMachineHome()
  if (home.includes(' ')) throw new Error('PaperMachine: R requires an install path without spaces')
  process.env.PAPERMACHINE_HOME = home
  process.env.DSH_HOME = home
  const userData = join(home, 'desktop', 'electron-user-data')
  await mkdir(userData, { recursive: true, mode: 0o700 })
  app.setName('PaperMachine')
  app.setPath('userData', userData)
  app.setPath('sessionData', userData)
  if (!claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })) return
  return home
}

async function relaunchAtHome(selected: string): Promise<void> {
  await writeFileAtomic(join(homedir(), '.papermachine-home'), `${selected}\n`, { mode: 0o600 })
  delete process.env.PAPERMACHINE_HOME
  delete process.env.DSH_HOME
  app.relaunch()
  app.quit()
}

async function changeInstallLocation(signal: AbortSignal): Promise<void> {
  const messages = resolveDesktopLocale(app.getLocale()).messages
  const choice = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  const directory = choice.filePaths[0]
  if (choice.canceled || directory === undefined) return
  const path = basename(directory).toLowerCase() === 'papermachine' ? directory : join(directory, 'PaperMachine')
  const selected = await resolvePaperMachineHome(path)
  if (selected.includes(' ')) throw new Error(messages.homeSpaceError)
  const confirmed = await dialog.showMessageBox({
    type: 'question', message: messages.chooseHome,
    detail: formatDesktopMessage(messages.homeChangeDetail, { path: selected }),
    buttons: [messages.confirm, messages.cancel], defaultId: 1, cancelId: 1,
  })
  if (confirmed.response !== 0) return
  if (/[^\x00-\x7f]/u.test(selected)) {
    const warning = await dialog.showMessageBox({ type: 'warning', message: messages.homeNonAscii,
      buttons: [messages.confirm, messages.cancel], defaultId: 1, cancelId: 1 })
    if (warning.response !== 0) return
  }
  signal.throwIfAborted()
  await relaunchAtHome(selected)
}

async function resetInstallLocation(signal: AbortSignal): Promise<void> {
  const messages = resolveDesktopLocale(app.getLocale()).messages
  const choice = await dialog.showMessageBox({ type: 'question', message: messages.resetHome,
    detail: messages.resetHomeDetail, buttons: [messages.confirm, messages.cancel], defaultId: 1, cancelId: 1 })
  if (choice.response !== 0) return
  signal.throwIfAborted()
  try { await unlink(join(homedir(), '.papermachine-home')) } catch (error) {
    // Only an absent pointer already selects the default home.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  delete process.env.PAPERMACHINE_HOME
  delete process.env.DSH_HOME
  app.relaunch()
  app.quit()
}

async function showStartupRecovery(message: string): Promise<void> {
  const locale = resolveDesktopLocale(app.getLocale())
  if (!(protocol.isProtocolHandled(SCHEME))) {
    protocol.handle(SCHEME, request => new URL(request.url).hostname === 'shell' ? serveShellAsset(request) : Promise.resolve(new Response(null, { status: 503 })))
  }
  const window = createWindow(fileURLToPath(new URL('./preload-recovery.cjs', import.meta.url)))
  const assertRecovery = (event: IpcMainInvokeEvent): void => {
    assertDesktopSender(event, ['shell'])
    if (event.sender !== window.webContents || new URL(event.senderFrame?.url ?? 'about:blank').pathname !== '/recovery.html') throw new Error('desktop: rejected recovery IPC')
  }
  const operations = new DesktopOperation()
  const handlers = {
    state: (event: IpcMainInvokeEvent) => { assertRecovery(event); return { locale, message } },
    choose: async (event: IpcMainInvokeEvent) => { assertRecovery(event); await operations.run(changeInstallLocation) },
    reset: async (event: IpcMainInvokeEvent) => { assertRecovery(event); await operations.run(resetInstallLocation) },
    restart: (event: IpcMainInvokeEvent) => { assertRecovery(event); app.relaunch(); app.quit() },
    copy: async (event: IpcMainInvokeEvent) => {
      assertRecovery(event)
      await clipboard.writeText([`PaperMachine ${PAPER_MACHINE_VERSION}`, `dsh ${app.getVersion()}`, `${process.platform}-${process.arch}`,
        process.env.PAPERMACHINE_HOME ?? locale.messages.homeUnresolved, message].join('\n'))
    },
    quit: (event: IpcMainInvokeEvent) => { assertRecovery(event); app.quit() },
  }
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(`papermachine:recovery-${name}`)
    ipcMain.handle(`papermachine:recovery-${name}`, handler)
  }
  await window.loadURL(`${SCHEME}://shell/recovery.html`)
  window.show()
}

async function reportStartupFailure(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? message : message}\n`).catch(() => undefined)
  }
  // Do not await Electron readiness from top-level ESM evaluation.
  void app.whenReady().then(() => showStartupRecovery(message)).catch((failure: unknown) => {
    dialog.showErrorBox(resolveDesktopLocale(app.getLocale()).messages.startupFailed, String(failure))
    app.exit(1)
  })
}

// Electron defers ready until ESM evaluation finishes; browser paths must be set first.
const home = await prepareApplication().catch(reportStartupFailure)
if (home !== undefined) void app.whenReady().then(() => main(home)).catch(reportStartupFailure)
