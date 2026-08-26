import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceDetailsHeader.module.css'

/** Props for the Science Details header's project-library page selector. */
export type ScienceDetailsHeaderProps =
  PropsRuntime<'conversation.details.header.actions'> & PropsLocale<'science'>
  & PropsStore<ScienceSelectionStore>

/**
 * Render the top-level artifact and project-files pages in the Details header.
 * @param props - Shared Science selection store and localized labels.
 * @returns The two library-page tabs.
 */
export function ScienceDetailsHeader({ useStore, actions, t }: ScienceDetailsHeaderProps) {
  const page = useStore(state => state.libraryPage)
  const select = (next: 'artifacts' | 'files'): void => {
    actions.setLibraryPage(next)
    actions.showLibrary()
  }
  return (
    <div className={css.pages} role="tablist" aria-label={t('library.home')}>
      <button type="button" role="tab" aria-selected={page === 'artifacts'} onClick={() => { select('artifacts') }}>
        {t('library.artifacts')}
      </button>
      <button type="button" role="tab" aria-selected={page === 'files'} onClick={() => { select('files') }}>
        {t('library.files')}
      </button>
    </div>
  )
}
