/** Pure derivation for the run_python/run_r row's eight states: text-marker recovery, counting, and formatting. */

import { describe, expect, it } from 'vitest'
import {
  byteLength, countLines, firstLine, formatElapsed, formatSeconds, splitRunResultSections,
} from '../src/client/run-output.ts'

/** One `formatRunResult`-shaped tool-result content string (tool-science `run.ts`'s durable text shape). */
function resultText(opts: {
  stdout?: string
  stdoutTruncated?: boolean
  stderr?: string
  stderrTruncated?: boolean
  footer?: readonly string[]
} = {}): string {
  const { stdout = '', stdoutTruncated = false, stderr = '', stderrTruncated = false, footer = [] } = opts
  const lines = ['status: success', '--- stdout ---', stdout === '' ? '(empty)' : stdout]
  if (stdoutTruncated) lines.push('(stdout truncated)')
  lines.push('--- stderr ---', stderr === '' ? '(empty)' : stderr)
  if (stderrTruncated) lines.push('(stderr truncated)')
  lines.push(...footer)
  return lines.join('\n')
}

describe('splitRunResultSections', () => {
  it('returns null when the stdout marker is absent', () => {
    expect(splitRunResultSections('a bespoke non-standard result')).toBeNull()
  })

  it('returns null when the stdout marker is present but the stderr marker is not', () => {
    expect(splitRunResultSections('status: success\n--- stdout ---\nonly stdout, no stderr marker')).toBeNull()
  })

  it('recovers empty stdout and stderr from the "(empty)" sentinel', () => {
    expect(splitRunResultSections(resultText())).toEqual({ stdout: '', stdoutTruncatedMarker: false, stderr: '' })
  })

  it('recovers multi-line stdout and stderr verbatim', () => {
    const sections = splitRunResultSections(resultText({ stdout: 'a\nb', stderr: 'c\nd' }))
    expect(sections).toEqual({ stdout: 'a\nb', stdoutTruncatedMarker: false, stderr: 'c\nd' })
  })

  it('strips the "(stdout truncated)" marker line and reports it', () => {
    const sections = splitRunResultSections(resultText({ stdout: 'kept tail', stdoutTruncated: true }))
    expect(sections).toEqual({ stdout: 'kept tail', stdoutTruncatedMarker: true, stderr: '' })
  })

  it('strips the "(stderr truncated)" marker line from the recovered stderr text', () => {
    const sections = splitRunResultSections(resultText({ stderr: 'kept stderr tail', stderrTruncated: true }))
    expect(sections?.stderr).toBe('kept stderr tail')
  })

  it('strips a trailing captured-artifact report from stderr when present with no truncation marker', () => {
    const sections = splitRunResultSections(resultText({
      stderr: 'boom', footer: ['Captured 1 artifact: `x` v1 (a; image/png), 10 B.'],
    }))
    expect(sections?.stderr).toBe('boom')
  })

  it('strips a trailing skip/truncate capture notice from stderr with no "Captured" line', () => {
    const sections = splitRunResultSections(resultText({
      stderr: 'boom', footer: ['(1 eligible file(s) skipped: too large to capture)'],
    }))
    expect(sections?.stderr).toBe('boom')
  })

  it('finds the earliest footer line in text order even when a later-checked prefix matches first', () => {
    // '\n(more eligible files existed' is checked after '\nCaptured ' in the
    // fixed prefix list, but appears earlier in this text — the earliest
    // match in TEXT order must win, not the first one checked.
    const sections = splitRunResultSections(resultText({
      stderr: 'boom',
      footer: [
        '(more eligible files existed than this run\'s capture limit admits; the rest were not captured)',
        'Captured 1 artifact: `x` v1 (a; image/png), 10 B.',
      ],
    }))
    expect(sections?.stderr).toBe('boom')
  })

  it('prefers the "(stderr truncated)" marker over a footer when both are present', () => {
    const sections = splitRunResultSections(resultText({
      stderr: 'kept', stderrTruncated: true, footer: ['Captured 1 artifact: `x` v1 (a; image/png), 10 B.'],
    }))
    expect(sections?.stderr).toBe('kept')
  })
})

describe('countLines', () => {
  it('counts zero lines for an empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('does not count a single trailing newline as an extra blank line', () => {
    expect(countLines('a\nb\n')).toBe(2)
  })

  it('counts every line when there is no trailing newline', () => {
    expect(countLines('a\nb\nc')).toBe(3)
  })

  it('counts zero lines for text that is only a trailing newline', () => {
    expect(countLines('\n')).toBe(0)
  })
})

describe('byteLength', () => {
  it('counts one byte per ASCII character', () => {
    expect(byteLength('abc')).toBe(3)
  })

  it('counts the exact UTF-8 byte length of multi-byte characters', () => {
    expect(byteLength('文')).toBe(3)
  })
})

describe('formatElapsed', () => {
  it('formats sub-minute durations as 00:ss', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(12_000)).toBe('00:12')
  })

  it('rolls seconds over into minutes', () => {
    expect(formatElapsed(125_000)).toBe('02:05')
  })

  it('clamps a negative duration to zero', () => {
    expect(formatElapsed(-500)).toBe('00:00')
  })
})

describe('formatSeconds', () => {
  it('formats one decimal second', () => {
    expect(formatSeconds(900)).toBe('0.9s')
  })

  it('clamps a negative duration to zero', () => {
    expect(formatSeconds(-100)).toBe('0.0s')
  })
})

describe('firstLine', () => {
  it('skips leading blank lines and trims the first informative one', () => {
    expect(firstLine('\n  \n  hello  \nworld')).toBe('hello')
  })

  it('returns an empty string when every line is blank', () => {
    expect(firstLine('\n  \n')).toBe('')
  })
})
