// Science Details entry: read-only current-state view over the accepted
// client-safe `science` Session projection (packages/science/science-session/src/types.ts).
// Renders a client-safe environment summary, ordered run history, logical
// charts at their latest accepted version (thumbnails via this package's own
// session-scoped loader, science-attachment-loader.ts), and the latest
// Outcome with its evidence references. It builds no second projection
// reader, chart store, Outcome editor, or attachment cache — every fact
// rendered here already lives on `ScienceClientProjection`, and evidence
// copy reuses the same `outcome.*` locale keys the publish_outcome toolview
// row uses. The environment section never reports capability from
// configuration alone: a revision whose `status` is not `'applied'` (absent
// binding, `'invalid'`, or `'drifted'`) renders the same "failed" text
// regardless of which of those three applies, so no state can read as
// "Runtime ready" on a merely configured prefix.

import { MessageImage, type ImageLoader, type MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import { MarkdownText, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.details.view).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: merges the `science` key into SessionProjectionMap for useProjection.
import type {
  ScienceClientChartVersion, ScienceClientEnvironmentBinding, ScienceClientInterpreterBinding,
  ScienceClientOutcomePublication, ScienceClientRun,
  ScienceEvidenceRef, ScienceInterpreterCapability, ScienceLanguage,
} from '@deepseek-ai/dsh-science-session/types'
import css from './ScienceDetailsView.module.css'

/** Business face this entry's registration injects. */
export interface ScienceDetailsInjected {
  /** Session-scoped chart-thumbnail loader (science-attachment-loader.ts). */
  loadImage: ImageLoader
}

/** Full props for the Science Details entry. */
export type ScienceDetailsViewProps =
  PropsRuntime<'conversation.details.view'> & InjectFace<ScienceDetailsInjected> & PropsLocale<'science'>

/** Closed-union exhaustiveness fence. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

const LANGUAGE_KEY: Record<ScienceLanguage, 'details.language.python' | 'details.language.r'> = {
  python: 'details.language.python',
  r: 'details.language.r',
}

function capabilityText(capability: ScienceInterpreterCapability, t: TranslateNS<'science'>): string {
  switch (capability) {
    case 'available': return t('details.capability.available')
    case 'unavailable': return t('details.capability.unavailable')
    case 'invalid': return t('details.capability.invalid')
    case 'drifted': return t('details.capability.drifted')
    /* v8 ignore next -- closed capability union */
    default: return assertNever(capability)
  }
}

function runStatusText(status: ScienceClientRun['status'], t: TranslateNS<'science'>): string {
  switch (status) {
    case 'running': return t('details.run.status.running')
    case 'success': return t('details.run.status.success')
    case 'failed': return t('details.run.status.failed')
    case 'timed-out': return t('details.run.status.timedOut')
    case 'cancelled': return t('details.run.status.cancelled')
    case 'interrupted': return t('details.run.status.interrupted')
    /* v8 ignore next -- closed run-status union */
    default: return assertNever(status)
  }
}

function runDotState(status: ScienceClientRun['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'success': return 'done'
    case 'failed': return 'error'
    case 'timed-out':
    case 'cancelled':
    case 'interrupted':
      return 'warning'
    /* v8 ignore next -- closed run-status union */
    default: return assertNever(status)
  }
}

function evidenceText(item: ScienceEvidenceRef, t: TranslateNS<'science'>): string {
  switch (item.kind) {
    case 'run': return t('outcome.evidenceRun', { runId: item.runId })
    case 'chart': return t('outcome.evidenceChart', { chartId: item.chartId, version: item.version })
    case 'message': return t('outcome.evidenceMessage', { seq: item.seq })
    /* v8 ignore next -- closed evidence-kind union */
    default: return assertNever(item)
  }
}

/** Browser-locale timestamp; no fixed format is imposed on the reader's Intl settings. */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

/** Latest accepted version per logical chart, in first-appearance (commit) order. */
function latestCharts(charts: readonly ScienceClientChartVersion[]): ScienceClientChartVersion[] {
  const byId = new Map<string, ScienceClientChartVersion>()
  for (const chart of charts) {
    const current = byId.get(chart.chartId)
    if (current === undefined || chart.version > current.version) byId.set(chart.chartId, chart)
  }
  return [...byId.values()]
}

function InterpreterRow({ language, binding, t }: {
  language: ScienceLanguage
  binding: ScienceClientInterpreterBinding
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.environmentRow}>
      <span className={css.environmentLanguage}>{t(LANGUAGE_KEY[language])}</span>
      <span>{capabilityText(binding.capability, t)}</span>
      {binding.languageVersion !== undefined
        && <span>{t('details.environment.languageVersion', { version: binding.languageVersion })}</span>}
      {binding.fingerprintPreview !== undefined
        && <span className={css.fingerprint}>{t('details.environment.fingerprint', { preview: binding.fingerprintPreview })}</span>}
    </div>
  )
}

