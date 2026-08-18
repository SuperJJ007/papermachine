// Run toolview registrant: the keyed toolview hole for `run_python` and
// `run_r`. Unlike the artifact/Outcome rows (a settled presentation replaces
// the row entirely), a run's primary content is always its rendered text —
// status, exit code, stdout/stderr, and the model-facing captured-artifacts
// receipt line `run.ts`'s own `formatRunResult` already appends — so this
// row always renders through the shared plain-text fallback card
// (`ScienceToolFallbackRow`) and, when the settled result's tagged
// presentation names one or more captured files, appends one clickable
// reference chip per file below that text. Activating a chip opens (or
// activates, at that exact version) that artifact's tab in the shared
// ui-science selection store and opens the Details column, exactly like
// `ScienceArtifactRow`'s own row-level activation.

import { IconDataOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ScienceArtifactPresentation, ScienceArtifactPresentationItem } from '@deepseek-ai/dsh-tool-science/types'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceRunRow.module.css'
import {
  ScienceToolFallbackRow,
  scienceToolResultText,
  scienceToolRowState,
} from './ScienceToolFallbackRow.tsx'

/** Full row props: the toolview runtime share, the shared selection store, and this package's locale seat. */
type ScienceRunRowProps = ToolCallViewProps & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** Details entry id this row opens (matches the entry ui-science registers). */
const SCIENCE_DETAILS_ID = 'science'

/** Structurally validate `block.meta` against the exact tagged, versioned shape. */
function parsePresentation(meta: unknown): ScienceArtifactPresentation | null {
  if (typeof meta !== 'object' || meta === null) return null
  const candidate = meta as Record<string, unknown>
  if (candidate.kind !== 'science/artifact' || candidate.version !== 1) return null
  if (!Array.isArray(candidate.artifacts) || !candidate.artifacts.every(isPresentationItem)) return null
  return candidate as unknown as ScienceArtifactPresentation
}

/** Structurally validate one presentation item. */
function isPresentationItem(value: unknown): value is ScienceArtifactPresentationItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  if (typeof item.artifactId !== 'string' || typeof item.logicalName !== 'string') return false
  if (typeof item.version !== 'number' || typeof item.title !== 'string') return false
  const attachment = item.attachment
  if (typeof attachment !== 'object' || attachment === null) return false
  const fields = attachment as Record<string, unknown>
  return typeof fields.attachmentId === 'string' && typeof fields.mediaType === 'string' && typeof fields.bytes === 'number'
}

/** State-derived leading icon, matching the accent-row family's icon-or-dot convention. */
function leadingFor(state: ReturnType<typeof scienceToolRowState>) {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconDataOutline16 size={14} />
  }
}

/** One clickable, compact reference to a captured or curated artifact — no image bytes fetched, text and a generic icon only. */
function ArtifactChip({ item, onSelect }: {
  item: ScienceArtifactPresentationItem
  onSelect: (selection: { artifactId: ScienceArtifactId; version: number }) => void
}) {
  return (
    <button
      type="button"
      className={css.chip}
      onClick={() => { onSelect({ artifactId: item.artifactId as ScienceArtifactId, version: item.version }) }}
    >
      <IconDataOutline16 size={12} />
      <span className={css.chipName}>{item.logicalName}</span>
      <span className={css.chipVersion}>v{item.version}</span>
    </button>
  )
}

/**
 * Render one `run_python`/`run_r` call's plain-text result plus, once
 * settled with captured files, one clickable reference chip per file.
 * @param props - keyed toolview payload, the shared selection store, and the science locale seat.
 * @returns the dedicated run row.
 */
export function ScienceRunRow({ block, toolName, openDetailsView, actions, t }: ScienceRunRowProps) {
  const state = scienceToolRowState(block)
  const meta = 'kind' in block ? block.meta : undefined
  const presentation = state === 'ok' ? parsePresentation(meta) : null
  const text = scienceToolResultText(block)
  const title = toolName === 'run_r' ? t('run.titleR') : t('run.titlePython')
  const status = state === 'running' ? t('run.running') : state === 'error' ? t('run.failed') : state === 'stopped' ? t('run.stopped') : null

  const after = presentation !== null && presentation.artifacts.length > 0
    ? (
      <div className={css.chips} role="list" aria-label={t('run.artifacts')}>
        {presentation.artifacts.map(item => (
          <ArtifactChip
            key={`${item.artifactId}:${String(item.version)}`}
            item={item}
            onSelect={(selection) => { actions.openTab(selection); openDetailsView(SCIENCE_DETAILS_ID) }}
          />
        ))}
      </div>
    )
    : undefined

  return (
    <ScienceToolFallbackRow
      dataTool="science-run"
      state={state}
      leading={leadingFor(state)}
      title={title}
      status={status}
      text={text}
      after={after}
      classes={{
        card: css.card,
        header: css.header,
        leading: css.leading,
        title: css.title,
        status: css.status,
        fallbackText: css.fallbackText,
      }}
    />
  )
}
