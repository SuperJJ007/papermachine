/**
 * ui-science's own package-local per-session store: the open-tabs model
 * behind the artifact viewer. Which logical charts are open, which one is
 * active, whether the active tab shows its content or the provenance
 * drill-in, which provenance sub-tab is showing, and whether the shared
 * lightbox is open. This is Science viewing state, so ui-science owns it
 * directly — it does not belong on `ChatStoreState`, which ui-conversation
 * owns for state its own skeleton dispatches.
 */

import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'

/** One artifact tab open in the viewer: a logical chart and the durable version it currently shows. */
export interface ScienceOpenArtifact {
  readonly artifactId: ScienceArtifactId
  version: number
}

/** Which body the active tab shows: its rendered content, or the provenance drill-in. */
export type ScienceArtifactView = 'content' | 'provenance'

/** One provenance drill-in sub-tab. */
export type ScienceProvenanceSubTab = 'code' | 'log' | 'messages' | 'environment'

/**
 * Selection-store state shared by the artifact viewer and the transcript
 * row. Fields are mutable (not `readonly`): actions receive this type
 * directly as their draft parameter (`ActionsDecl`'s contract), so a
 * `readonly` field here would reject the mutation it exists to perform.
 *
 * The active version is deliberately not its own field: it is
 * `openArtifacts.find(tab => tab.artifactId === activeArtifactId)?.version`,
 * so there is exactly one place a tab's shown version is recorded. `view`
 * and `provenanceSubTab` are single fields, not per-tab — switching the
 * active tab always returns to `'content'` (see
 * `activateTab`/`closeTab`/`openTab` below), and the last-chosen provenance
 * sub-tab is a sticky preference carried across tabs rather than reset per
 * artifact.
 */
export interface ScienceSelectionState {
  /** Ordered open tabs — one entry per logical chart, never per version. */
  openArtifacts: ScienceOpenArtifact[]
  /** The active tab's artifact id, or `null` for the no-tab landing view (gallery + Outcome). */
  activeArtifactId: ScienceArtifactId | null
  /** content|provenance for the active tab. */
  view: ScienceArtifactView
  /** The last-selected provenance sub-tab. */
  provenanceSubTab: ScienceProvenanceSubTab
  /** Whether the shared lightbox is open for the active tab's current version. */
  lightboxOpen: boolean
}

type ScienceSelectionActions = {
  /** Open (or activate, if already open) the named artifact's tab at exactly the given version. */
  openTab: (draft: ScienceSelectionState, selection: { artifactId: ScienceArtifactId; version: number }) => void
  /** Activate an already-open tab by artifact id; an artifact id not in `openArtifacts` is a no-op. */
  activateTab: (draft: ScienceSelectionState, artifactId: ScienceArtifactId) => void
  /** Close a tab; if it was active, activate its neighbor, or fall back to the landing view when none remain. */
  closeTab: (draft: ScienceSelectionState, artifactId: ScienceArtifactId) => void
  /** Step an already-open tab to a different durable version of the same artifact. */
  setTabVersion: (draft: ScienceSelectionState, next: { artifactId: ScienceArtifactId; version: number }) => void
  /** Switch the active tab's body between content and the provenance drill-in. */
  setView: (draft: ScienceSelectionState, view: ScienceArtifactView) => void
  /** Switch the provenance drill-in's active sub-tab. */
  setProvenanceSubTab: (draft: ScienceSelectionState, subTab: ScienceProvenanceSubTab) => void
  setLightboxOpen: (draft: ScienceSelectionState, open: boolean) => void
}

/** The selection-store handle type: the registration `store:` currency shared across this package's registrations. */
export type ScienceSelectionStore = EngineStoreHandle<ScienceSelectionState, ScienceSelectionActions>

/**
 * Declare the per-session artifact-viewer store. Call once per plugin fiber
 * (in `apply()`) and pass the returned handle to every registration that
 * reads or writes it — the framework resolves one live instance per (handle,
 * session) pair, so sharing the handle is what shares the state. Never
 * export a created handle at module level: module-cache identity would
 * disguise a singleton across plugin reloads.
 * @returns the store handle.
 */
export function createScienceSelectionStore(): ScienceSelectionStore {
  return defineStore<ScienceSelectionState, ScienceSelectionActions>({
    init: (): ScienceSelectionState => ({
      openArtifacts: [], activeArtifactId: null, view: 'content', provenanceSubTab: 'code', lightboxOpen: false,
    }),
    actions: {
      openTab: (draft, selection) => {
        const existing = draft.openArtifacts.find(tab => tab.artifactId === selection.artifactId)
        if (existing === undefined) draft.openArtifacts.push({ artifactId: selection.artifactId, version: selection.version })
        else existing.version = selection.version
        draft.activeArtifactId = selection.artifactId
        draft.view = 'content'
        draft.lightboxOpen = false
      },
      activateTab: (draft, artifactId) => {
        if (!draft.openArtifacts.some(tab => tab.artifactId === artifactId)) return
        draft.activeArtifactId = artifactId
        draft.view = 'content'
        draft.lightboxOpen = false
      },
      closeTab: (draft, artifactId) => {
        const index = draft.openArtifacts.findIndex(tab => tab.artifactId === artifactId)
        if (index === -1) return
        draft.openArtifacts.splice(index, 1)
        if (draft.activeArtifactId !== artifactId) return
        // Browser-tab convention: activate whichever tab now sits at the
        // closed tab's position, or the one before it when the closed tab
        // was last; an empty ledger falls back to the landing view.
        const fallback = draft.openArtifacts[index] ?? draft.openArtifacts[index - 1]
        draft.activeArtifactId = fallback?.artifactId ?? null
        draft.view = 'content'
        draft.lightboxOpen = false
      },
      setTabVersion: (draft, next) => {
        const tab = draft.openArtifacts.find(candidate => candidate.artifactId === next.artifactId)
        if (tab === undefined) return
        tab.version = next.version
        draft.lightboxOpen = false
      },
      setView: (draft, view) => {
        draft.view = view
        // Entering the drill-in closes a stray lightbox left open over the
        // content view instead of leaving it floating above unrelated body.
        if (view === 'provenance') draft.lightboxOpen = false
      },
      setProvenanceSubTab: (draft, subTab) => { draft.provenanceSubTab = subTab },
      setLightboxOpen: (draft, open) => { draft.lightboxOpen = open },
    },
  })
}
