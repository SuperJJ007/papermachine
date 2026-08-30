/** Localized element names carry panel context outside grouped form rows. */
import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { scienceElementLabel } from '../src/client/science-element-label.ts'
import { zh } from '../src/client/locales.ts'

describe('scienceElementLabel', () => {
  const t = makeTranslate(zh)
  it('appends only the supplied series label and panel number', () => {
    expect(scienceElementLabel('title', null, t, 2)).toBe('标题 · 子图 2')
    expect(scienceElementLabel('title', null, t)).toBe('标题')
    expect(scienceElementLabel('title', '', t)).toBe('标题')
    expect(scienceElementLabel('series', 'Quarterly Sales', t, 1)).toBe('数据系列 · Quarterly Sales · 子图 1')
  })
})
