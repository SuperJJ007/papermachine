/** The desktop shell's data-URL error pages: pure HTML rendering, no Electron runtime dependency. */

import type { HostExit } from './host-process.ts'
import { HarnessHomeSpaceError } from './harness-home.ts'

/** In-app protocol the error page's "Restart Host" link navigates to; `main.ts` intercepts it. */
export const RESTART_URL = 'dsh-desktop://restart'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string)
}

/**
 * Render one of the app's data-URL error pages.
 * @param heading - the page's `<h1>`.
 * @param detail - the page's `<p>` body.
 * @param restart - whether to show the "Restart Host" action; omitted for a
 *   startup configuration failure a Host restart cannot fix.
 * @param logPath - the resolved Host stderr log path to name, when known;
 *   omitted before `main.ts`'s `hostLogPath` resolves (the brief startup
 *   window before `boot()` sets it) or for a failure that predates any Host
 *   log.
 * @returns a `data:text/html` URL ready to load.
 */
export function errorSurface(heading: string, detail: string, restart: boolean, logPath?: string): string {
  const action = restart ? `<a href="${RESTART_URL}">Restart Host</a>` : ''
  const log = logPath === undefined ? '' : `<p class="log">Host log: <code>${escapeHtml(logPath)}</code></p>`
  const html = `<!doctype html><html><meta charset="utf-8"><title>PaperMachine</title>
    <style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f7fa;color:#16202a}main{max-width:34rem;padding:2rem;text-align:center}a{display:inline-block;margin-top:1rem;padding:.7rem 1rem;border-radius:.5rem;background:#1769aa;color:white;text-decoration:none}.log{font-size:.85rem;color:#4b5a68}.log code{font-family:ui-monospace,monospace;word-break:break-all}</style>
    <main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(detail)}</p>${log}${action}</main></html>`
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
  return errorSurface('Science Host needs attention', detail, true, logPath)
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
    false,
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
