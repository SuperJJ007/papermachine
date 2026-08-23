/** Root-level Files control shown while no active Session owns the header. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ScienceFilesButton } from './ScienceHeaderAction.tsx'

/** Full props for the root-level Files action. */
export type ScienceHeroActionProps = PropsRuntime<'conversation.page.utilities'> & PropsLocale<'science'>

/**
 * Keep one Files entry: the Session header owns it once a non-blank Session
 * is active, so this one only ever covers a blank (not-yet-started) current
 * Session — gated on that Session's own Science composition, like every
 * other Science surface (`ScienceHeaderAction`, `ScienceDestinations`), not
 * shown for a blank Session running any other preset or for no Session at all.
 */
export function ScienceHeroAction({ useSessions, toggleDetails, t }: ScienceHeroActionProps) {
  const showFilesButton = useSessions((state) => {
    const current = state.current
    if (current === undefined) return false
    const session = state.byId[current]
    return session?.blank === true && session.agentPreset === 'science'
  })
  if (!showFilesButton) return null
  return <ScienceFilesButton onClick={toggleDetails} t={t} />
}
