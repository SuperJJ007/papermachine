/**
 * ui-science's own package-local per-session store: the open-tabs model
 * behind the artifact viewer. Which logical charts are open, which one is
 * active, whether the active tab shows its content or the provenance
 * drill-in, which provenance sub-tab is showing, and whether the shared
 * lightbox is open. This is Science viewing state, so ui-science owns it
 * directly — it does not belong on `ChatStoreState`, which ui-conversation
 * owns for state its own skeleton dispatches.
 */

import type { ScienceLibraryArtifact } from './library-artifact.ts'
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'

/** One artifact tab open in the viewer: a logical chart and the durable version it currently shows. */
export interface ScienceOpenArtifact {
  readonly kind: 'artifact'
  readonly artifactId: ScienceArtifactId
  version: number
}

/** One read-only project file tab. */
export interface ScienceOpenFile { readonly kind: 'file'; readonly path: string }

/** Open document kinds supported by the Science file library. */
export type ScienceOpenTab = ScienceOpenArtifact | ScienceOpenFile

/**
 * Return the stable id shared by selection state and DOM keys.
 * @param tab - Open artifact or workspace-file tab.
 * @returns Kind-prefixed tab id.
 */
export function scienceTabId(tab: ScienceOpenTab): string {
  switch (tab.kind) {
    case 'artifact': return `artifact:${tab.artifactId}`
    case 'file': return `file:${tab.path}`
    /* v8 ignore next 2 -- merge-extensible tab kinds fail loud until their renderer lands */
    default: return assertNever(tab)
  }
}

/* v8 ignore next -- reached only through a forged, unimplemented tab kind */
function assertNever(value: never): never { throw new Error(`Unsupported Science tab: ${JSON.stringify(value)}`) }

function normalizedTabId(value: string): string {
  return value.startsWith('artifact:') || value.startsWith('file:') ? value : `artifact:${value}`
}

/** Which body the active tab shows: its rendered content, or the provenance drill-in. */
export type ScienceArtifactView = 'content' | 'provenance'

/** Which project-library page the Details header selects. */
export type ScienceLibraryPage = 'artifacts' | 'files'

/** One provenance drill-in sub-tab. */
export type ScienceProvenanceSubTab = 'code' | 'log' | 'messages' | 'environment'

/**
 * Selection-store state shared by the artifact viewer and the transcript
 * row. Fields are mutable (not `readonly`): actions receive this type
 * directly as their draft parameter (`ActionsDecl`'s contract), so a
 * `readonly` field here would reject the mutation it exists to perform.
 *
 * The active version is deliberately not its own field: it is
 * `openArtifacts.find(tab => scienceTabId(tab) === activeTabId)`,
 * so there is exactly one place a tab's shown version is recorded. `view`
 * and `provenanceSubTab` are single fields, not per-tab — switching the
 * active tab always returns to `'content'` (see
 * `activateTab`/`closeTab`/`openTab` below), and the last-chosen provenance
 * sub-tab is a sticky preference carried across tabs rather than reset per
 * artifact.
 */
export interface ScienceSelectionState {
  /** Ordered open artifact and file tabs. */
  openArtifacts: ScienceOpenTab[]
  /** Selected project-library records shared by the header tabs and preview body. */
  libraryTabs: Record<string, ScienceLibraryArtifact>
  /** The active document id, or `null` while the library is showing. */
  activeTabId: string | null
  /** The project-library page shown whenever no document tab is active. */
  libraryPage: ScienceLibraryPage
  /** Origin-session groups collapsed in the artifact library; absent groups are expanded. */
  libraryCollapsed: Record<string, true>
  /** content|provenance for the active tab. */
  view: ScienceArtifactView
  /** The last-selected provenance sub-tab. */
  provenanceSubTab: ScienceProvenanceSubTab
  /** Whether the shared lightbox is open for the active tab's current version. */
  lightboxOpen: boolean
}

