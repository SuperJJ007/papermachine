/** Electron development shell for the Science desktop product. */

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type { HostCommand, HostExit } from './host-process.ts'
import { HostLifecycle } from './host-lifecycle.ts'
import { parseEnvironmentDeclaration, type DesktopPlatform, type EnvironmentDeclaration } from './environment-declaration.ts'
import { DesktopEnvironmentProvisioner } from './provisioning.ts'
import { renderDesktopRuntimeOverlay } from './runtime-overlay.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const RESTART_URL = 'dsh-desktop://restart'
// Milliseconds the Host supervisor allows for cooperative Cordis disposal
// (SIGTERM) before escalating to SIGKILL.
const HOST_STOP_GRACE_MS = 5000
let window: BrowserWindow | undefined
let quitting = false
let activeOrigin: string | undefined
let provisioning: AbortController | undefined

const hostLifecycle = new HostLifecycle({
  graceMs: HOST_STOP_GRACE_MS,
  spawnWatchdog: hostPid => spawn(
    process.execPath,
    [join(import.meta.dirname, 'watchdog.js'), String(process.pid), String(hostPid)],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' },
  ),
})

function resourceRoot(): string {
  return app.isPackaged ? process.resourcesPath : join(REPOSITORY_ROOT, 'apps/desktop/resources')
}

function desktopPlatform(): DesktopPlatform {
  if (process.platform !== 'darwin' || (process.arch !== 'arm64' && process.arch !== 'x64')) {
    throw new Error(`desktop: unsupported platform ${process.platform}-${process.arch}`)
  }
  return `darwin-${process.arch}`
}

async function declarations(): Promise<readonly EnvironmentDeclaration[]> {
  return Promise.all(['social-science', 'biology'].map(async id => parseEnvironmentDeclaration(
    JSON.parse(await readFile(join(resourceRoot(), 'environments', `${id}.json`), 'utf8')),
  )))
}

function provisioner(dshHome: string): DesktopEnvironmentProvisioner {
  const platform = desktopPlatform()
  return new DesktopEnvironmentProvisioner({
    root: join(dshHome, 'desktop-environments'),
    micromambaPath: join(resourceRoot(), 'bin', platform, 'micromamba'),
    platform,
  })
}

async function writeRuntimeOverlay(dshHome: string, prefix: string): Promise<string> {
  const overlay = join(dshHome, 'desktop-science.cordis.patch.yml')
  await writeFile(overlay, renderDesktopRuntimeOverlay(prefix), { mode: 0o600 })
  return overlay
}

