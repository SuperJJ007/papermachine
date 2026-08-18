// @vitest-environment jsdom
// ArtifactTable: empty-header fallback, column rendering, ragged-row missing
// cells, and the sort cycle (file order -> ascending -> descending -> file
// order again) with numeric-aware comparison.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactTable, compareCells } from '../src/client/ArtifactTable.tsx'
import type { ArtifactTableLabels } from '../src/client/ArtifactTable.tsx'

afterEach(cleanup)

const labels: ArtifactTableLabels = {
  empty: 'No data',
  sortBy: column => `Sort by ${column}`,
  truncated: (shown, total) => `Showing first ${String(shown)} of ${String(total)} rows`,
}

function cellTexts(): string[] {
  return screen.getAllByRole('cell').map(cell => cell.textContent ?? '')
}

describe('compareCells', () => {
  it('compares two finite numeric strings numerically', () => {
    expect(compareCells('2', '10')).toBeLessThan(0)
    expect(compareCells('10', '2')).toBeGreaterThan(0)
  })

  it('treats a missing cell as an empty string on either side', () => {
    expect(compareCells(undefined, '5')).toBeLessThan(0)
    expect(compareCells('5', undefined)).toBeGreaterThan(0)
  })

  it('falls back to locale string order when either side is blank or non-numeric', () => {
    expect(compareCells('', '5')).toBeLessThan(0)
    expect(compareCells('5', '')).toBeGreaterThan(0)
    expect(compareCells('bob', 'ada')).toBeGreaterThan(0)
  })
})

describe('ArtifactTable', () => {
  it('renders the empty-state text when the document has no header row', () => {
    render(<ArtifactTable data={{ header: [], rows: [] }} label="Empty" labels={labels} />)
    expect(screen.getByRole('status').textContent).toBe('No data')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders the header and rows in file order with an accessible table label', () => {
    render(<ArtifactTable data={{ header: ['name', 'score'], rows: [['ada', '10'], ['bob', '2']] }} label="scores.csv" labels={labels} />)
    expect(screen.getByRole('table', { name: 'scores.csv' })).not.toBeNull()
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['name', 'score'])
    expect(cellTexts()).toEqual(['ada', '10', 'bob', '2'])
  })

  it('renders a missing cell as empty for a row shorter than the header', () => {
    render(<ArtifactTable data={{ header: ['a', 'b', 'c'], rows: [['1', '2']] }} label="ragged" labels={labels} />)
    expect(cellTexts()).toEqual(['1', '2', ''])
  })

  it('sorts numerically ascending, then descending, then back to file order on repeated clicks', () => {
    render(<ArtifactTable data={{ header: ['score'], rows: [['10'], ['2'], ['33']] }} label="numbers" labels={labels} />)
    const sortButton = screen.getByRole('button', { name: 'Sort by score' })
    const header = screen.getByRole('columnheader')

    fireEvent.click(sortButton)
    expect(cellTexts()).toEqual(['2', '10', '33'])
    expect(header.getAttribute('aria-sort')).toBe('ascending')

    fireEvent.click(sortButton)
    expect(cellTexts()).toEqual(['33', '10', '2'])
    expect(header.getAttribute('aria-sort')).toBe('descending')

    fireEvent.click(sortButton)
    expect(cellTexts()).toEqual(['10', '2', '33'])
    expect(header.getAttribute('aria-sort')).toBe('none')
  })

  it('falls back to locale string comparison when a column is not numeric', () => {
    render(<ArtifactTable data={{ header: ['name'], rows: [['charlie'], ['ada'], ['bob']] }} label="names" labels={labels} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    expect(cellTexts()).toEqual(['ada', 'bob', 'charlie'])
  })

  it('switching the sorted column resets to ascending on that column', () => {
    render(<ArtifactTable data={{ header: ['a', 'b'], rows: [['2', '20'], ['1', '10']] }} label="two-column" labels={labels} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sort by a' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sort by a' })) // descending on "a"
    fireEvent.click(screen.getByRole('button', { name: 'Sort by b' })) // switch to "b": resets to ascending
    expect(cellTexts()).toEqual(['1', '10', '2', '20'])
    expect(screen.getAllByRole('columnheader')[0]?.getAttribute('aria-sort')).toBe('none')
    expect(screen.getAllByRole('columnheader')[1]?.getAttribute('aria-sort')).toBe('ascending')
  })

  it('treats a blank cell as non-numeric so it sorts by locale order, not as zero', () => {
    render(<ArtifactTable data={{ header: ['score'], rows: [['5'], ['']] }} label="blank" labels={labels} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sort by score' }))
    // '' localeCompare '5' precedes it; not the numeric-zero ordering blank-as-0 would produce.
    expect(cellTexts()).toEqual(['', '5'])
  })
})
