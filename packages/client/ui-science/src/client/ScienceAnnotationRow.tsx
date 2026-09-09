/** Collapsed process cell for `annotate_artifact`; navigation lives at the Turn tail. */

import { IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { ScienceToolCell } from './ScienceToolCell.tsx'
import { scienceToolResultText, scienceToolRowState } from './ScienceToolFallbackRow.tsx'

/** Render annotation work as one folded cell without an inline artifact card. */
export function ScienceAnnotationRow({ block, inspect, t }: ToolCallViewProps & PropsLocale<'science'>) {
  const state = scienceToolRowState(block)
  const output = scienceToolResultText(block)
  const summary = state === 'running' ? t('artifact.curating')
    : state === 'error' ? t('artifact.curateFailed')
      : state === 'stopped' ? t('artifact.curateStopped')
        : output?.split(/\r?\n/u)[0] ?? ''
  return <ScienceToolCell state={state} icon={<IconDataOutline16 size={14} />} title={t('artifact.title')}
    summary={summary} output={output} inspect={inspect} copyLabel={t('cell.copy')} copiedLabel={t('cell.copied')} toolKind="science-annotation" />
}
