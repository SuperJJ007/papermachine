/** Desktop-owned Host composition applied above the generic Web bundle. */

/** The prefix(es) to bind into the `science` profile; at least one is required. */
export interface RuntimeOverlayPrefixes {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
}

/**
 * Render the immutable Science product and bound Runtime overlay. Also
 * disables the shared module-reload `hmr` row: the web bundle already
 * disables it (its reload lifecycle is untested there), and this overlay
 * restates the disable so the row stays off for the desktop Host even if a
 * later web-bundle change re-enables it. Module-reload HMR cannot run under
 * Electron's forked Node in any case — it lacks the Node internals access
 * (`--expose-internals` or a working `node-addon-require-builtin`) the
 * plugin's constructor requires — so an enabled row would crash the Host at
 * apply time; `apps/cli/src/profile-boot.ts`'s `canMountConfigHmr` separately
 * covers the launcher's own config-only HMR fallback, which does not go
 * through this row. The `ui-science` row's `toggleScope: global` makes the
 * Files toggle render app-wide (`packages/client/ui-science/src/toggle-scope.ts`)
 * — appropriate because this same overlay already forces Science as the
 * product default (`agent-presets`), so there is no other-preset session for
 * the generic Web session-gated placement to distinguish.
 * @param prefixes - the Python and/or R prefix to bind; at least one is required.
 * @throws when neither prefix is present.
 */
export function renderDesktopRuntimeOverlay(prefixes: RuntimeOverlayPrefixes): string {
  if (prefixes.pythonPrefix === undefined && prefixes.rPrefix === undefined) {
    throw new Error('desktop runtime overlay: requires pythonPrefix or rPrefix')
  }
  const fields = [
    ...(prefixes.pythonPrefix === undefined ? [] : [`        pythonPrefix: ${JSON.stringify(prefixes.pythonPrefix)}`]),
    ...(prefixes.rPrefix === undefined ? [] : [`        rPrefix: ${JSON.stringify(prefixes.rPrefix)}`]),
  ].join('\n')
  return `- id: science-runtime\n  config:\n    profiles:\n      science:\n${fields}\n- id: agent-presets\n  config:\n    default: science\n- id: ui-agent-preset\n  disabled: true\n- id: ui-science\n  config:\n    toggleScope: global\n- id: hmr\n  disabled: true\n`
}
