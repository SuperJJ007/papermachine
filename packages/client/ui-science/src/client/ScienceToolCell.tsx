/** Collapsed-by-default Science tool execution cell. */

import { useState, type ReactNode } from 'react'
import { CodeBlock, DisclosureRow, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ScienceToolRowState } from './ScienceToolFallbackRow.tsx'
import css from './ScienceToolCell.module.css'

/** Display inputs for one process-oriented Science tool row. */
export interface ScienceToolCellProps {
  readonly state: ScienceToolRowState
  readonly icon: ReactNode
  readonly title: string
  readonly summary: string
  readonly code?: { readonly text: string; readonly language: string } | undefined
  readonly output?: string | null | undefined
  readonly children?: ReactNode
  readonly inspect?: (() => void) | undefined
  readonly copyLabel: string
  readonly copiedLabel: string
  /** Tool identifier exposed for presentation-specific styling and tests. */
  readonly toolKind?: string | undefined
}

function leading(state: ScienceToolRowState, icon: ReactNode): ReactNode {
  if (state === 'error') return <StateDot state="error" />
  if (state === 'stopped') return <StateDot state="warning" />
  return icon
}

/** Render one single-line cell whose execution material mounts only when expanded. */
export function ScienceToolCell({
  state, icon, title, summary, code, output, children, inspect, copyLabel, copiedLabel, toolKind,
}: ScienceToolCellProps) {
  const [expanded, setExpanded] = useState(false)
  const expandable = code !== undefined || output !== undefined && output !== null || children !== undefined
  const open = expanded && expandable
  return (
    <div className={css.root} data-science-cell data-state={state} data-tool={toolKind}>
      <DisclosureRow rowClassName={css.row} leadingClassName={css.leading} titleClassName={css.title}
        chevronClassName={css.chevron} icon={leading(state, icon)} title={title} open={open}
        expandable={expandable} expandOnRowClick keepContentWhenOpen onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={summary !== '' && <><span className={css.sep} aria-hidden /><span className={css.summary}>{summary}</span></>}>
        <div className={css.body}>
          {code !== undefined && (
            <CodeBlock code={code.text} lang={code.language} copyLabel={copyLabel}
              copiedLabel={copiedLabel} className={css.code} />
          )}
          {output !== undefined && output !== null && <pre className={css.output}>{output}</pre>}
          {children}
          {inspect !== undefined && <button type="button" className={css.inspect} onClick={inspect}>Inspect</button>}
        </div>
      </DisclosureRow>
    </div>
  )
}
