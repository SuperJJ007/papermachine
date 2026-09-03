/** Desktop-owned Host composition applied above the generic Web bundle. */

/**
 * Fixed deadline for one `install_science_packages` micromamba
 * solve/install attempt, matching the bound this Host's own provisioning
 * already gives the same micromamba work (`custom-environment.ts`'s
 * `TIMEOUT_MS`, `resources/environments/general.json`'s `timeoutMs`):
 * `science-runtime`'s generic `timeoutMs` (120s) is sized for a bind or run,
 * not a package solve, which routinely takes minutes.
 */
const INSTALL_TIMEOUT_MS = 3_600_000

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
  /**
   * Absolute path to the app-bundled default Science skills
   * (`resources/skills`, staged from `process.resourcesPath` by `main.ts`).
   */
  readonly skillsRoot: string
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
 * the generic Web session-gated placement to distinguish. The overlay also
 * swaps the brand-slot occupant: it disables `ui-brand-official` and enables
 * `ui-brand-papermachine`, since the sidebar and hero brand slots are
 * `single` and reject two same-priority registrations.
 *
 * It also re-enables the base bundle's host-plane `skill-filesystem` row
 * (disabled there because the `science` agent preset owns its own
 * project/custom/user discovery in the preset's own scope layer — see
 * `apps/cli/config/agent-presets/science/agent.cordis.yml`) as an isolated,
 * globally-scoped provider that discovers only `input.skillsRoot`
 * (`includeDefaultRoots: false`, so it does not re-scan the roots the
 * preset's own row already covers). `dsh-skill`'s registry resolves a
 * duplicate skill name by nearest scope layer first: the preset's layer is
 * nearer than this row's global layer, so a user skill under
 * `~/.papermachine/skills` (the preset row's `user-dsh` root) always wins
 * over a same-named bundled one, regardless of either root's discovery rank.
 * @param input - the prefix(es) to bind, the micromamba executable, the
 *   ordered install channels, and the bundled skills root.
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
  return `- id: science-runtime\n  config:\n    micromambaPath: ${JSON.stringify(input.micromambaPath)}\n    installChannels:\n${channels}\n    installTimeoutMs: ${String(INSTALL_TIMEOUT_MS)}\n    profiles:\n      science:\n${fields}\n- id: agent-presets\n  config:\n    default: science\n- id: ui-agent-preset\n  disabled: true\n- id: ui-science\n  config:\n    toggleScope: global\n- id: hmr\n  disabled: true\n- id: ui-brand-official\n  disabled: true\n- id: ui-brand-papermachine\n  disabled: false\n- id: skill-filesystem\n  disabled: false\n  config:\n    providerName: bundled-skills\n    includeDefaultRoots: false\n    bundledSkillDir: ${JSON.stringify(input.skillsRoot)}\n`
}
