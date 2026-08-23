/** Science Outcome-only destination for the project sidebar. */

import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ScienceOutcomeDetails.module.css'

/** Full props for the Outcome destination. */
export type ScienceOutcomeDetailsProps = PropsRuntime<'conversation.details.view'> & PropsLocale<'science'>

/** Render only the current Science Outcome, distinct from the Files viewer. */
export function ScienceOutcomeDetails({ useProjection, t }: ScienceOutcomeDetailsProps) {
  const science = useProjection('science')
  const outcome = science?.outcome
  if (outcome === undefined || outcome === null) return <p className={css.notice}>{t('details.outcome.empty')}</p>
  return (
    <article className={css.root}>
      <header><h3>{outcome.title}</h3><span>{t('outcome.revision', { revision: outcome.revision })}</span></header>
      <MarkdownText text={outcome.summaryMarkdown} />
    </article>
  )
}
