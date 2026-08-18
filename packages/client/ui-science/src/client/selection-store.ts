/**
 * ui-science's own package-local per-session store: which Science artifact
 * version the artifact panel and provenance view are showing, and whether
 * the shared lightbox is open for it. This is Science viewing state, so
 * ui-science owns it directly — it does not belong on `ChatStoreState`,
 * which ui-conversation owns for state its own skeleton dispatches.
 */

import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceChartId } from '@deepseek-ai/dsh-science-session/types'

/** One selected artifact version: a logical chart plus one of its versions. */
export interface ScienceArtifactSelection {
  readonly chartId: ScienceChartId
  readonly version: number
}

/**
 * Selection-store state shared by the artifact panel, transcript row, and
 * provenance view. Fields are mutable (not `readonly`): actions receive this
 * type directly as their draft parameter (`ActionsDecl`'s contract), so a
 * `readonly` field here would reject the mutation it exists to perform.
 */
export interface ScienceSelectionState {
  /** The selected artifact version, or `null` while the panel shows only the gallery. */
  selected: ScienceArtifactSelection | null
  /** Whether the shared lightbox is open for {@link ScienceSelectionState.selected}. */
  lightboxOpen: boolean
}

type ScienceSelectionActions = {
  select: (draft: ScienceSelectionState, next: ScienceArtifactSelection | null) => void
  setLightboxOpen: (draft: ScienceSelectionState, open: boolean) => void
}

/** The selection-store handle type: the registration `store:` currency shared across this package's registrations. */
export type ScienceSelectionStore = EngineStoreHandle<ScienceSelectionState, ScienceSelectionActions>

/**
 * Declare the per-session artifact-selection store. Call once per plugin
 * fiber (in `apply()`) and pass the returned handle to every registration
 * that reads or writes selection — the framework resolves one live instance
 * per (handle, session) pair, so sharing the handle is what shares the state.
 * Never export a created handle at module level: module-cache identity would
 * disguise a singleton across plugin reloads.
 * @returns the store handle.
 */
export function createScienceSelectionStore(): ScienceSelectionStore {
  return defineStore<ScienceSelectionState, ScienceSelectionActions>({
    init: (): ScienceSelectionState => ({ selected: null, lightboxOpen: false }),
    actions: {
      // A new selection closes any lightbox the prior selection had open —
      // walking to a different version should not leave a stale image
      // full-screen behind it.
      select: (draft, next) => {
        draft.selected = next
        draft.lightboxOpen = false
      },
      setLightboxOpen: (draft, open) => { draft.lightboxOpen = open },
    },
  })
}