function EnvironmentSection({ environment, t }: {
  environment: ScienceClientEnvironmentBinding | null
  t: TranslateNS<'science'>
}) {
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('details.environment.title')}</div>
      {environment === null || environment.status !== 'applied'
        ? <p className={css.notice} role="status">{t('details.environment.failed')}</p>
        : (
          <div className={css.environmentBody}>
            <div className={css.environmentRow}>
              <span>{t('details.environment.profile', { profile: environment.profileId })}</span>
              <span>{t('details.environment.revision', { revision: environment.revision })}</span>
            </div>
            {environment.python !== undefined && <InterpreterRow language="python" binding={environment.python} t={t} />}
            {environment.r !== undefined && <InterpreterRow language="r" binding={environment.r} t={t} />}
          </div>
        )}
    </section>
  )
}

function RunsSection({ runs, t }: { runs: readonly ScienceClientRun[]; t: TranslateNS<'science'> }) {
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('details.runs.title')}</div>
      {runs.length === 0
        ? <p className={css.notice} role="status">{t('details.runs.empty')}</p>
        : (
          <ul className={css.runList}>
            {runs.map(run => (
              <li key={run.runId} className={css.runRow}>
                <StateDot state={runDotState(run.status)} />
                <span className={css.runLanguage}>{t(LANGUAGE_KEY[run.language])}</span>
                <span className={css.runStatus}>{runStatusText(run.status, t)}</span>
                <span className={css.runTime}>{formatTime(run.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

function chartImageLabels(t: TranslateNS<'science'>): MessageImageLabels {
  return {
    image: t('chart.title'),
    open: t('chart.open'),
    openNamed: label => t('chart.openNamed', { label }),
    loading: t('chart.loading'),
    loadFailed: t('chart.loadFailed'),
    lightbox: { dialog: t('chart.lightboxOriginal'), close: t('chart.lightboxClose') },
  }
}

function ChartsSection({ charts, loadImage, t }: {
  charts: readonly ScienceClientChartVersion[]
  loadImage: ImageLoader
  t: TranslateNS<'science'>
}) {
  const latest = latestCharts(charts)
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('details.charts.title')}</div>
      {latest.length === 0
        ? <p className={css.notice} role="status">{t('details.charts.empty')}</p>
        : (
          <ul className={css.chartList}>
            {latest.map(chart => (
              <li key={chart.chartId} className={css.chartItem}>
                <MessageImage attachment={chart.attachment} load={loadImage} variant="tile" labels={chartImageLabels(t)} />
                <div className={css.chartMeta}>
                  <span className={css.chartTitle}>{chart.title}</span>
                  <span className={css.badge}>{t('chart.version', { version: chart.version })}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

function OutcomeSection({ outcome, t }: {
  outcome: ScienceClientOutcomePublication | null
  t: TranslateNS<'science'>
}) {
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('outcome.title')}</div>
      {outcome === null
        ? <p className={css.notice} role="status">{t('details.outcome.empty')}</p>
        : (
          <div className={css.outcomeBody}>
            <div className={css.outcomeHead}>
              <span className={css.outcomeTitle}>{outcome.title}</span>
              <span className={css.badge}>{t('outcome.revision', { revision: outcome.revision })}</span>
            </div>
            <MarkdownText text={outcome.summaryMarkdown} />
            {outcome.evidence.length > 0 && (
              <ul className={css.evidenceList}>
                {outcome.evidence.map((item, index) => <li key={index}>{evidenceText(item, t)}</li>)}
              </ul>
            )}
          </div>
        )}
    </section>
  )
}

/**
 * Render the Science Details entry from the current `science` projection.
 * @param props - runtime slot currency, the injected loader, and the science locale seat.
 * @returns the current-state Science surface for this session.
 */
export function ScienceDetailsView({ sessionId, useSessions, useProjection, loadImage, t }: ScienceDetailsViewProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const science = useProjection('science')

  if (science === undefined) {
    return (
      <div className={css.body}>
        <p className={css.notice} role="status">{t('details.missingSupport')}</p>
      </div>
    )
  }

  if (science === null) {
    return (
      <div className={css.body}>
        {preset !== undefined && <p className={css.preset}>{t('details.preset', { preset })}</p>}
        <p className={css.notice} role="status">{t('details.unbound')}</p>
      </div>
    )
  }

  return (
    <div className={css.body}>
      <EnvironmentSection environment={science.environment} t={t} />
      <RunsSection runs={science.runs} t={t} />
      <ChartsSection charts={science.charts} loadImage={loadImage} t={t} />
      <OutcomeSection outcome={science.outcome} t={t} />
    </div>
  )
}
