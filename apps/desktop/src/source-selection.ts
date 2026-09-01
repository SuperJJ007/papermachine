/** Deterministic default package-source choice, decided from system locale settings rather than probing network reachability. */

import type { EnvironmentSource } from './environment-declaration.ts'

/** The system locale signals {@link resolveDefaultSourceId} decides from. */
export interface LocaleSignals {
  /** The IANA timezone identifier, e.g. from `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  readonly timeZone: string
  /** Preferred system languages/locale tags, most preferred first (BCP 47, e.g. `zh-CN`). */
  readonly languages: readonly string[]
}

/** The mirror preferred for a mainland-China system; must match the shipped `general.json`'s TUNA source id. */
export const CHINA_MIRROR_SOURCE_ID = 'tuna'
/** The non-mirrored upstream conda-forge channel; the default outside mainland China. */
export const OFFICIAL_SOURCE_ID = 'official'

/**
 * Whether the system looks like it is running in mainland China: its
 * timezone is Shanghai, or any preferred language is Chinese. This is a
 * locale heuristic, not a network probe — the product decision this
 * implements deliberately never measures mirror reachability or speed, so a
 * user whose locale looks Chinese but who is actually elsewhere still gets
 * the mirror default and can pick another source in the confirmation panel.
 * @param signals - the system locale signals to decide from.
 */
function looksLikeChina(signals: LocaleSignals): boolean {
  return signals.timeZone === 'Asia/Shanghai' || signals.languages.some(language => language.toLowerCase().startsWith('zh'))
}

/**
 * Pick the source id the confirmation panel preselects: {@link
 * CHINA_MIRROR_SOURCE_ID} when the system looks like mainland China (see
 * {@link looksLikeChina}), otherwise {@link OFFICIAL_SOURCE_ID}. The user can
 * still override this in the confirmation panel; this only decides the
 * starting selection. Falls back to the first listed source if the
 * preferred id is absent from `sources`, so a declaration that ever ships
 * without one of the two named sources still resolves to a usable default
 * instead of throwing.
 * @param sources - the declaration's ordered sources; must be non-empty.
 * @param signals - the system locale signals to decide from.
 * @returns the id of the default source.
 * @throws when `sources` is empty.
 */
export function resolveDefaultSourceId(sources: readonly EnvironmentSource[], signals: LocaleSignals): string {
  const preferredId = looksLikeChina(signals) ? CHINA_MIRROR_SOURCE_ID : OFFICIAL_SOURCE_ID
  const preferred = sources.find(source => source.id === preferredId)
  if (preferred !== undefined) return preferred.id
  const fallback = sources[0]
  if (fallback === undefined) throw new Error('desktop source selection: sources must not be empty')
  return fallback.id
}
