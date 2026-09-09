/**
 * Read-only, sortable, scrollable table for one parsed CSV artifact.
 * Package-local rather than a `dsh-client-ui-primitives` export: no second
 * `packages/client` consumer currently needs a generic table, and
 * "configurability does not justify an unsupported... public operation set"
 * (`packages/AGENTS.md`) — a shared primitive gets a real second consumer
 * before this one grows into one.
 */

import { useMemo, useState } from 'react'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ParsedCsv } from './csv.ts'
import { capForDisplay, MAX_ARTIFACT_TABLE_ROWS } from './format.ts'
import css from './ArtifactTable.module.css'

type SortDirection = 'asc' | 'desc'
interface SortState { column: number; direction: SortDirection }

/** Localized copy this table needs beyond the caller's own `t`. */
export interface ArtifactTableLabels {
  /** Shown in place of the grid when the parsed document has no header row. */
  empty: string
  /** Accessible name for a column header's sort control, e.g. "Sort by {column}". */
  sortBy: (column: string) => string
  /** Shown below the grid when `MAX_ARTIFACT_TABLE_ROWS` truncated the rendered rows. */
  truncated: (shown: number, total: number) => string
}

/** Props for the CSV artifact table. */
export interface ArtifactTableProps {
  /** Parsed CSV document (header row plus every data row). */
  data: ParsedCsv
  /** Accessible label for the `<table>` element. */
  label: string
  labels: ArtifactTableLabels
}

/**
 * Numeric-aware ascending comparison; both sides fall back to locale string
 * order when either is not a finite number. Exported for direct,
 * deterministic branch coverage independent of `Array.prototype.sort`'s
 * comparator-call pattern.
 */
export function compareCells(left: string | undefined, right: string | undefined): number {
  const a = left ?? ''
  const b = right ?? ''
  const numericA = a.trim() === '' ? NaN : Number(a)
  const numericB = b.trim() === '' ? NaN : Number(b)
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB
  return a.localeCompare(b)
}

/**
 * Render one parsed CSV document as a scrollable table whose columns sort on
 * click (ascending, then descending, then back to file order). Rows shorter
 * or longer than the header are rendered as-is; a missing cell renders empty.
 * @param props - the parsed document, accessible label, and sort-control copy.
 * @returns the table, or the empty-state text when the document has no header row.
 */
export function ArtifactTable({ data, label, labels }: ArtifactTableProps) {
  const [sort, setSort] = useState<SortState | null>(null)

  const sortedRows = useMemo(() => {
    if (sort === null) return data.rows
    const direction = sort.direction === 'asc' ? 1 : -1
    return [...data.rows].sort((a, b) => compareCells(a[sort.column], b[sort.column]) * direction)
  }, [data.rows, sort])
  const capped = useMemo(() => capForDisplay(sortedRows, MAX_ARTIFACT_TABLE_ROWS), [sortedRows])

  if (data.header.length === 0) return <p className={css.empty} role="status">{labels.empty}</p>

  const toggleSort = (column: number): void => {
    setSort((prev) => {
      if (prev === null || prev.column !== column) return { column, direction: 'asc' }
      if (prev.direction === 'asc') return { column, direction: 'desc' }
      return null
    })
  }

  return (
    <div className={css.scroll}>
      <table className={css.table} aria-label={label}>
        <thead>
          <tr>
            {data.header.map((column, index) => {
              const active = sort?.column === index
              return (
                <th key={index} scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={css.sortButton} aria-label={labels.sortBy(column)} onClick={() => { toggleSort(index) }}>
                    <span>{column}</span>
                    {active && (sort.direction === 'asc' ? <IconChevronUpOutline14 size={12} /> : <IconChevronDownOutline14 size={12} />)}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {capped.value.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {data.header.map((_column, columnIndex) => <td key={columnIndex}>{row[columnIndex] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {capped.truncated && <p className={css.notice} role="status">{labels.truncated(capped.value.length, capped.total)}</p>}
    </div>
  )
}
