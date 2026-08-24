// App-global Files control: the desktop composition's sole owner of the
// toggle when `toggleScope: 'global'` (see `../toggle-scope.ts` and
// `index.ts`) — rendered from before any workspace is selected and before
// any Session exists, and unconditionally through every later Session state.

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ScienceFilesButton } from './ScienceHeaderAction.tsx'

/** Full props for the app-global Files action. */
export type ScienceGlobalToggleProps = PropsRuntime<'conversation.page.utilities'> & PropsLocale<'science'>

/**
 * Render the Files control unconditionally. This is the toggle's one and
 * only registration in the `global` placement: the session-header
 * registration (`ScienceHeaderAction`) is not mounted alongside it, so no
 * Session state gates this button and no second control can ever appear
 * beside it.
 * @param props - toggle handler and Science translator.
 * @returns the localized Files button, always.
 */
export function ScienceGlobalToggle({ toggleDetails, t }: ScienceGlobalToggleProps) {
  return <ScienceFilesButton onClick={toggleDetails} t={t} />
}
