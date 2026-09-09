/** Root-scoped Files panel used before an active Session exists. */

import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import css from './ScienceEmptyDetails.module.css'

/** Full props for the no-session Files panel. */
export type ScienceEmptyDetailsProps = PropsRuntime<'details.files'> & PropsLocale<'science'>

/** Explain where project artifacts appear without inventing demo data. */
export function ScienceEmptyDetails({ closeDetails, t }: ScienceEmptyDetailsProps) {
  return (
    <div className={css.root}>
      <div className={css.header}>
        <span className={css.title}>{t('details.artifacts.title')}</span>
        <button type="button" className={css.close} aria-label={t('toolbar.closeTab')} onClick={closeDetails}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      <div className={css.body}>{t('details.artifacts.chooseSession')}</div>
    </div>
  )
}
