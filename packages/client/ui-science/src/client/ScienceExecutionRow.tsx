/** Collapsed execution cells for `run_python` and `run_r`. */

import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { ScienceToolCell } from './ScienceToolCell.tsx'
import { scienceToolResultText, scienceToolRowState } from './ScienceToolFallbackRow.tsx'

type ScienceExecutionRowProps = ToolCallViewProps & PropsLocale<'science'>

function sourceOf(block: ScienceExecutionRowProps['block']): string {
  const raw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const code = (parsed as Record<string, unknown>).code
      if (typeof code === 'string') return code
    }
  } catch {
    // Malformed tool JSON can only arrive from the durable/wire edge; show it verbatim.
  }
  return raw
}

function firstLine(text: string): string {
  return text.split(/\r?\n/u).map(line => line.trim()).find(Boolean) ?? ''
}

/** Render one language-labeled, collapsed-by-default code execution cell. */
export function ScienceExecutionRow({ block, toolName, inspect, t }: ScienceExecutionRowProps) {
  const state = scienceToolRowState(block)
  const code = sourceOf(block)
  const output = scienceToolResultText(block)
  const title = toolName === 'run_r' ? t('run.titleR') : t('run.titlePython')
  const stateSummary = state === 'running' ? t('run.running')
    : state === 'error' ? t('run.failed')
      : state === 'stopped' ? t('run.stopped') : ''
  return (
    <ScienceToolCell state={state} icon={<IconCodeOutline16 size={14} />} title={title}
      summary={stateSummary || firstLine(code) || firstLine(output ?? '')}
      code={code === '' ? undefined : { text: code, language: toolName === 'run_r' ? 'r' : 'python' }}
      output={output} inspect={inspect} copyLabel={t('cell.copy')} copiedLabel={t('cell.copied')} toolKind="science-run" />
  )
}
