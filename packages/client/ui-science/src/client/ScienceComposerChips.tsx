/** Structured Science targets attached to the main composer. */

import { useSyncExternalStore } from 'react'
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'
import { scienceArtifactDisplayTitle } from './artifact-display-title.ts'
import type { ScienceDisplayTitleFact } from './artifact-display-title.ts'
import { scienceElementLabel } from './science-element-label.ts'
import css from './ScienceComposerChips.module.css'

/** Controller face injected for the addressed Session. */
export interface ScienceComposerChipsProps {
  readonly selections: SnapshotStore<readonly ScienceEditSelection[]>
  /** Live artifact version facts used to resolve each chip's artifact-level display name (C1). */
  readonly artifacts: readonly ScienceDisplayTitleFact[]
  remove: (index: number) => void
  t: TranslateNS<'science'>
}

/** Closed-union exhaustiveness fence (package-local copy; see ArtifactContent.tsx / ScienceDetailsView.tsx). */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

/** The target-specific portion of the chip label, dispatched by the target's closed `kind`. */
function targetDescriptor(target: ScienceEditSelection['target'], t: TranslateNS<'science'>): string {
  switch (target.kind) {
    case 'normalized-region':
      return t('edit.regionTarget', { x: Math.round(target.x * 100), y: Math.round(target.y * 100) })
    case 'element':
      return scienceElementLabel(target.elementKind, target.label, t, target.elementId.startsWith('axes[') && target.axes !== null ? target.axes + 1 : undefined, target.current, target.elementId)
    /* v8 ignore next -- closed ScienceEditTarget union */
    default: return assertNever(target)
  }
}

/**
 * The target-level chip label: the artifact's latest known display name
 * (C1), never `selection.logicalName` — that field stays the stable wire
 * identity Host admission validates, not what the chip shows.
 */
function targetLabel(selection: ScienceEditSelection, artifacts: readonly ScienceDisplayTitleFact[], t: TranslateNS<'science'>): string {
  const target = targetDescriptor(selection.target, t)
  const name = scienceArtifactDisplayTitle(artifacts, selection.artifactId) ?? selection.logicalName
  return `${name} v${String(selection.version)} · ${target}${selection.comment === undefined ? '' : `: ${selection.comment}`}`
}

/** Render removable targets; an empty selection contributes no chrome. */
export function ScienceComposerChips({ selections, artifacts, remove, t }: ScienceComposerChipsProps) {
  const targets = useSyncExternalStore(
    notify => selections.subscribe(notify),
    () => selections.getSnapshot(),
    /* v8 ignore next -- this browser plugin never renders through React SSR */
    () => selections.getSnapshot(),
  )
  if (targets.length === 0) return null
  return (
    <div className={css.chips} aria-label={t('edit.composerTargets')}>
      {targets.map((selection, index) => (
        <span className={css.chip} key={`${selection.artifactId}:${String(selection.version)}:${targetLabel(selection, artifacts, t)}`}>
          <span className={css.label}>{targetLabel(selection, artifacts, t)}</span>
          <button type="button" className={css.remove} aria-label={t('edit.removeTarget', { target: targetLabel(selection, artifacts, t) })} onClick={() => { remove(index) }}>
            <IconCloseFill14 size={10} />
          </button>
        </span>
      ))}
    </div>
  )
}
