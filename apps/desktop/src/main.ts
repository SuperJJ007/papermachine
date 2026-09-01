/** Electron development shell for the Science desktop product. */

import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import type { HostCommand, HostExit } from './host-process.ts'
import { HostLifecycle } from './host-lifecycle.ts'
import { parseEnvironmentDeclaration, type DesktopPlatform, type EnvironmentDeclaration } from './environment-declaration.ts'
import { DesktopEnvironmentProvisioner, desktopEnvironmentsRoot, type ProvisioningProgress } from './provisioning.ts'
import { renderDesktopRuntimeOverlay } from './runtime-overlay.ts'
import { ProvisioningCoordinator } from './provisioning-coordination.ts'
import { qualifyingInterpreters } from './interpreter-presence.ts'
import { resolveBindRequest, resolveEnvironmentBindingStatus, writeEnvironmentBinding, type EnvironmentBinding } from './environment-binding.ts'
import { launchHostOnRememberedPort } from './host-launch.ts'
import { HarnessHomeSpaceError, resolveHarnessHome } from './harness-home.ts'
import { buildCustomDeclaration, readCustomDeclaration, writeCustomDeclaration } from './custom-environment.ts'
import { resolveDefaultSourceId, type LocaleSignals } from './source-selection.ts'

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
// Set immediately before an `openOnboarding` call that must surface a loud
// status (an invalid/corrupt binding at launch); consumed once by the
// `desktop:onboarding-status` handler so the freshly loaded onboarding
// document can display it. `undefined` for an ordinary first-run or
// user-requested ("Change Environment…") open.
let onboardingStatus: string | undefined

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
// waiting for it before "Change Environment…" opens onboarding, `activate`
// waiting for it, and `before-quit` waiting for it alongside the Host stop.
const coordinator = new ProvisioningCoordinator({
  abort: () => { provisioning?.abort() },
  stopHost: () => hostLifecycle.stop(),
  openOnboarding: () => openOnboarding(),
})

function resourceRoot(): string {
  return app.isPackaged ? process.resourcesPath : join(REPOSITORY_ROOT, 'apps/desktop/resources')
}

/** Resolves and creates this launch's Harness home; see {@link resolveHarnessHome}. */
async function harnessHome(): Promise<string> {
  return resolveHarnessHome(app.getPath('home'))
}

function desktopPlatform(): DesktopPlatform {
  if (process.platform !== 'darwin' || (process.arch !== 'arm64' && process.arch !== 'x64')) {
    throw new Error(`desktop: unsupported platform ${process.platform}-${process.arch}`)
  }
  return `darwin-${process.arch}`
}

/** The one environment this build ships; disciplines are added as further declarations. */
const SHIPPED_ENVIRONMENT_ID = 'general'

/** Read the shipped declaration; the standard package set onboarding offers and the custom editor starts from. */
async function shippedDeclaration(): Promise<EnvironmentDeclaration> {
  return parseEnvironmentDeclaration(
    JSON.parse(await readFile(join(resourceRoot(), 'environments', `${SHIPPED_ENVIRONMENT_ID}.json`), 'utf8')),
  )
}

/**
 * Every declaration this launch can resolve an applied environment against:
 * the shipped one, plus the user's own package set once they have authored
 * one. The custom declaration must be included for `resolveDisciplineStatus`
 * to report `current` for a working custom install rather than
 * `unknown-discipline`.
 */
async function declarations(dshHome: string): Promise<readonly EnvironmentDeclaration[]> {
  const custom = await readCustomDeclaration(desktopEnvironmentsRoot(dshHome))
  return [await shippedDeclaration(), ...(custom === undefined ? [] : [custom])]
}

function provisioner(dshHome: string): DesktopEnvironmentProvisioner {
  const platform = desktopPlatform()
  return new DesktopEnvironmentProvisioner({
    root: desktopEnvironmentsRoot(dshHome),
    micromambaPath: join(resourceRoot(), 'bin', platform, 'micromamba'),
    platform,
  })
}

/**
 * The system locale signals {@link resolveDefaultSourceId} decides the
 * confirmation panel's default package source from — deterministic system
 * settings only, never a network reachability probe.
 */
function localeSignals(): LocaleSignals {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: app.getPreferredSystemLanguages(),
  }
}

/**
 * Bind the prefix a provisioning run just published, so the workspace it
 * opens finds a bound environment. One provisioned prefix carries both
 * interpreters, and routing through `resolveBindRequest` re-checks each of
 * them at the same seam the detect-and-bind path uses instead of trusting
 * the run's own health checks a second time.
 * @param dshHome - the Harness home the binding is scoped to.
 * @param prefix - the published environment prefix.
 */
async function bindProvisionedPrefix(dshHome: string, prefix: string): Promise<void> {
  const binding = await resolveBindRequest({ pythonPrefix: prefix, rPrefix: prefix }, qualifyingInterpreters)
  await writeEnvironmentBinding(dshHome, binding)
}

