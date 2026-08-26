/**
 * Files-toggle placement, Host half: validates the `toggleScope` Config
 * field and publishes the resolved placement ahead of every plugin bundle
 * (`webserver/index-inject`), so the browser half's own `apply()` reads it
 * synchronously at boot and decides whether the Files toggle mounts
 * app-globally or stays gated to a Session's own header. No other Host-side
 * behavior; the browser half ships via exports["./client"], discovered
 * through the package.json dsh.client declaration.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { bootToggleScopeInjection } from './boot-toggle-scope.ts'
import { DEFAULT_TOGGLE_SCOPE, TOGGLE_SCOPES, type ToggleScope } from './toggle-scope.ts'

export { TOGGLE_SCOPE_GLOBAL, TOGGLE_SCOPES, type ToggleScope } from './toggle-scope.ts'

/** Plugin config: where this deployment renders the Science Files toggle. */
export interface Config {
  /**
   * `session` (default) gates the toggle to a Science Session's own header,
   * matching the generic Web presentation fence; `global` renders it
   * app-wide, unconditionally, before any workspace is selected.
   */
  toggleScope?: ToggleScope
}

export const Config: z<Config> = z.object({
  toggleScope: z.union([...TOGGLE_SCOPES]).default(DEFAULT_TOGGLE_SCOPE),
})

/**
 * Host plugin body: answer every index-injection collection with the
 * resolved toggle-scope boot global.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config?: Config): void {
  const toggleScope = config?.toggleScope ?? DEFAULT_TOGGLE_SCOPE
  ctx.on('webserver/index-inject', (table) => {
    table.push(bootToggleScopeInjection(toggleScope))
  })
}
