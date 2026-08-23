import { IconDataOutline16, IconGoalOutline16, IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './ScienceDestinations.module.css'

/** Full props for the Science project destination rows. */
export type ScienceDestinationsProps = PropsRuntime<'sidebar.destinations'> & PropsLocale<'science'> & {
  /** Reveal the Science artifact stage for a mounted Session. */
  openScience: (sessionId: SessionId) => void
}

/** Render Sessions, Files, and Outcomes as the project's stable destinations. */
export function ScienceDestinations({ wide, useSessions, openScience, t }: ScienceDestinationsProps) {
  const current = useSessions(state => state.current)
  const destination = (label: string, icon: ReactNode, action?: () => void, active = false) => (
    <button
      type="button"
      className={`${css.row}${wide ? '' : ` ${css.rail}`}${active ? ` ${css.active}` : ''}`}
      aria-label={label}
      title={wide ? undefined : label}
      onClick={action}
    >
      {icon}
      {wide ? <span className={css.label}>{label}</span> : null}
    </button>
  )
  return (
    <div className={css.root}>
      {destination(t('nav.sessions'), <IconNewChatOutline16 />, undefined, true)}
      {destination(t('nav.files'), <IconDataOutline16 />, current === undefined ? undefined : () => { openScience(current) })}
      {destination(t('nav.outcomes'), <IconGoalOutline16 />, current === undefined ? undefined : () => { openScience(current) })}
    </div>
  )
}
