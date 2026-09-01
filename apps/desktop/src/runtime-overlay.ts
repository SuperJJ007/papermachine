/** Desktop-owned Host composition applied above the generic Web bundle. */

/**
 * The Runtime facts the overlay carries into the Host: the prefix(es) bound
 * into the `science` profile (at least one is required), the bundled
 * micromamba executable, and the ordered install channels — the two
 * `science-runtime` fields `install_science_packages` requires together.
 */
export interface RuntimeOverlayInput {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
  /** Absolute path to the bundled micromamba executable the Host installs packages with. */
  readonly micromambaPath: string
  /**
   * Ordered, non-empty conda channel URLs the Host tries as whole,
   * independent `micromamba install` attempts: the bound source's channels
   * first, then the remaining shipped sources in declaration order
   * (`writeRuntimeOverlay` in `main.ts` decides the order).
   */
  readonly installChannels: readonly string[]
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
 * @param input - the prefix(es) to bind, the micromamba executable, and the
 *   ordered install channels.
 * @throws when neither prefix is present or `installChannels` is empty.
 */
export function renderDesktopRuntimeOverlay(input: RuntimeOverlayInput): string {
  if (input.pythonPrefix === undefined && input.rPrefix === undefined) {
    throw new Error('desktop runtime overlay: requires pythonPrefix or rPrefix')
  }
  if (input.installChannels.length === 0) {
    throw new Error('desktop runtime overlay: requires at least one install channel')
  }
  const fields = [
    ...(input.pythonPrefix === undefined ? [] : [`        pythonPrefix: ${JSON.stringify(input.pythonPrefix)}`]),
    ...(input.rPrefix === undefined ? [] : [`        rPrefix: ${JSON.stringify(input.rPrefix)}`]),
  ].join('\n')
  const channels = input.installChannels.map(url => `      - ${JSON.stringify(url)}`).join('\n')
  return `- id: science-runtime\n  config:\n    micromambaPath: ${JSON.stringify(input.micromambaPath)}\n    installChannels:\n${channels}\n    profiles:\n      science:\n${fields}\n- id: agent-presets\n  config:\n    default: science\n- id: ui-agent-preset\n  disabled: true\n- id: ui-science\n  config:\n    toggleScope: global\n- id: hmr\n  disabled: true\n`
}