/**
 * Start one provisioning run and open the workspace on the environment it
 * publishes. The in-flight check and its `provisioning` assignment run
 * before this function's first await, so two invocations racing from the
 * renderer cannot both claim the slot.
 * @param dshHome - the Harness home the run binds into.
 * @param declaration - the environment to provision.
 * @param sourceId - the package source to try first; `undefined` starts
 *   from `declaration.sources`' own order.
 * @throws when another provisioning run is already in flight.
 */
async function startProvisioning(dshHome: string, declaration: EnvironmentDeclaration, sourceId: string | undefined): Promise<void> {
  if (provisioning !== undefined) throw new Error('desktop provisioning: another operation is running')
  const control = new AbortController()
  provisioning = control
  const run = (async () => {
    const published = await provisioner(dshHome).provision(declaration, control.signal, reportProvisioningProgress, sourceId)
    await bindProvisionedPrefix(dshHome, published.prefix)
    await openWorkspace()
  })().finally(() => { provisioning = undefined })
  await coordinator.trackRun(run)
}

async function writeRuntimeOverlay(dshHome: string, binding: EnvironmentBinding): Promise<string> {
  const overlay = join(dshHome, 'desktop-science.cordis.patch.yml')
  await writeFile(overlay, renderDesktopRuntimeOverlay(binding), { mode: 0o600 })
  return overlay
}

