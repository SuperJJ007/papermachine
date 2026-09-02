/**
 * Shared fixtures for the `ScienceDetailsView` split spec files
 * (`ScienceDetailsView.*.client.spec.tsx`): session-log artifact identity
 * (`ScienceClientArtifactVersion`, all a live tab needs from `science.artifacts`),
 * the store's current-facts row (`ScienceVersionSummary`, what `loadVersions`
 * resolves), the project-library row (`ScienceLibraryArtifact`, what
 * `loadLibrary` resolves), and the full `ScienceDetailsViewProps` fixture. The
 * post-T1/T2 split is deliberate: a raw artifact carries only identity
 * (`artifactId`/`version`/`versionId`/`sha256`/the commit-time
 * `title`/`caption`), so a live tab's title, media type, byte count, and
 * content origin come only from an explicit `ScienceVersionSummary` a test
 * wires through `loadVersions` — never derived from the raw artifact, matching
 * production (`version-summaries.ts`).
 */
import { useRef } from 'react'
import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type ConversationSnapshot, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ScienceArtifactId, ScienceArtifactNote, ScienceClientArtifactVersion, ScienceClientProjection, ScienceVersionId,
} from '@deepseek-ai/dsh-science-session/types'
import type { ScienceDetailsViewProps } from '../src/client/ScienceDetailsView.tsx'
import type { ScienceLibraryArtifact, ScienceVersionSummary } from '../src/client/library-artifact.ts'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

export const SESSION = 'session-1' as SessionId
export const t: ScienceDetailsViewProps['t'] = makeTranslate(en)

export function baseProjection(over: Partial<ScienceClientProjection> = {}): ScienceClientProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: null,
    runs: [],
    kernels: [],
    artifacts: [],
    trace: { turns: [], calls: [] },
    outcome: null,
    metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, outcomeRevision: 0, kernelCount: 0 },
    lastScienceEventSeq: 1,
    ...over,
  }
}

/** `rawArtifact`/`note` overrides: plain strings for the branded id fields, cast once at construction. */
type RawArtifactOverrides = Omit<Partial<ScienceClientArtifactVersion>, 'artifactId' | 'versionId'> & {
  artifactId?: string
  versionId?: string
}

/** Session-log identity for one artifact version — everything `science.artifacts` carries post-T1/T2. */
export function rawArtifact(over: RawArtifactOverrides = {}): ScienceClientArtifactVersion {
  const { artifactId, versionId, ...fields } = over
  return {
    artifactId: (artifactId ?? 'chart-1') as ScienceArtifactId,
    logicalName: 'loss-curve.png',
    version: 1,
    title: 'Loss curve',
    versionId: (versionId ?? `version:${String(over.version ?? 1)}`) as ScienceVersionId,
    sha256: 'a'.repeat(64),
    seenAt: 500,
    ...fields,
  }
}

/** Cast a plain test-fixture string into the branded `ScienceArtifactId` `store.actions.openTab` requires. */
export function openTab(store: ReturnType<typeof testScienceSelectionStore>, artifactId: string, version: number): void {
  store.actions.openTab({ artifactId: artifactId as ScienceArtifactId, version })
}

/** The store's current-facts row for one version, as `sessions.scienceVersions` (`loadVersions`) resolves it. */
export function versionSummary(over: Partial<ScienceVersionSummary> = {}): ScienceVersionSummary {
  return {
    versionId: `version:${String(over.ordinal ?? 1)}`,
    artifactId: 'chart-1',
    logicalName: 'loss-curve.png',
    ordinal: 1,
    title: 'Loss curve',
    contentOrigin: 'run-auto',
    createdAt: 500,
    mediaType: 'image/png',
    byteCount: 100,
    ...over,
  }
}

/**
 * `libraryArtifact` overrides: `title: undefined`/`originSessionTitle: undefined`
 * explicitly clear the default (rather than being merely absent), to exercise
 * `ProjectLibrary`'s own `title ?? logicalName` / `unknownSession` fallbacks —
 * `exactOptionalPropertyTypes` treats an explicit `undefined` on `Partial<T>`'s
 * optional field as a type error, so this override type names both states
 * (present, or explicitly cleared) instead of `Partial<ScienceLibraryArtifact>`.
 */
type LibraryArtifactOverrides = Omit<Partial<ScienceLibraryArtifact>, 'title' | 'originSessionTitle'> & {
  title?: string | undefined
  originSessionTitle?: string | undefined
}

/** One project-library row, as `scienceLibrary` (`loadLibrary`) resolves it. */
export function libraryArtifact(over: LibraryArtifactOverrides = {}): ScienceLibraryArtifact {
  const { latest, title, originSessionTitle, ...fields } = over
  return {
    artifactId: 'chart-1',
    logicalName: 'loss-curve.png',
    originSessionId: SESSION,
    ...('title' in over ? (title === undefined ? {} : { title }) : { title: 'Loss curve' }),
    ...('originSessionTitle' in over
      ? (originSessionTitle === undefined ? {} : { originSessionTitle })
      : { originSessionTitle: 'Current analysis' }),
    ...fields,
    latest: {
      versionId: 'version:1', ordinal: 1, mediaType: 'image/png', byteCount: 100, createdAt: 500,
      ...latest,
    },
  }
}

