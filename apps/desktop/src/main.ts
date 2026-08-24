/** Electron development shell for the Science desktop product. */

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import type { HostCommand, HostExit } from './host-process.ts'
import { HostLifecycle } from './host-lifecycle.ts'
import { parseEnvironmentDeclaration, type DesktopPlatform, type EnvironmentDeclaration } from './environment-declaration.ts'
import { DesktopEnvironmentProvisioner, type ProvisioningProgress } from './provisioning.ts'
import { renderDesktopRuntimeOverlay } from './runtime-overlay.ts'
import { resolveDisciplineStatus } from './discipline-status.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const RESTART_URL = 'dsh-desktop://restart'
// Milliseconds the Host supervisor allows for cooperative Cordis disposal
// (SIGTERM) before escalating to SIGKILL.
const HOST_STOP_GRACE_MS = 5000
let window: BrowserWindow | undefined
// Set once before-quit begins tearing the app down. openWorkspace checks
// this before launching a Host: before-quit stops the active Host
// concurrently with any still-running provisioningRun, so a run that
// reaches its own openWorkspace call after quitting starts must not launch
// a fresh Host behind hostLifecycle.stop()'s back.
let quitting = false
let activeOrigin: string | undefined
let provisioning: AbortController | undefined
// The in-flight `desktop:provision` IPC handler body, if any: `activate` and
// `before-quit` await this rather than only the AbortController, so a
// reopened onboarding window or app quit never races the still-unwinding
// abort of a just-cancelled run.
let provisioningRun: Promise<void> | undefined

const hostLifecycle = new HostLifecycle({
  graceMs: HOST_STOP_GRACE_MS,
  // detached so Electron's own process-group termination (e.g. a forced
  // quit that signals the whole group) cannot take the watchdog down with
  // it before it has collected the Host.
  spawnWatchdog: hostPid => spawn(
    process.execPath,
    [join(import.meta.dirname, 'watchdog.js'), String(process.pid), String(hostPid)],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore', detached: true },
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
    // Unlike the provisioning children (see buildProvisioningEnv in
    // provisioning.ts), the Host is not untrusted output: the local
    // credentials provider reads DEEPSEEK_API_KEY (and related variables)
    // from its own inherited process environment as its highest-priority
    // source, and the Host's own kernel and tool subprocesses need locale,
    // HOME, and other ambient variables an allowlist would have to
    // rediscover one at a time. Scrubbing this environment would silently
    // break credential passthrough and unrelated subprocess needs for a
    // trusted process this application itself owns, so it is left ambient.
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

/**
 * Open the workspace window and launch the Host. If `launchHost` throws, the
 * newly created window has never loaded anything and never fires
 * `ready-to-show`, so it loads the same error page the startup path uses and
 * is shown explicitly rather than staying hidden and indistinguishable from
 * a running app to `activate`'s window-count check.
 */
async function openWorkspace(): Promise<void> {
  // A provisioning run's completion can race app quit (before-quit sets this
  // before awaiting hostLifecycle.stop() and the run itself): without this
  // check, a run that reaches here after stop() has already run would start
  // a fresh Host post-shutdown.
  if (quitting) return
  const previous = window
  const created = createWindow()
  window = created
  created.once('closed', () => { if (window === created) window = undefined })
  previous?.destroy()
  try {
    await launchHost()
  } catch (error) {
    await created.loadURL(errorPage(undefined, error instanceof Error ? error.message : String(error)))
    created.show()
  }
}

/**
 * Open the discipline-selection window, replacing whatever window is active.
 * Closing this window (Cmd-Q, the red button, or a completed run destroying
 * it programmatically) aborts any in-flight provisioning so Cmd-Q mid-solve
 * never orphans the micromamba download group; aborting an already-settled
 * or absent run is a no-op.
 */
async function openOnboarding(): Promise<void> {
  const previous = window
  const created = createOnboardingWindow()
  window = created
  created.once('closed', () => {
    if (window === created) window = undefined
    provisioning?.abort()
  })
  previous?.destroy()
  await created.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(await onboardingDocument())}`)
}

async function openInitialSurface(): Promise<void> {
  const dshHome = app.getPath('userData')
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const status = resolveDisciplineStatus(await provisioner(dshHome).applied(), await declarations())
  if (status.kind === 'current') {
    await openWorkspace()
    return
  }
  await openOnboarding()
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

/**
 * Send one progress update to the active window's renderer. The window may
 * already be destroyed by the time a queued micromamba stdout line reaches
 * this callback (the setup window can close mid-run), and `send` throws on a
 * destroyed `webContents`; an uncaught throw here would escape micromamba's
 * stdout `data` listener as an unhandled main-process exception, so both the
 * destroyed check and the send itself are guarded.
 * @param update - the progress update to relay.
 */
function reportProvisioningProgress(update: ProvisioningProgress): void {
  if (window === undefined || window.isDestroyed()) return
  try {
    window.webContents.send('desktop:provisioning-progress', update)
  } catch (error) {
    console.error('desktop provisioning: failed to report progress', error)
  }
}

function buildApplicationMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: 'Change Discipline…',
          // Re-provisioning targets a revision-scoped prefix path (see
          // provisioning.ts), so the currently applied environment stays
          // untouched and usable until the newly chosen one is applied.
          // Awaiting any in-flight run first (see awaitPendingProvisioning)
          // means clicking mid-download opens onboarding once that run has
          // actually unwound instead of hitting "another operation is
          // running" until it does.
          click: () => { void (async () => {
            await awaitPendingProvisioning()
            await openOnboarding()
          })() },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}

app.setName('DeepSeek Science')
await app.whenReady()
Menu.setApplicationMenu(buildApplicationMenu())
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
  const run = (async () => {
    await provisioner(app.getPath('userData')).provision(declaration, control.signal, reportProvisioningProgress)
    await openWorkspace()
  })()
  provisioningRun = run.finally(() => {
    provisioning = undefined
    provisioningRun = undefined
  })
  await provisioningRun
})
await openInitialSurface().catch(async (error: unknown) => {
  window ??= createWindow()
  await window.loadURL(errorPage(undefined, error instanceof Error ? error.message : String(error)))
})

app.on('activate', () => { void handleActivate() })

/**
 * Await any provisioning run this session just aborted (see
 * openOnboarding's abort-on-close) so it has actually unwound before a
 * caller opens a new onboarding or workspace window. Without this wait, a
 * caller racing a just-cancelled run could act while `provisioning` is
 * still set, so a fresh provisioning attempt would immediately hit
 * "another operation is running".
 */
async function awaitPendingProvisioning(): Promise<void> {
  if (provisioningRun !== undefined) await provisioningRun.catch(() => {})
}

/**
 * Reopen the initial surface, but only once any in-flight provisioning run
 * has unwound (see {@link awaitPendingProvisioning}) — blocking reopen until
 * then is simpler than teaching the reopened window to surface someone
 * else's in-flight run.
 */
async function handleActivate(): Promise<void> {
  await awaitPendingProvisioning()
  if (BrowserWindow.getAllWindows().length !== 0) return
  await openInitialSurface()
}

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  provisioning?.abort()
  void Promise.allSettled([hostLifecycle.stop(), provisioningRun ?? Promise.resolve()]).finally(() => { app.quit() })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
