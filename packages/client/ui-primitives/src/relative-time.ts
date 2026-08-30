/** Shared relative-time formatting for session rows and artifact groups. */

/** Relative-time bucket of a session row's trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  unit: RelativeTimeUnit
  n: number
}

/**
 * Compact relative time for activity timestamps, as a structured bucket the
 * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 * @param updatedAt - epoch ms of the last activity.
 * @param now - current epoch ms (injected for pure rendering).
 * @returns the time bucket and magnitude.
 */
export function relativeTime(updatedAt: number, now: number): RelativeTime {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/** Translation callback for compact time units and the optional ago suffix. */
export type RelativeTimeTranslate = (key: `time.${RelativeTimeUnit}` | 'time.ago', params?: Record<string, unknown>) => string

/**
 * Localize an activity timestamp using the common relative-time buckets.
 * @param updatedAt - Epoch milliseconds of the last activity.
 * @param now - Current epoch milliseconds.
 * @param t - Consumer dictionary with compact time units and an ago template.
 * @param ago - Include the ago suffix except for the current-time bucket.
 * @returns Localized relative time.
 */
export function formatRelativeTime(updatedAt: number, now: number, t: RelativeTimeTranslate, ago = false): string {
  const { unit, n } = relativeTime(updatedAt, now)
  if (unit === 'now') return t('time.now')
  const label = t(`time.${unit}`, { n })
  return ago ? t('time.ago', { t: label }) : label
}
