// DetailsPanel: the Details column's generic routing shell — close button,
// title chrome, and dispatch of the selected `conversation.details.view`
// entry. The built-in `tool` entry (ToolDetailsView) keeps this shell's
// former per-call title text (the selected tool's name) since that entry is
// the one this package has always known about; every other entry's title
// falls back to its registered label. Between the title and the close
// button, the shell also dispatches the active entry's own keyed
// `conversation.details.header.actions` entry (entryKey: <active id>), so an
// entry contributes its own header controls while the shell keeps owning
// close. Reads selection/entries off the shared chat store and slot registry
// (conversation writes, this panel reads — the cross-registration share the
// store seat exists for) and derives no data of its own.

import { useSyncExternalStore } from 'react'
import type { DetailsViewEntry } from '../contract/views.ts'
import type { DetailsSlotProps } from '../contract/slots.ts'
import { materialFor } from './ToolDetailsView.tsx'
import css from './DetailsPanel.module.css'

/** Full props composed by reference from the contract (automatic shares & injected share). */
export type DetailsPanelProps = DetailsSlotProps

/** Built-in Details entry id whose title stays the selected call's name instead of its registered label. */
const TOOL_VIEW_ID = 'tool'

/** Resolve by id and keep stale/unregistered selections on the built-in `tool` fallback. */
function resolveActiveDetailsView(entries: readonly DetailsViewEntry[], selectedId: string | null): DetailsViewEntry | undefined {
  const requestedId = selectedId ?? TOOL_VIEW_ID
  return entries.find(entry => entry.id === requestedId)
    ?? entries.find(entry => entry.id === TOOL_VIEW_ID)
}

export function DetailsPanel({ useSession, useStore, actions, renderSlot, closeDetails, views, t }: DetailsPanelProps) {
  useSyncExternalStore(views.subscribe, views.version)
  const entries = views.list()
  const selectedId = useStore(s => s.detailsView)
  const active = resolveActiveDetailsView(entries, selectedId)
  const isTool = active?.id === TOOL_VIEW_ID

  const selection = useStore(s => s.selection)
  const callId = isTool ? selection?.callId : undefined
  const materialName = useSession(s => (callId === undefined ? undefined : materialFor(s, callId)?.name))

  const title = isTool
    ? (materialName ?? selection?.toolName ?? t('details.title'))
    : (active?.label ?? t('details.title'))

  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.title}>{title}</div>
        {active !== undefined && (
          <div className={css.actions}>
            {renderSlot('conversation.details.header.actions', {
              openView: (id) => { actions.setView(id) },
            }, { entryKey: active.id })}
          </div>
        )}
        <button
          type="button" className={css.close} aria-label={t('details.close')}
          onClick={() => { closeDetails() }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.body}>
        {active === undefined
          ? <div className={css.empty}>{t('details.empty')}</div>
          : renderSlot('conversation.details.view', {}, {
            only: active.id,
            fallback: <div className={css.empty}>{t('details.empty')}</div>,
          })}
      </div>
    </div>
  )
}
