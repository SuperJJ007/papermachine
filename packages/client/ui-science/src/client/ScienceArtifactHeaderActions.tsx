// Details column header controls for the Science entry: registered on the
// keyed `conversation.details.header.actions` slot (entryKey `science`), so
// they render only while the Science Details entry is the active one. Reads
// the shared selection store and renders nothing while no artifact is
// selected — "provenance" and "expand" are both about "the selected
// version", so neither has meaning over an empty gallery. The panel's own
// close button stays where it is (DetailsPanel.tsx); this component
// contributes only these two.

import { IconFullscreenOutline16, IconInspectOutline12 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the header-actions
// seat and its DetailsHeaderActionOwnerProps.openView callback).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceArtifactHeaderActions.module.css'

/** Full props for the Science Details header actions. */
export type ScienceArtifactHeaderActionsProps =
  PropsRuntime<'conversation.details.header.actions'> & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** `conversation.view` id this control opens (matches the entry ui-science registers). */
const SCIENCE_PROVENANCE_ID = 'science.provenance'

/**
 * Render the Science Details entry's two header controls, when an artifact
 * version is selected.
 * @param props - runtime slot currency, the shared selection store, and the science locale seat.
 * @returns the provenance and expand controls, or null with no selection.
 */
export function ScienceArtifactHeaderActions({ useStore, actions, openView, t }: ScienceArtifactHeaderActionsProps) {
  const selected = useStore(s => s.selected)
  if (selected === null) return null

  return (
    <>
      <button
        type="button"
        className={css.action}
        aria-label={t('details.artifact.provenance')}
        onClick={() => { openView(SCIENCE_PROVENANCE_ID) }}
      >
        <IconInspectOutline12 size={12} />
        <span>{t('details.artifact.provenance')}</span>
      </button>
      <button
        type="button"
        className={css.action}
        aria-label={t('details.artifact.expand')}
        onClick={() => { actions.setLightboxOpen(true) }}
      >
        <IconFullscreenOutline16 size={14} />
        <span>{t('details.artifact.expand')}</span>
      </button>
    </>
  )
}
