/** Root-level Files control shown while no active Session owns the header. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ScienceFilesButton } from './ScienceHeaderAction.tsx'

/** Full props for the root-level Files action. */
export type ScienceHeroActionProps = PropsRuntime<'conversation.page.utilities'> & PropsLocale<'science'>

/** Keep one Files entry: the Session header owns it once a non-blank Session is active. */
export function ScienceHeroAction({ useSessions, toggleDetails, t }: ScienceHeroActionProps) {
  const hasActiveSession = useSessions((state) => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === false
  })
  if (hasActiveSession) return null
  return <ScienceFilesButton onClick={toggleDetails} t={t} />
}
