/** Shared fallback rendering for unsettled or unrecognized Science tool rows. */

import type { ReactNode } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/** Lifecycle state derived only from the durable tool-call slice. */
export type ScienceToolRowState = 'running' | 'ok' | 'error' | 'stopped'

/** CSS seats supplied by each dedicated Science row. */
export interface ScienceToolFallbackClasses {
  readonly card: string | undefined
  readonly header: string | undefined
  readonly leading: string | undefined
  readonly title: string | undefined
  readonly status: string | undefined
  readonly fallbackText: string | undefined
}

/** Props for one dedicated row's plain fallback presentation. */
export interface ScienceToolFallbackRowProps {
  readonly dataTool: string
  readonly state: ScienceToolRowState
  readonly leading: ReactNode
  readonly title: string
  readonly status: string | null
  readonly text: string | null
  readonly classes: ScienceToolFallbackClasses
  /** Content appended after the rendered text, e.g. `ScienceRunRow`'s clickable captured-artifact list. */
  readonly after?: ReactNode
}

/**
 * Derive display state without consulting anything beyond the durable call slice.
 * @param block - live or settled durable tool-call slice.
 * @returns the row lifecycle state.
 */
export function scienceToolRowState(block: ToolCallViewProps['block']): ScienceToolRowState {
  if (!('kind' in block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/**
 * Flatten durable result blocks under the generic Tool-row text representation.
 * @param block - live or settled durable tool-call slice.
 * @returns joined result text, or null when no text is available.
 */
export function scienceToolResultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  return parts.join('\n') || null
}

/**
 * Render the plain fallback shared by dedicated Science tool rows.
 * @param props - row identity, state, content, and owner-provided CSS seats.
 * @returns the fallback card.
 */
export function ScienceToolFallbackRow(props: ScienceToolFallbackRowProps) {
  const { dataTool, state, leading, title, status, text, classes, after } = props
  return (
    <div className={classes.card} data-tool={dataTool} data-state={state}>
      <div className={classes.header}>
        <span className={classes.leading}>{leading}</span>
        <span className={classes.title}>{title}</span>
        {status !== null && <span className={classes.status}>{status}</span>}
      </div>
      {text !== null && <pre className={classes.fallbackText}>{text}</pre>}
      {after}
    </div>
  )
}