function hostCommand(dshHome: string, overlay: string, port: number): HostCommand {
  const packagedHost = join(process.resourcesPath, 'host')
  return {
    executable: process.execPath,
    args: [
      ...(app.isPackaged
        ? [join(packagedHost, 'lib/bin.js')]
        : ['--import', 'tsx/esm', join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')]),
      '--profile', 'web',
      '--patch', overlay,
      '--port', String(port),
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

/**
 * Render one of the app's data-URL error pages.
 * @param heading - the page's `<h1>`.
 * @param detail - the page's `<p>` body.
 * @param restart - whether to show the "Restart Host" action; omitted for a
 *   startup configuration failure a Host restart cannot fix.
 */
function errorSurface(heading: string, detail: string, restart: boolean): string {
  const action = restart ? `<a href="${RESTART_URL}">Restart Host</a>` : ''
  const html = `<!doctype html><html><meta charset="utf-8"><title>PaperMachine</title>
    <style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f7fa;color:#16202a}main{max-width:34rem;padding:2rem;text-align:center}a{display:inline-block;margin-top:1rem;padding:.7rem 1rem;border-radius:.5rem;background:#1769aa;color:white;text-decoration:none}</style>
    <main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(detail)}</p>${action}</main></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function errorPage(exit?: HostExit, reason?: string): string {
  const detail = reason ?? (exit === undefined
    ? 'Host unavailable'
    : `Host stopped (${String(exit.code ?? exit.signal)})`)
  return errorSurface('Science Host needs attention', detail, true)
}

/**
 * The dedicated error page for a space-containing Harness home: a startup
 * configuration failure, not a Host crash, so the ordinary Restart Host
 * action — which would relaunch the Host against the same unusable path —
 * is omitted.
 * @param error - the resolved space-containing path this launch could not use.
 */
function harnessHomeSpaceErrorPage(error: HarnessHomeSpaceError): string {
  return errorSurface(
    'PaperMachine cannot start',
    `Your user home directory's path contains a space ("${error.path}"). R cannot run with a space in its scratch directory, so PaperMachine cannot run science kernels from this location.`,
    false,
  )
}

/**
 * The error page to show for a caught startup/launch failure: the dedicated
 * space-in-home page for {@link HarnessHomeSpaceError}, otherwise the
 * general Host error page.
 * @param error - the caught error.
 */
function launchErrorPage(error: unknown): string {
  return error instanceof HarnessHomeSpaceError
    ? harnessHomeSpaceErrorPage(error)
    : errorPage(undefined, error instanceof Error ? error.message : String(error))
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
    title: 'Set up PaperMachine',
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
  const dshHome = await harnessHome()
  const status = await resolveEnvironmentBindingStatus(dshHome)
  if (status.kind !== 'bound') throw new Error('desktop host: no bound Science environment')
  const overlay = await writeRuntimeOverlay(dshHome, status.binding)
  const url = await launchHostOnRememberedPort(
    dshHome,
    port => hostLifecycle.launch(hostCommand(dshHome, overlay, port), onUnexpectedHostExit),
  )
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
      await created.loadURL(launchErrorPage(error))
      created.show()
    }
  })
}

/**
 * Open the onboarding window (conda-family environment detection and
 * binding), replacing whatever window is active. Closing this window
 * (Cmd-Q, the red button, or a completed run destroying it programmatically)
 * aborts any in-flight provisioning — the retained, entry-less micromamba
 * path's `desktop:provision` handler stays registered — so Cmd-Q mid-run
 * never orphans a download process group; aborting an already-settled or
 * absent run is a no-op.
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
 * Open the workspace when a valid environment binding exists, otherwise
 * onboarding. A binding that fails to parse or names a prefix that has
 * since disappeared routes to onboarding with a loud status message via
 * {@link onboardingStatus} rather than being treated as an ordinary
 * first run. Both branches are guarded by
 * {@link ProvisioningCoordinator.openWorkspaceUnlessQuitting} /
 * {@link ProvisioningCoordinator.openOnboardingUnlessQuitting}: startup calls
 * this directly, and `activate` calls it only after `coordinator.activate`
 * has waited out any in-flight provisioning run — a wait long enough for
 * quit to have begun in the meantime.
 */
async function openInitialSurface(): Promise<void> {
  const dshHome = await harnessHome()
  const status = await resolveEnvironmentBindingStatus(dshHome)
  if (status.kind === 'bound') {
    await openWorkspace()
    return
  }
  await coordinator.openOnboardingUnlessQuitting(async () => {
    onboardingStatus = status.kind === 'invalid' ? status.reason : undefined
    await openOnboarding()
  })
}

async function restartHost(): Promise<void> {
  activeOrigin = undefined
  try {
    // launchHost -> HostLifecycle.launch stops the currently active Host and
    // watchdog before starting the replacement.
    await launchHost()
  } catch (error) {
    await window?.loadURL(launchErrorPage(error))
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
          label: 'Change Environment…',
          // Opens onboarding so the user can install a different
          // environment, or reinstall the current one after a repair. A
          // live Host would otherwise keep running against the prefix
          // onboarding is about to replace, so ProvisioningCoordinator stops
          // the Host before onboarding opens. It also aborts and awaits any
          // in-flight run first, so clicking mid-run opens onboarding once
          // that run has actually unwound instead of hitting "another
          // operation is running" until it does, and a second click while
          // the first is still unwinding coalesces rather than queuing
          // another open.
          click: () => { runDetached(() => coordinator.changeDiscipline(), 'change environment') },
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

app.setName('PaperMachine')

/**
 * Everything that depends on Electron's app-ready signal: the application
 * menu, IPC handlers, the initial window, and the lifecycle listeners that
 * react to later activation and quit. Run from `app.whenReady().then`
 * rather than a top-level `await app.whenReady()`: on Electron 43.4.1 /
 * macOS 26.5.2 arm64, a top-level await whose continuation is driven by an
 * Electron native signal never resumes (see the "Electron main-process boot
 * order" section of the "Science desktop product composition and
 * provisioning" Agent Note, 2026-08-23).
 */
async function boot(): Promise<void> {
  Menu.setApplicationMenu(buildApplicationMenu())
  ipcMain.handle('desktop:environments', async () => {
    const signals = localeSignals()
    return (await declarations(await harnessHome())).map(item => ({
      id: item.id,
      name: item.name,
      revision: item.revision,
      packages: item.packages,
      estimatedDownloadBytes: item.estimatedDownloadBytes,
      requiredFreeBytes: item.requiredFreeBytes,
      sources: item.sources.map(source => ({ id: source.id, name: source.name })),
      defaultSourceId: resolveDefaultSourceId(item.sources, signals),
    }))
  })
  ipcMain.handle('desktop:onboarding-status', () => {
    const value = onboardingStatus
    onboardingStatus = undefined
    return value
  })
  ipcMain.handle('desktop:cancel-provisioning', () => { provisioning?.abort() })
  ipcMain.handle('desktop:provision', async (_event, id: unknown, sourceId: unknown) => {
    if (typeof id !== 'string') throw new Error('desktop provisioning: environment id must be a string')
    if (sourceId !== undefined && typeof sourceId !== 'string') throw new Error('desktop provisioning: sourceId must be a string')
    const dshHome = await harnessHome()
    const declaration = (await declarations(dshHome)).find(item => item.id === id)
    if (declaration === undefined) throw new Error(`desktop provisioning: unknown environment ${id}`)
    await startProvisioning(dshHome, declaration, sourceId)
  })
  ipcMain.handle('desktop:provision-custom', async (_event, packages: unknown, sourceId: unknown) => {
    if (!Array.isArray(packages) || packages.some(item => typeof item !== 'string')) {
      throw new Error('desktop provisioning: custom packages must be a string array')
    }
    if (sourceId !== undefined && typeof sourceId !== 'string') throw new Error('desktop provisioning: sourceId must be a string')
    const dshHome = await harnessHome()
    // buildCustomDeclaration validates every token before it can reach the
    // solver's argv; persisting only after that keeps an unusable set out of
    // the file the next launch resolves the applied environment against.
    const declaration = buildCustomDeclaration(packages as string[], [desktopPlatform()], (await shippedDeclaration()).sources)
    await writeCustomDeclaration(desktopEnvironmentsRoot(dshHome), declaration)
    await startProvisioning(dshHome, declaration, sourceId)
  })
  await openInitialSurface().catch(async (error: unknown) => {
    window ??= createWindow()
    await window.loadURL(launchErrorPage(error))
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
