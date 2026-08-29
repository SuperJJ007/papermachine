/** Structured Science targets attached to the main composer. */

import { useSyncExternalStore } from 'react'
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'
import css from './ScienceComposerChips.module.css'

/** Controller face injected for the addressed Session. */
export interface ScienceComposerChipsProps {
  readonly selections: SnapshotStore<readonly ScienceEditSelection[]>
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
      return target.elementId
    /* v8 ignore next -- closed ScienceEditTarget union */
    default: return assertNever(target)
  }
}

function targetLabel(selection: ScienceEditSelection, t: TranslateNS<'science'>): string {
  const target = targetDescriptor(selection.target, t)
  return `${selection.artifactId} v${String(selection.version)} · ${target}${selection.comment === undefined ? '' : `: ${selection.comment}`}`
}

/** Render removable targets; an empty selection contributes no chrome. */
export function ScienceComposerChips({ selections, remove, t }: ScienceComposerChipsProps) {
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
        <span className={css.chip} key={`${selection.artifactId}:${String(selection.version)}:${targetLabel(selection, t)}`}>
          <span className={css.label}>{targetLabel(selection, t)}</span>
          <button type="button" className={css.remove} aria-label={t('edit.removeTarget', { target: targetLabel(selection, t) })} onClick={() => { remove(index) }}>
            <IconCloseFill14 size={10} />
          </button>
        </span>
      ))}
    </div>
  )
}
