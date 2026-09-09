/**
 * Canonical short summary of one chart element's current value, shared
 * verbatim by Host admission ({@link ../edit-message.ts}) and the artifact
 * viewer ({@link @deepseek-ai/dsh-client-ui-science}) so a target the browser
 * constructs always matches what Host admission recomputes from the same
 * artifact version. Carries no Host import, so bundlers may resolve this
 * subpath into a browser build.
 *
 * @module @deepseek-ai/dsh-tool-science/element-summary
 */

import type { ScienceChartElement } from '@deepseek-ai/dsh-science-session/types'

/**
 * Serialize one element current value into the bounded reference summary
 * carried by a precise element target.
 * @param current - extracted JSON value.
 * @returns single-line text capped at 60 characters plus an ellipsis.
 */
export function scienceElementCurrentSummary(current: ScienceChartElement['current']): string {
  const text = typeof current === 'string' ? current : JSON.stringify(current)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