function hostCommand(dshHome: string, overlay: string): HostCommand {
  const packagedHost = join(process.resourcesPath, 'host')
  return {
    executable: process.execPath,
    args: [
      ...(app.isPackaged
        ? [join(packagedHost, 'lib/bin.js')]
        : ['--import', 'tsx/esm', join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')]),
      '--profile', 'web',
      '--patch', overlay,
      '--port', '0',
      '--trusted-host', '127.0.0.1',
      '--no-open',
    ],
    cwd: app.isPackaged ? packagedHost : REPOSITORY_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: dshHome,
    },
  }
}

function errorPage(exit?: HostExit, reason?: string): string {
  const detail = reason ?? (exit === undefined
    ? 'Host unavailable'
    : `Host stopped (${String(exit.code ?? exit.signal)})`)
  const html = `<!doctype html><html><meta charset="utf-8"><title>Science</title>
    <style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f7fa;color:#16202a}main{max-width:34rem;padding:2rem;text-align:center}a{display:inline-block;margin-top:1rem;padding:.7rem 1rem;border-radius:.5rem;background:#1769aa;color:white;text-decoration:none}</style>
    <main><h1>Science Host needs attention</h1><p>${escapeHtml(detail)}</p><a href="${RESTART_URL}">Restart Host</a></main></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string)
}

/**
 * Shared guard for the workspace window's `will-navigate` and `will-redirect`
 * events: both fire for a navigation the workspace document did not stay
 * within its own origin for, and both accept the restart link.
 * @param event - the navigation event to cancel when the target is disallowed.
 * @param target - the destination URL.
 */
function guardWorkspaceNavigation(event: Electron.Event, target: string): void {
  if (target === RESTART_URL) {
    event.preventDefault()
    void restartHost()
    return
  }
  if (activeOrigin === undefined || new URL(target).origin !== activeOrigin) event.preventDefault()
}

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    title: 'Science',
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f7fa',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  created.once('ready-to-show', () => { created.show() })
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  created.webContents.on('will-navigate', guardWorkspaceNavigation)
  created.webContents.on('will-redirect', guardWorkspaceNavigation)
  return created
}

function createOnboardingWindow(): BrowserWindow {
  const created = new BrowserWindow({
    title: 'Set up DeepSeek Science',
    width: 820,
    height: 720,
    minWidth: 680,
    minHeight: 600,
    show: false,
    backgroundColor: '#f4f7fa',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, 'preload.cjs'),
    },
  })
  created.once('ready-to-show', () => { created.show() })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => { event.preventDefault() })
  return created
}

async function onboardingDocument(): Promise<string> {
  const [document, script] = await Promise.all([
    readFile(join(resourceRoot(), 'onboarding.html'), 'utf8'),
    readFile(join(import.meta.dirname, 'onboarding.js'), 'utf8'),
  ])
  return document.replace('{{ONBOARDING_SCRIPT}}', script.replaceAll('</script', '<\\/script'))
}

function onUnexpectedHostExit(exit: HostExit): void {
  activeOrigin = undefined
  if (!quitting && window !== undefined && !window.isDestroyed()) void window.loadURL(errorPage(exit))
}

async function launchHost(): Promise<void> {
  const dshHome = app.getPath('userData')
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const applied = await provisioner(dshHome).applied()
  if (applied === undefined) throw new Error('desktop host: no verified Science environment')
  const overlay = await writeRuntimeOverlay(dshHome, applied.prefix)
  const url = await hostLifecycle.launch(hostCommand(dshHome, overlay), onUnexpectedHostExit)
  activeOrigin = url.origin
  await window?.loadURL(url.href)
}

async function openWorkspace(): Promise<void> {
  const previous = window
  const created = createWindow()
  window = created
  created.once('closed', () => { if (window === created) window = undefined })
  previous?.destroy()
  await launchHost()
}

async function openInitialSurface(): Promise<void> {
  const dshHome = app.getPath('userData')
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  if (await provisioner(dshHome).applied() !== undefined) {
    await openWorkspace()
    return
  }
  window = createOnboardingWindow()
  const onboarding = window
  window.once('closed', () => { if (window === onboarding) window = undefined })
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(await onboardingDocument())}`)
}

async function restartHost(): Promise<void> {
  activeOrigin = undefined
  try {
    // launchHost -> HostLifecycle.launch stops the currently active Host and
    // watchdog before starting the replacement.
    await launchHost()
  } catch (error) {
    await window?.loadURL(errorPage(undefined, error instanceof Error ? error.message : String(error)))
  }
}

app.setName('DeepSeek Science')
await app.whenReady()
ipcMain.handle('desktop:environments', async () => (await declarations()).map(item => ({
  id: item.id,
  name: item.name,
  revision: item.revision,
  estimatedDownloadBytes: item.estimatedDownloadBytes,
  requiredFreeBytes: item.requiredFreeBytes,
})))
ipcMain.handle('desktop:cancel-provisioning', () => { provisioning?.abort() })
ipcMain.handle('desktop:provision', async (_event, id: unknown) => {
  if (typeof id !== 'string') throw new Error('desktop provisioning: environment id must be a string')
  if (provisioning !== undefined) throw new Error('desktop provisioning: another operation is running')
  const declaration = (await declarations()).find(item => item.id === id)
  if (declaration === undefined) throw new Error(`desktop provisioning: unknown environment ${id}`)
  const control = new AbortController()
  provisioning = control
  try {
    await provisioner(app.getPath('userData')).provision(declaration, control.signal, (update) => {
      window?.webContents.send('desktop:provisioning-progress', update)
    })
    await openWorkspace()
  } finally {
    provisioning = undefined
  }
})
await openInitialSurface().catch(async (error: unknown) => {
  window ??= createWindow()
  await window.loadURL(errorPage(undefined, error instanceof Error ? error.message : String(error)))
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length !== 0) return
  void openInitialSurface()
})
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void hostLifecycle.stop().finally(() => { app.quit() })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
