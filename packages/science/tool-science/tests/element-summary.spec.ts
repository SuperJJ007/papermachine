/** Coverage for the summary shared by Host admission and the artifact viewer. */

import { describe, expect, it } from 'vitest'
import { scienceElementCurrentSummary } from '../src/element-summary.ts'

describe('scienceElementCurrentSummary', () => {
  it('passes a short string through verbatim', () => {
    expect(scienceElementCurrentSummary('Loss')).toBe('Loss')
  })

  it('serializes a non-string JSON value', () => {
    expect(scienceElementCurrentSummary({ position: 'right', visible: true })).toBe('{"position":"right","visible":true}')
  })

  it('truncates text over 60 characters to 60 plus an ellipsis', () => {
    const long = 'x'.repeat(61)
    const summary = scienceElementCurrentSummary(long)
    expect(summary).toBe(`${'x'.repeat(60)}…`)
    expect(summary.length).toBe(61)
  })
})
