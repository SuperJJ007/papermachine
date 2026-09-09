// @vitest-environment jsdom
// parseCsv: header/row split, quoted fields (embedded comma/newline, doubled-
// quote escaping), CRLF/LF/bare-CR line endings, trailing-newline handling,
// blank input, and ragged rows returned unpadded.

import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/client/csv.ts'

describe('parseCsv', () => {
  it('splits a simple header and rows on LF', () => {
    expect(parseCsv('a,b,c\n1,2,3\n4,5,6')).toEqual({
      header: ['a', 'b', 'c'],
      rows: [['1', '2', '3'], ['4', '5', '6']],
    })
  })

  it('returns empty header and rows for blank input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] })
  })

  it('does not synthesize an empty trailing record for a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual({ header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('flushes the final record when the file has no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual({ header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('splits on CRLF and treats a bare CR as a line ending too', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual({ header: ['a', 'b'], rows: [['1', '2']] })
    expect(parseCsv('a,b\r1,2\r')).toEqual({ header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('parses a quoted field containing a comma and an embedded newline', () => {
    expect(parseCsv('name,note\n"Ada, Lovelace","line one\nline two"')).toEqual({
      header: ['name', 'note'],
      rows: [['Ada, Lovelace', 'line one\nline two']],
    })
  })

  it('unescapes a doubled quote into one literal quote inside a quoted field', () => {
    expect(parseCsv('label\n"she said ""hi"""')).toEqual({
      header: ['label'],
      rows: [['she said "hi"']],
    })
  })

  it('treats a bare double quote mid-field as a literal character, not a quote-open', () => {
    expect(parseCsv('label\n12"x')).toEqual({ header: ['label'], rows: [['12"x']] })
  })

  it('returns a header with no data rows for single-line input', () => {
    expect(parseCsv('only,header,row')).toEqual({ header: ['only', 'header', 'row'], rows: [] })
  })

  it('does not pad a ragged row to the header width', () => {
    expect(parseCsv('a,b,c\n1,2\n1,2,3,4')).toEqual({
      header: ['a', 'b', 'c'],
      rows: [['1', '2'], ['1', '2', '3', '4']],
    })
  })

  it('closes an unterminated quoted field at end of input instead of hanging', () => {
    expect(parseCsv('a\n"unterminated')).toEqual({ header: ['a'], rows: [['unterminated']] })
  })
})
