/** Shared compact relative time and ago labels. */
import { describe, expect, it } from 'vitest'
import { formatRelativeTime, relativeTime } from '../src/relative-time.ts'
import type { RelativeTimeTranslate } from '../src/relative-time.ts'

describe('relativeTime', () => {
  it('buckets current, minute, hour, day, month, and year distances', () => {
    const now = 400 * 24 * 60 * 60 * 1_000
    expect(relativeTime(now, now)).toEqual({ unit: 'now', n: 0 })
    expect(relativeTime(now - 5 * 60_000, now)).toEqual({ unit: 'minutes', n: 5 })
    expect(relativeTime(now - 3 * 3_600_000, now)).toEqual({ unit: 'hours', n: 3 })
    expect(relativeTime(now - 2 * 86_400_000, now)).toEqual({ unit: 'days', n: 2 })
    expect(relativeTime(now - 60 * 86_400_000, now)).toEqual({ unit: 'months', n: 2 })
    expect(relativeTime(0, now)).toEqual({ unit: 'years', n: 1 })
  })
})

describe('formatRelativeTime', () => {
  const t: RelativeTimeTranslate = (key, params) => {
    if (key === 'time.now') return 'now'
    if (key === 'time.ago') return `${String(params?.t)} ago`
    return `${String(params?.n)} ${key.slice(5)}`
  }

  it('leaves now bare, clamps future timestamps, and optionally appends ago', () => {
    expect(formatRelativeTime(100, 0, t, true)).toBe('now')
    expect(formatRelativeTime(0, 180_000, t)).toBe('3 minutes')
    expect(formatRelativeTime(0, 180_000, t, true)).toBe('3 minutes ago')
  })
})
