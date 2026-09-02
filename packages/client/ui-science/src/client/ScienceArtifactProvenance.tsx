// The provenance drill-in: an in-panel breadcrumb (`<name> › Provenance`)
// over one exact resolved artifact version's current library facts. Reached
// from the artifact viewer's toolbar ("Provenance"); the breadcrumb's root
// segment returns to the content view.
//
// The former Code/Execution-log/Messages/Environment sub-tabs, which drilled
// into the exact run that produced a version, are gone: the T1/T2
// artifact-authority migration removed `runId`/`toolCallId`/`producerSessionId`
// from the client-safe artifact projection (provenance beyond content origin
// and creation time is a store-only fact now, not reconstructable from the
// browser's own state) — see this package's README "Design notes" for the
// full rationale and the receipt-trimming principle it follows.

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceRenderableVersion } from './version-summaries.ts'
import css from './ScienceArtifactProvenance.module.css'

/** Full props for the provenance drill-in. */
export interface ScienceArtifactProvenanceProps {
  chart: ScienceRenderableVersion
  onBack: () => void
  t: TranslateNS<'science'>
}

/**
 * Localize one version's content origin for the provenance summary.
 * @param origin - the store's `contentOrigin` fact.
 * @param t - the Science namespace translator.
 * @returns localized origin text.
 */
function contentOriginText(origin: ScienceRenderableVersion['contentOrigin'], t: TranslateNS<'science'>): string {
  switch (origin) {
    case 'run-auto': return t('provenance.origin.runAuto')
    case 'human-edit': return t('provenance.origin.humanEdit')
    case 'import': return t('provenance.origin.import')
    /* v8 ignore next -- closed ScienceContentOrigin union */
    default: return origin
  }
}

/**
 * Render the provenance drill-in for one resolved artifact version: the
 * breadcrumb, plus its current content origin and creation time.
 * @param props - the resolved version, the back-to-content callback, and the locale seat.
 * @returns the drill-in body.
 */
export function ScienceArtifactProvenance({ chart, onBack, t }: ScienceArtifactProvenanceProps) {
  return (
    <div className={css.body}>
      <nav className={css.breadcrumb} aria-label={t('provenance.label')}>
        <button type="button" className={css.breadcrumbRoot} onClick={onBack}>{chart.title}</button>
        <span className={css.breadcrumbSep} aria-hidden="true">›</span>
        <span className={css.breadcrumbCurrent}>{t('provenance.label')}</span>
      </nav>
      <section className={css.section}>
        <p className={css.anchor}>{t('artifact.version', { version: chart.version })}</p>
        <p>{contentOriginText(chart.contentOrigin, t)}</p>
        <p>{t('provenance.createdAt', { time: new Date(chart.createdAt).toLocaleString() })}</p>
      </section>
    </div>
  )
}
