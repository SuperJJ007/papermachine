import { IconDataOutline16, IconGoalOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './ScienceDestinations.module.css'

/** Full props for the Science project destination rows. */
export type ScienceDestinationsProps = PropsRuntime<'sidebar.destinations'> & PropsLocale<'science'> & {
  /** Reveal the Science artifact stage for a mounted Session. */
  openScience: (sessionId: SessionId, destination: 'files' | 'outcomes') => void
}

/** Render distinct Files and Outcomes destinations only for the current Science Session. */
export function ScienceDestinations({ wide, useSessions, openScience, t }: ScienceDestinationsProps) {
  const current = useSessions(state => state.current)
  const science = useSessions(state => current !== undefined && state.byId[current]?.agentPreset === 'science')
  if (!science || current === undefined) return null
  const destination = (label: string, icon: ReactNode, action: () => void) => (
    <button
      type="button"
      className={`${css.row}${wide ? '' : ` ${css.rail}`}`}
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
      {destination(t('nav.files'), <IconDataOutline16 />, () => { openScience(current, 'files') })}
      {destination(t('nav.outcomes'), <IconGoalOutline16 />, () => { openScience(current, 'outcomes') })}
    </div>
  )
}
