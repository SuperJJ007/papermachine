import { describe, expect, it } from 'vitest'
import CoverageBlobReporter from './coverage-blob-reporter.ts'

describe('partition coverage blob range preservation', () => {
  it('keeps unbounded source ranges numeric after JSON transport without changing hit counts', () => {
    const location = { start: { line: 1, column: 0 }, end: { line: 1, column: Infinity } }
    const input = {
      statementMap: { 0: location },
      branchMap: { 0: { loc: location, locations: [location, location] } },
      fnMap: { 0: { loc: location } },
      s: { 0: 0 }, b: { 0: [0, 2] }, f: { 0: 3 },
    }
    const reporter = new CoverageBlobReporter({})
    reporter.onCoverage({ toJSON: () => input })
    const roundTrip: unknown = JSON.parse(JSON.stringify(reporter.coverage))
    const bounded = { start: { line: 1, column: 0 }, end: { line: 1, column: Number.MAX_SAFE_INTEGER } }
    expect(roundTrip).toEqual({
      statementMap: { 0: bounded },
      branchMap: { 0: { loc: bounded, locations: [bounded, bounded] } },
      fnMap: { 0: { loc: bounded } },
      s: { 0: 0 }, b: { 0: [0, 2] }, f: { 0: 3 },
    })
    expect(input.statementMap[0].end.column).toBe(Infinity)
  })

  it('preserves finite positions and covered or uncovered counters exactly', () => {
    const input = { statementMap: { 0: { start: { line: 3, column: 2 }, end: { line: 4, column: 9 } } }, s: { 0: 0, 1: 4 } }
    const reporter = new CoverageBlobReporter({})
    reporter.onCoverage(input)
    expect(reporter.coverage).toEqual(input)
    expect(reporter.coverage).not.toBe(input)
  })
})
