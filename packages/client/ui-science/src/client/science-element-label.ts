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

/**
 * Build the localized element label shown in viewer rows and composer chips.
 * @param kind - extracted element category.
 * @param label - extracted series or annotation label.
 * @param t - Science namespace translator.
 * @param panel - Optional one-based panel number for a multi-panel element.
 * @returns localized kind with optional element label and panel suffix.
 */
export function scienceElementLabel(
  kind: ScienceChartElement['kind'],
  label: string | null,
  t: TranslateNS<'science'>,
  panel?: number,
): string {
  const kindLabel = t(ELEMENT_KIND_LABEL_KEY[kind])
  const name = label === null || label === '' ? kindLabel : `${kindLabel} · ${label}`
  return panel === undefined ? name : `${name} · ${t('panel.panelSuffix', { index: panel })}`
}
