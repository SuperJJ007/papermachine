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
import { ProvisioningCoordinator } from './provisioning-coordination.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const RESTART_URL = 'dsh-desktop://restart'
// Milliseconds the Host supervisor allows for cooperative Cordis disposal
// (SIGTERM) before escalating to SIGKILL.
const HOST_STOP_GRACE_MS = 5000
let window: BrowserWindow | undefined
let activeOrigin: string | undefined
// The in-flight `desktop:provision` IPC handler's own AbortController, if
// any: `desktop:cancel-provisioning` and `coordinator`'s abort effect signal
// through this, while the run's lifetime for `activate`/quit/change-discipline
// coordination is tracked separately by `coordinator.trackRun`.
let provisioning: AbortController | undefined

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

// Owns the decisions that race one in-flight provisioning run: aborting and
// waiting for it before "Change Discipline…" opens onboarding, `activate`
// waiting for it, and `before-quit` waiting for it alongside the Host stop.
const coordinator = new ProvisioningCoordinator({
  abort: () => { provisioning?.abort() },
  stopHost: () => hostLifecycle.stop(),
  openOnboarding: () => openOnboarding(),
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
  if (!coordinator.quitting && window !== undefined && !window.isDestroyed()) void window.loadURL(errorPage(exit))
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
 * a running app to `activate`'s window-count check. Guarded by
 * {@link ProvisioningCoordinator.openWorkspaceUnlessQuitting}: a
 * provisioning run's completion can race app quit (`before-quit` stops the
 * Host concurrently with awaiting the run), and a run that reaches here
 * after that stop has already run must not launch a fresh Host post-shutdown.
 */
async function openWorkspace(): Promise<void> {
  await coordinator.openWorkspaceUnlessQuitting(async () => {
    const previous = window
    const created = createWindow()
    window = created
    created.once('closed', () => { if (window === created) window = undefined })
    previous?.destroy()
    try {
      await launchHost()
    } catch (error) {
      if (created.isDestroyed()) return
      await created.loadURL(errorPage(undefined, error instanceof Error ? error.message : String(error)))
      created.show()
    }
  })
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

/**
 * Open the workspace when the applied environment matches its declaration,
 * otherwise onboarding. Both branches are guarded by
 * {@link ProvisioningCoordinator.openWorkspaceUnlessQuitting} /
 * {@link ProvisioningCoordinator.openOnboardingUnlessQuitting}: startup calls
 * this directly, and `activate` calls it only after `coordinator.activate`
 * has waited out any in-flight provisioning run — a wait long enough for
 * quit to have begun in the meantime.
 */
async function openInitialSurface(): Promise<void> {
  const dshHome = app.getPath('userData')
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const status = resolveDisciplineStatus(await provisioner(dshHome).applied(), await declarations())
  if (status.kind === 'current') {
    await openWorkspace()
    return
  }
  await coordinator.openOnboardingUnlessQuitting(() => openOnboarding())
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

/**
 * Run a fire-and-forget async action from a synchronous event handler (a
 * menu `click`, for instance, has no way to return a promise Electron would
 * await), logging a failure instead of letting it escape as an unhandled
 * rejection.
 * @param action - the async action to run.
 * @param context - short label identifying the action in the logged error.
 */
function runDetached(action: () => Promise<void>, context: string): void {
  action().catch((error: unknown) => { console.error(`desktop: ${context} failed`, error) })
}

function buildApplicationMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: 'Change Discipline…',
          // Re-provisioning a different revision targets its own
          // revision-scoped prefix path (see provisioning.ts), leaving the
          // currently applied environment untouched and usable until the
          // new revision is itself applied. Re-provisioning the applied
          // revision instead repairs it in place, so ProvisioningCoordinator
          // stops the Host before onboarding opens. It also aborts and
          // awaits any in-flight run first, so clicking mid-download opens
          // onboarding once that run has actually unwound instead of
          // hitting "another operation is running" until it does, and a
          // second click while the first is still unwinding coalesces
          // rather than queuing another open.
          click: () => { runDetached(() => coordinator.changeDiscipline(), 'change discipline') },
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

/**
 * Everything that depends on Electron's app-ready signal: the application
 * menu, IPC handlers, the initial window, and the lifecycle listeners that
 * react to later activation and quit. Run from `app.whenReady().then`
 * rather than a top-level `await app.whenReady()`: on Electron 43.4.1 /
 * macOS 26.5.2 arm64, a top-level await whose continuation is driven by an
 * Electron native signal never resumes (see
 * `.agents/notes/proposed/architecture/2026-08-23-science-desktop-product.md`).
 */
async function boot(): Promise<void> {
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
    // Re-checked after the `declarations()` await: two concurrent
    // `desktop:provision` invocations can both pass the check above before
    // either has set `provisioning`, and a concurrent invocation's own
    // assignment below can land during this one's await.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- a concurrent invocation can set `provisioning` while this one awaits.
    if (provisioning !== undefined) throw new Error('desktop provisioning: another operation is running')
    if (declaration === undefined) throw new Error(`desktop provisioning: unknown environment ${id}`)
    const control = new AbortController()
    provisioning = control
    const run = (async () => {
      await provisioner(app.getPath('userData')).provision(declaration, control.signal, reportProvisioningProgress)
      await openWorkspace()
    })().finally(() => { provisioning = undefined })
    await coordinator.trackRun(run)
  })
  await openInitialSurface().catch(async (error: unknown) => {
    window ??= createWindow()
    await window.loadURL(errorPage(undefined, error instanceof Error ? error.message : String(error)))
  })

  app.on('activate', () => { void handleActivate() })
  app.on('before-quit', (event) => {
    if (coordinator.quitting) return
    event.preventDefault()
    void coordinator.beforeQuit().finally(() => { app.quit() })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/**
 * Reopen the initial surface, but only once any in-flight provisioning run
 * has unwound (see {@link ProvisioningCoordinator.activate}) — blocking
 * reopen until then is simpler than teaching the reopened window to surface
 * someone else's in-flight run.
 */
async function handleActivate(): Promise<void> {
  await coordinator.activate(async () => {
    if (BrowserWindow.getAllWindows().length === 0) await openInitialSurface()
  })
}

app.whenReady().then(boot).catch((error: unknown) => {
  console.error('desktop: boot failed', error)
  app.exit(1)
})
