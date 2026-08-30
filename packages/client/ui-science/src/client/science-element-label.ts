/** Localized labels for addressable Science chart elements. */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceChartElement } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceKey } from './locales.ts'

const ELEMENT_KIND_LABEL_KEY: Record<ScienceChartElement['kind'], ScienceKey> = {
  title: 'panel.kindTitle',
  subtitle: 'panel.kindSubtitle',
  x_label: 'panel.kindXLabel',
  y_label: 'panel.kindYLabel',
  tick_labels: 'panel.kindTickLabels',
  legend: 'panel.kindLegend',
  series: 'panel.kindSeries',
  grid: 'panel.kindGrid',
  axis_range: 'panel.kindAxisRange',
  axis_scale: 'panel.kindAxisScale',
  figure_size: 'panel.kindFigureSize',
  font: 'panel.kindFont',
  annotation: 'panel.kindAnnotation',
}

/** Read old reference summaries and current chart values without changing their wire identity. */
function currentRecord(current: ScienceChartElement['current'] | undefined): Record<string, unknown> | undefined {
  let value: unknown = current
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * Read the color recorded by the chart adapter.
 * @param current - Chart value or persisted reference summary.
 * @returns Recorded CSS color, or undefined when absent.
 */
export function scienceElementColor(current: ScienceChartElement['current'] | undefined): string | undefined {
  const color = currentRecord(current)?.['color']
  return typeof color === 'string' ? color : undefined
}

const GREEK: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
}

function displayText(text: string): string {
  return text.replace(/\$\\([a-z]+)\$/g, (match: string, command: string) => GREEK[command] ?? match)
    .replace(/\$([α-ωΑ-Ω])\$/g, '$1')
}

/**
 * Build the localized element label shown in viewer rows and composer chips.
 * @param kind - extracted element category.
 * @param label - extracted series or annotation label.
 * @param t - Science namespace translator.
 * @param panel - Optional one-based panel number for a multi-panel element.
 * @param current - Current value or a persisted reference summary, for unnamed annotations.
 * @param id - Stable element identifier, retaining duplicate occurrence suffixes.
 * @returns localized kind with optional element label and panel suffix.
 */
export function scienceElementLabel(
  kind: ScienceChartElement['kind'],
  label: string | null,
  t: TranslateNS<'science'>,
  panel?: number,
  current?: ScienceChartElement['current'],
  id?: string,
): string {
  const kindLabel = t(ELEMENT_KIND_LABEL_KEY[kind])
  const record = currentRecord(current)
  const text = kind === 'annotation' && typeof record?.['text'] === 'string' ? record['text'] : undefined
  const value = label || text || undefined
  const occurrence = id?.match(/\]#(\d+)$/)?.[1]
  const name = `${value === undefined ? kindLabel : `${kindLabel} · ${displayText(value)}`}${occurrence === undefined ? '' : ` · #${occurrence}`}`
  return panel === undefined ? name : `${name} · ${t('panel.panelSuffix', { index: panel })}`
}