export function note(over: Omit<Partial<ScienceArtifactNote>, 'artifactId'> & { artifactId?: string } = {}): ScienceArtifactNote {
  const { artifactId, ...fields } = over
  return {
    seq: 1, artifactId: (artifactId ?? 'chart-1') as ScienceArtifactId, version: 1, text: 'Keep this label', createdAt: 1_000,
    ...fields,
  }
}

export function emptySnapshot(): ConversationSnapshot {
  return { nodes: [], chat: { nodes: { get: () => undefined, values: () => [] } } } as unknown as ConversationSnapshot
}

type Props = ScienceDetailsViewProps

/**
 * Build one full `ScienceDetailsViewProps` fixture. `over.summaries` seeds the
 * default `loadVersions` mock (resolves exactly the requested, known
 * `versionId`s — an id absent from `summaries` is silently omitted, matching
 * `sessions.scienceVersions`'s own authorization-omission rule); `over.libraryArtifacts`
 * seeds the default `loadLibrary` mock. Every field not explicitly listed on
 * `PropsRuntime<'conversation.details.view'>` that the current component
 * never reads (`useSession`, `inspectCall`, `returnToConversation`, …) is
 * intentionally absent — the cast below is what lets this fixture carry only
 * what `ScienceDetailsView.tsx` actually destructures.
 */
export function props(
  science: ScienceClientProjection | null | undefined,
  over: {
    loadImage?: Props['loadImage']
    loadText?: Props['loadText']
    loadChartState?: Props['loadChartState']
    loadVersions?: Props['loadVersions']
    loadLibrary?: Props['loadLibrary']
    loadWorkspaceFiles?: Props['loadWorkspaceFiles']
    loadWorkspaceFile?: Props['loadWorkspaceFile']
    addToConversation?: Props['addToConversation']
    removeFromConversation?: Props['removeFromConversation']
    composerSelections?: Props['composerSelections']
    store?: ReturnType<typeof testScienceSelectionStore>
    notes?: readonly ScienceArtifactNote[]
    addArtifactNote?: Props['addArtifactNote']
    removeArtifactNote?: Props['removeArtifactNote']
    applyChartOps?: Props['applyChartOps']
    previewChartOps?: Props['previewChartOps']
    saveArtifactAs?: Props['saveArtifactAs']
    summaries?: readonly ScienceVersionSummary[]
    libraryArtifacts?: readonly ScienceLibraryArtifact[]
    health?: { orphan: number; reconstructed: number; missingContent: number }
  } = {},
): Props {
  const store = over.store ?? testScienceSelectionStore()
  const summaries = over.summaries ?? []
  const libraryArtifacts = over.libraryArtifacts ?? []
  return {
    sessionId: SESSION,
    // Present only because `SessionStandardProps` declaration-merges in a
    // hook every session-scoped slot's props type carries; the current
    // component never calls it.
    useSession: (select: (s: ConversationSnapshot) => unknown) => {
      const ref = useRef<{ value: unknown }>({ value: undefined })
      ref.current = { value: select(emptySnapshot()) }
      return ref.current.value
    },
    useProjection: vi.fn((key: string) => key === 'science' ? science : (over.notes ?? [])),
    useStore: store.useStore,
    actions: store.actions,
    loadImage: over.loadImage ?? vi.fn().mockResolvedValue('data:image/png;base64,abc'),
    loadText: over.loadText ?? vi.fn().mockResolvedValue('a,b\n1,2\n'),
    loadChartState: over.loadChartState ?? vi.fn().mockResolvedValue(null),
    loadVersions: over.loadVersions ?? vi.fn((ids: readonly string[]) => Promise.resolve({
      ok: true, value: { versions: summaries.filter(item => ids.includes(item.versionId)) },
    })),
    loadLibrary: over.loadLibrary ?? vi.fn().mockResolvedValue({
      ok: true, value: { projectId: 'project-1', artifacts: libraryArtifacts, ...over.health === undefined ? {} : { health: over.health } },
    }),
    loadWorkspaceFiles: over.loadWorkspaceFiles ?? vi.fn().mockResolvedValue({ ok: true, value: { root: '', entries: [] } }),
    loadWorkspaceFile: over.loadWorkspaceFile ?? vi.fn().mockResolvedValue({ ok: false, error: { code: 'internal', message: 'missing', details: {} } }),
    addToConversation: over.addToConversation ?? vi.fn(),
    removeFromConversation: over.removeFromConversation ?? vi.fn(),
    composerSelections: over.composerSelections ?? createSnapshotStore([]),
    addArtifactNote: over.addArtifactNote ?? vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } }),
    removeArtifactNote: over.removeArtifactNote ?? vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } }),
    applyChartOps: over.applyChartOps ?? vi.fn().mockResolvedValue({
      ok: true, value: { artifactId: 'chart-1', version: 2, origin: 'human-edit', failedOps: [] },
    }),
    previewChartOps: over.previewChartOps ?? vi.fn().mockResolvedValue({ ok: false, error: { message: 'no preview configured' } }),
    saveArtifactAs: over.saveArtifactAs ?? vi.fn().mockResolvedValue({
      ok: true, value: { artifactId: 'chart-1-copy', logicalName: 'copy.png', version: 1 },
    }),
    t,
  } as unknown as Props
}

/** The whole-panel status text; throws if the panel shows zero or more than one `role="status"` node. */
export function statusText(): string {
  return screen.getByRole('status').textContent ?? ''
}
