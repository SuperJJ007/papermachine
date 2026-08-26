/** Trajectory tab shell selecting among plugin-contributed visualizations. */

import { useEffect, useId, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectorySubviewEntry } from './trajectory-subviews.ts'
import css from './TrajectoryShell.module.css'

/** Registration-side directory of visible subviews for the addressed Session. */
export interface TrajectoryShellInjected {
  hooks: {
    views: HostObservable<readonly TrajectorySubviewEntry[]>
    selection: HostObservable<string | null>
  }
  select: (id: string) => void
}

/** Renderer props for the outer Trajectory conversation tab. */
export type TrajectoryShellProps = PropsRuntime<'conversation.view'>
  & PropsRenderSlots<'trajectory.view'>
  & PropsLocale<'trajectory'>
  & InjectFace<TrajectoryShellInjected>

/** Render the first ordered subview by default and preserve visited subview state. */
export function TrajectoryShell({
  inspect, onInspectDone, inspectCall, renderSlot, useViews, useSelection, select, t,
}: TrajectoryShellProps & ConvViewOwnerProps) {
  const tabsId = useId()
  const rows = useViews(value => value)
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  const selectedId = useSelection(value => value)
  const active = rows.find(row => row.id === selectedId)?.id ?? rows[0]?.id

  useEffect(() => {
    if (active === undefined) return
    setVisitedIds(previous => previous.has(active) ? previous : new Set([...previous, active]))
  }, [active])

  if (active === undefined) return null
  const owner: ConvViewOwnerProps = {
    ...(inspect === undefined ? {} : { inspect }),
    ...(onInspectDone === undefined ? {} : { onInspectDone }),
    inspectCall,
  }
  return (
    <section className={css.root}>
      {rows.length > 1 && (
        <div className={css.switcher} role="tablist" aria-label={t('view.switcher')}>
          {rows.map(row => (
            <button key={row.id} id={`${tabsId}-tab-${row.id}`} type="button" role="tab"
              className={css.tab} aria-selected={row.id === active} data-active={row.id === active ? 'true' : undefined}
              aria-controls={`${tabsId}-panel-${row.id}`} onClick={() => { select(row.id) }}>
              {row.label}
            </button>
          ))}
        </div>
      )}
      {rows.filter(row => row.id === active || visitedIds.has(row.id)).map(row => (
        <div key={row.id} id={`${tabsId}-panel-${row.id}`} className={css.panel}
          {...rows.length > 1 ? { role: 'tabpanel', 'aria-labelledby': `${tabsId}-tab-${row.id}` } : {}}
          hidden={row.id !== active}>
          {renderSlot('trajectory.view', owner, { only: row.id })}
        </div>
      ))}
    </section>
  )
}