type ScienceSelectionActions = {
  /** Retain selected library metadata for the open preview and its title. */
  rememberLibraryArtifact: (draft: ScienceSelectionState, artifact: ScienceLibraryArtifact) => void
  /** Show the artifact library without closing any artifact tabs. */
  showLibrary: (draft: ScienceSelectionState) => void
  /** Select the artifact or project-files library page. */
  setLibraryPage: (draft: ScienceSelectionState, page: ScienceLibraryPage) => void
  /** Toggle one origin-session group without changing the open document or library page. */
  toggleLibraryGroup: (draft: ScienceSelectionState, sessionId: string) => void
  /** Open (or activate, if already open) the named artifact's tab at exactly the given version. */
  openTab: (draft: ScienceSelectionState, selection: { artifactId: ScienceArtifactId; version: number }) => void
  /** Open or activate one read-only workspace file. */
  openFileTab: (draft: ScienceSelectionState, path: string) => void
  /** Activate an already-open tab by artifact id; an artifact id not in `openArtifacts` is a no-op. */
  activateTab: (draft: ScienceSelectionState, tabId: string) => void
  /** Close a tab; if it was active, activate its neighbor, or fall back to the landing view when none remain. */
  closeTab: (draft: ScienceSelectionState, tabId: string) => void
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
      libraryCollapsed: {}, libraryTabs: {}, openArtifacts: [], activeTabId: null, libraryPage: 'artifacts', view: 'content', provenanceSubTab: 'code', lightboxOpen: false,
    }),
    persist: 'dsh.science.selection.v1',
    actions: {
      rememberLibraryArtifact: (draft, artifact) => { draft.libraryTabs[artifact.artifactId] = artifact },
      showLibrary: (draft) => {
        draft.activeTabId = null
        draft.view = 'content'
        draft.lightboxOpen = false
      },
      setLibraryPage: (draft, page) => { draft.libraryPage = page },
      toggleLibraryGroup: (draft, sessionId) => {
        if (draft.libraryCollapsed[sessionId]) Reflect.deleteProperty(draft.libraryCollapsed, sessionId)
        else draft.libraryCollapsed[sessionId] = true
      },
      openTab: (draft, selection) => {
        const existing = draft.openArtifacts.find((tab): tab is ScienceOpenArtifact => tab.kind === 'artifact' && tab.artifactId === selection.artifactId)
        if (existing === undefined) draft.openArtifacts.push({ kind: 'artifact', artifactId: selection.artifactId, version: selection.version })
        else existing.version = selection.version
        draft.activeTabId = `artifact:${selection.artifactId}`
        draft.view = 'content'
        draft.lightboxOpen = false
      },
      openFileTab: (draft, path) => {
        if (!draft.openArtifacts.some(tab => tab.kind === 'file' && tab.path === path)) draft.openArtifacts.push({ kind: 'file', path })
        draft.activeTabId = `file:${path}`
        draft.view = 'content'
        draft.lightboxOpen = false
      },
      activateTab: (draft, tabId) => {
        const id = normalizedTabId(tabId)
        if (!draft.openArtifacts.some(tab => scienceTabId(tab) === id)) return
        draft.activeTabId = id
        draft.view = 'content'
        draft.lightboxOpen = false
      },
      closeTab: (draft, tabId) => {
        const id = normalizedTabId(tabId)
        const index = draft.openArtifacts.findIndex(tab => scienceTabId(tab) === id)
        if (index === -1) return
        draft.openArtifacts.splice(index, 1)
        if (draft.activeTabId !== id) return
        // Browser-tab convention: activate whichever tab now sits at the
        // closed tab's position, or the one before it when the closed tab
        // was last; an empty ledger falls back to the landing view.
        const fallback = draft.openArtifacts[index] ?? draft.openArtifacts[index - 1]
        draft.activeTabId = fallback === undefined ? null : scienceTabId(fallback)
        draft.view = 'content'
        draft.lightboxOpen = false
      },
      setTabVersion: (draft, next) => {
        const tab = draft.openArtifacts.find((candidate): candidate is ScienceOpenArtifact => candidate.kind === 'artifact' && candidate.artifactId === next.artifactId)
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
