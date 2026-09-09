/**
 * Files-toggle placement as an index-injection row: a `globalThis`
 * assignment rendered ahead of every plugin bundle script, mirroring
 * `dsh-client-ui-theme`'s own boot-value injection.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { TOGGLE_SCOPE_GLOBAL, type ToggleScope } from './toggle-scope.ts'

/**
 * Build the boot-global injection row for one resolved placement.
 * @param toggleScope - this deployment's resolved Files-toggle placement.
 * @returns the `global` injection row.
 */
export function bootToggleScopeInjection(toggleScope: ToggleScope): IndexInjection {
  return { kind: 'global', name: TOGGLE_SCOPE_GLOBAL, value: toggleScope }
}
