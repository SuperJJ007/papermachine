// @vitest-environment jsdom
/** Science workbench shell components and composer selection behavior. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceArtifactId } from '@deepseek-ai/dsh-science-session'
import type { ScienceClientProjection } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'
import { ScienceComposerChips } from '../src/client/ScienceComposerChips.tsx'
import { ScienceComposerSelections } from '../src/client/composer-selections.ts'
import { ScienceDestinations } from '../src/client/ScienceDestinations.tsx'
import { ScienceEmptyDetails } from '../src/client/ScienceEmptyDetails.tsx'
import { ScienceGlobalToggle } from '../src/client/ScienceGlobalToggle.tsx'
import { ScienceKernelStatus } from '../src/client/ScienceKernelStatus.tsx'
import { en } from '../src/client/locales.ts'

const SESSION = 'session-1' as SessionId
const t = makeTranslate(en)

afterEach(cleanup)

function sessionState(current: SessionId | undefined): SessionListState {
  return {
    ids: current === undefined ? [] : [current],
    byId: current === undefined ? {} : {
      [current]: { id: current, displayTitle: 'Session', running: false, blank: false, updatedAt: 1, agentPreset: 'science' },
    },
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

describe('ScienceDestinations', () => {
  it('renders the Files destination and opens it for the current Session', () => {
    const openScience = vi.fn()
    render(<ScienceDestinations {...({
      wide: true,
      useSessions: bindSnapshotSelector(createSnapshotStore(sessionState(SESSION))),
      openScience,
      t,
    } as unknown as Parameters<typeof ScienceDestinations>[0])} />)
    expect(screen.queryByRole('button', { name: 'Sessions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.queryByRole('button', { name: 'Outcomes' })).toBeNull()
    expect(openScience).toHaveBeenCalledWith(SESSION)
  })

  it('renders no Science destinations without a current Science Session', () => {
    const openScience = vi.fn()
    render(<ScienceDestinations {...({
      wide: false,
      useSessions: bindSnapshotSelector(createSnapshotStore(sessionState(undefined))),
      openScience,
      t,
    } as unknown as Parameters<typeof ScienceDestinations>[0])} />)
    expect(screen.queryByRole('button', { name: 'Files' })).toBeNull()
    expect(openScience).not.toHaveBeenCalled()
  })

  it('renders compact rail destinations with localized titles', () => {
    render(<ScienceDestinations {...({
      wide: false,
      useSessions: bindSnapshotSelector(createSnapshotStore(sessionState(SESSION))),
      openScience: vi.fn(),
      t,
    } as unknown as Parameters<typeof ScienceDestinations>[0])} />)
    expect(screen.getByRole('button', { name: 'Files' }).getAttribute('title')).toBe('Files')
    expect(screen.queryByText('Files')).toBeNull()
  })
})

describe('ScienceEmptyDetails', () => {
  it('explains the empty project and closes through the owner action', () => {
    const closeDetails = vi.fn()
    render(<ScienceEmptyDetails {...({ closeDetails, t } as unknown as Parameters<typeof ScienceEmptyDetails>[0])} />)
    expect(screen.getByText(en['details.artifacts.chooseSession'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(closeDetails).toHaveBeenCalledTimes(1)
  })
})

describe('ScienceGlobalToggle', () => {
  it('renders the Files button unconditionally and toggles the shared Details column', () => {
    const toggleDetails = vi.fn()
    render(<ScienceGlobalToggle {...({ toggleDetails, t } as unknown as Parameters<typeof ScienceGlobalToggle>[0])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Science details' }))
    expect(toggleDetails).toHaveBeenCalledTimes(1)
  })
})

describe('ScienceKernelStatus', () => {
  function view(projection: ScienceClientProjection | null | undefined) {
    return render(<ScienceKernelStatus {...({
      useProjection: () => projection,
      t,
    } as unknown as Parameters<typeof ScienceKernelStatus>[0])} />)
  }

  it('renders nothing for unsupported, unbound, or kernel-free projections', () => {
    expect(view(undefined).container.firstChild).toBeNull()
    cleanup()
    expect(view(null).container.firstChild).toBeNull()
    cleanup()
    expect(view({ kernels: [] } as unknown as ScienceClientProjection).container.firstChild).toBeNull()
  })

  it('shows only each language latest lifecycle state', () => {
    view({ kernels: [
      { language: 'python', kernelEpoch: 1, state: 'started' },
      { language: 'python', kernelEpoch: 2, state: 'exited' },
      { language: 'r', kernelEpoch: 1, state: 'interrupted' },
    ] } as unknown as ScienceClientProjection)
    expect(screen.queryByText(/python · epoch 1/)).toBeNull()
    expect(screen.getByText('python · epoch 2 · exited')).toBeTruthy()
    expect(screen.getByText('r · epoch 1 · interrupted')).toBeTruthy()
    cleanup()
    view({ kernels: [{ language: 'python', kernelEpoch: 3, state: 'started' }] } as unknown as ScienceClientProjection)
    expect(screen.getByText('python · epoch 3 · live')).toBeTruthy()
  })
})

describe('Science composer targets', () => {
  const spec: ScienceEditSelection = {
    artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1,
    target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  }
  const commented: ScienceEditSelection = { ...spec, comment: 'make it blue' }
  const region: ScienceEditSelection = {
    artifactId: ScienceArtifactId('image-1'), logicalName: 'residuals.png', version: 2,
    target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  }

  const elementSpec: ScienceEditSelection = {
    artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1,
    target: { kind: 'element', elementId: 'axes[0].title', elementKind: 'title', axes: 0, label: null, current: 'Loss' },
  }

  it('renders nothing when empty and removes region and element chips', () => {
    const selections = createSnapshotStore<readonly ScienceEditSelection[]>([])
    const remove = vi.fn()
    const view = render(<ScienceComposerChips selections={selections} artifacts={[]} remove={remove} t={t} />)
    expect(view.container.firstChild).toBeNull()
    act(() => { selections.set([commented, region, elementSpec]) })
    // No matching artifact fact supplied: falls back to the wire logicalName.
    expect(screen.getByText('loss.png v1 · region 10%,20%: make it blue')).toBeTruthy()
    expect(screen.getByText('residuals.png v2 · region 10%,20%')).toBeTruthy()
    expect(screen.getByText('loss.png v1 · Title')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove loss.png v1 · region 10%,20%: make it blue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove residuals.png v2 · region 10%,20%' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove loss.png v1 · Title' }))
    expect(remove.mock.calls).toEqual([[0], [1], [2]])
  })

  it('shows the artifact\'s latest known title (C1), not the wire logicalName or the referenced version\'s own title', () => {
    const selections = createSnapshotStore<readonly ScienceEditSelection[]>([commented])
    const artifacts = [
      { artifactId: 'chart-1', version: 1, title: 'Loss curve (draft)', logicalName: 'loss.png' },
      { artifactId: 'chart-1', version: 2, title: 'Loss curve, final', logicalName: 'loss.png' },
    ]
    render(<ScienceComposerChips selections={selections} artifacts={artifacts} remove={vi.fn()} t={t} />)
    expect(screen.getByText('Loss curve, final v1 · region 10%,20%: make it blue')).toBeTruthy()
    expect(screen.queryByText(/^loss\.png/)).toBeNull()
  })

  it('deduplicates exact selections, preserves distinct versions and targets, removes, and clears per Session', () => {
    const selections = new ScienceComposerSelections()
    expect(selections.store(SESSION)).toBe(selections.store(SESSION))
    selections.add(SESSION, [spec, spec])
    selections.add(SESSION, [
      { ...spec, version: 2 },
      { ...spec, artifactId: ScienceArtifactId('chart-2') },
      { ...spec, target: { kind: 'normalized-region', x: 0.2, y: 0.2, width: 0.3, height: 0.4 } },
    ])
    expect(selections.store(SESSION).getSnapshot()).toHaveLength(4)
    selections.removeSelection(SESSION, { ...spec, target: { kind: 'normalized-region', x: 0.2, y: 0.2, width: 0.3, height: 0.4 } })
    expect(selections.store(SESSION).getSnapshot()).toHaveLength(3)
    selections.remove(SESSION, 1)
    expect(selections.store(SESSION).getSnapshot()).toHaveLength(2)
    selections.clear(SESSION)
    expect(selections.store(SESSION).getSnapshot()).toEqual([])
  })
})
