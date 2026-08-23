// Session-header action for a built-in Science session: visible only when
// the current Session summary names the `science` preset, and its one
// affordance toggles the routed `science` Details entry through the
// owner-supplied callback — it never opens a panel of its own.

import { IconDataOutline16, IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions
// seat and its ConversationHeaderActionOwnerProps.openDetailsView callback).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ScienceHeaderAction.module.css'

/** Full props for the session-header Science action. */
export type ScienceHeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'science'>

/** Details entry id this action opens (matches the entry's own registration). */
export const SCIENCE_DETAILS_ID = 'science'

/** Shared compact Files control used by the root utility placement. */
export function ScienceFilesButton({ onClick, t }: { onClick: () => void; t: ScienceHeaderActionProps['t'] }) {
  return (
    <button type="button" className={css.iconAction} aria-label={t('details.action')} onClick={onClick}>
      <IconPanelLeftOutline16 size={16} />
    </button>
  )
}

/**
 * Render this session's Science details action, which both opens and closes
 * the artifact panel. Renders nothing at all for a Standard or custom
 * non-Science session, so an ordinary conversation never grows a control for
 * a preset it is not running.
 * @param props - runtime slot currency plus the science namespace translator.
 * @returns the action button, or null when the session names another preset.
 */
export function ScienceHeaderAction({ sessionId, useSessions, toggleDetailsView, t }: ScienceHeaderActionProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  if (preset !== 'science') return null

  return (
    <button
      type="button"
      className={css.action}
      aria-label={t('details.action')}
      onClick={() => { toggleDetailsView(SCIENCE_DETAILS_ID) }}
    >
      <IconDataOutline16 size={14} />
      <span>{t('details.label')}</span>
    </button>
  )
}
