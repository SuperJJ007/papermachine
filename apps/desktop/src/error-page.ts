/** The desktop shell's data-URL error pages: pure HTML rendering, no Electron runtime dependency. */

import type { HostExit } from './host-process.ts'
import { HarnessHomeSpaceError } from './harness-home.ts'

/** In-app protocol the error page's "Restart Host" link navigates to; `main.ts` intercepts it. */
export const RESTART_URL = 'dsh-desktop://restart'
/**
 * In-app protocol {@link installLocationUnavailableErrorPage}'s "Use default
 * location" link navigates to; `main.ts` intercepts it, clearing the
 * install-location pointer and relaunching.
 */
export const USE_DEFAULT_INSTALL_LOCATION_URL = 'dsh-desktop://use-default-install-location'
/** In-app protocol {@link installLocationUnavailableErrorPage}'s "Quit" link navigates to; `main.ts` intercepts it. */
export const QUIT_URL = 'dsh-desktop://quit'

/** One action link an error page offers: a label and the in-app protocol URL it navigates to. */
export interface ErrorPageAction {
  readonly label: string
  readonly href: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string)
}

/**
 * Render one of the app's data-URL error pages.
 * @param heading - the page's `<h1>`.
 * @param detail - the page's `<p>` body.
 * @param actions - the action links to render, in order; empty for a
 *   startup configuration failure no button here can fix.
 * @param logPath - the resolved Host stderr log path to name, when known;
 *   omitted before `main.ts`'s `hostLogPath` resolves (the brief startup
 *   window before `boot()` sets it) or for a failure that predates any Host
 *   log.
 * @returns a `data:text/html` URL ready to load.
 */
export function errorSurface(heading: string, detail: string, actions: readonly ErrorPageAction[], logPath?: string): string {
  const links = actions.map(action => `<a href="${action.href}">${escapeHtml(action.label)}</a>`).join('')
  const log = logPath === undefined ? '' : `<p class="log">Host log: <code>${escapeHtml(logPath)}</code></p>`
  const html = `<!doctype html><html><meta charset="utf-8"><title>PaperMachine</title>
    <style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f7fa;color:#16202a}main{max-width:34rem;padding:2rem;text-align:center}a{display:inline-block;margin-top:1rem;margin-right:.5rem;padding:.7rem 1rem;border-radius:.5rem;background:#1769aa;color:white;text-decoration:none}.log{font-size:.85rem;color:#4b5a68}.log code{font-family:ui-monospace,monospace;word-break:break-all}</style>
    <main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(detail)}</p>${log}${links}</main></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * The general Host error page: an unexpected exit (with its code/signal) or
 * a caught launch failure (with its message).
 * @param logPath - the resolved Host stderr log path, when known.
 * @param exit - the Host's own exit status, when the failure is a process
 *   exit rather than a caught launch error.
 * @param reason - a caught launch error's message, when the failure is not
 *   a process exit.
 * @returns a `data:text/html` URL ready to load.
 */
export function errorPage(logPath: string | undefined, exit?: HostExit, reason?: string): string {
  const detail = reason ?? (exit === undefined
    ? 'Host unavailable'
    : `Host stopped (${String(exit.code ?? exit.signal)})`)
  return errorSurface('Science Host needs attention', detail, [{ label: 'Restart Host', href: RESTART_URL }], logPath)
}

/**
 * The dedicated error page for a space-containing Harness home: a startup
 * configuration failure, not a Host crash, so the ordinary Restart Host
 * action — which would relaunch the Host against the same unusable path —
 * is omitted, and no Host log path is named (the Host never launched).
 * @param error - the resolved space-containing path this launch could not use.
 * @returns a `data:text/html` URL ready to load.
 */
export function harnessHomeSpaceErrorPage(error: HarnessHomeSpaceError): string {
  return errorSurface(
    'PaperMachine cannot start',
    `Your user home directory's path contains a space ("${error.path}"). R cannot run with a space in its scratch directory, so PaperMachine cannot run science kernels from this location.`,
    [],
  )
}

/**
 * The dedicated error page for a launch whose install-location pointer names
 * a target this launch cannot reach — an unplugged drive, an unmounted
 * network share, or a permission change — a startup configuration failure,
 * not a Host crash, so the ordinary Restart Host action (which would
 * relaunch against the same unreachable pointer) is replaced with a
 * self-rescue action that clears the pointer and relaunches against the
 * default Harness home.
 * @param pointerPath - the install-location pointer file's path, named so
 *   the user can also delete it manually.
 * @param target - the pointer's unreachable target directory.
 * @param reason - the underlying resolution failure's message.
 * @returns a `data:text/html` URL ready to load.
 */
export function installLocationUnavailableErrorPage(pointerPath: string, target: string, reason: string): string {
  return errorSurface(
    'PaperMachine cannot reach its install location',
    `The install location "${target}" is not available right now (${reason}). Delete "${pointerPath}" or use the button below to return to the default location.`,
    [
      { label: 'Use default location', href: USE_DEFAULT_INSTALL_LOCATION_URL },
      { label: 'Quit', href: QUIT_URL },
    ],
  )
}

/**
 * The error page to show for a caught startup/launch failure: the dedicated
 * space-in-home page for {@link HarnessHomeSpaceError}, otherwise the
 * general Host error page.
 * @param logPath - the resolved Host stderr log path, when known.
 * @param error - the caught error.
 * @returns a `data:text/html` URL ready to load.
 */
export function launchErrorPage(logPath: string | undefined, error: unknown): string {
  return error instanceof HarnessHomeSpaceError
    ? harnessHomeSpaceErrorPage(error)
    : errorPage(logPath, undefined, error instanceof Error ? error.message : String(error))
}
