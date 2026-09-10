// @vitest-environment jsdom
/** Science workbench shell components and composer selection behavior. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceArtifactId } from '@deepseek-ai/dsh-science-session'
import type { ScienceClientProjection } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'
import { ScienceComposerDock } from '../src/client/ScienceComposerDock.tsx'
import { ScienceComposerChips } from '../src/client/ScienceComposerChips.tsx'
import { ScienceComposerSelections } from '../src/client/composer-selections.ts'
import { ScienceLibraryAction } from '../src/client/sidebar-entries.tsx'
import { ScienceKernelStatus } from '../src/client/ScienceKernelStatus.tsx'
import { en, zh } from '../src/client/locales.ts'

const SESSION = 'session-1' as SessionId
const t = makeTranslate(en)

afterEach(cleanup)

describe('Science library header entry', () => {
  it('opens the public guide and uses the locale label', () => {
    const openLibrary = vi.fn()
    render(<ScienceLibraryAction {...({ openLibrary, t } as Parameters<typeof ScienceLibraryAction>[0])} />)
    fireEvent.click(screen.getByRole('button', { name: t('library.home') }))
    expect(openLibrary).toHaveBeenCalledTimes(1)
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
    expect(screen.getByText('Latest kernel records')).toBeTruthy()
    expect(screen.getByText('python · epoch 3 · started')).toBeTruthy()
    expect(screen.queryByText(/live/)).toBeNull()
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

  it.each(['axes[1].title', 'title'])('uses a panel suffix only for prefixed element ids (%s)', (elementId) => {
    const selections = createSnapshotStore<readonly ScienceEditSelection[]>([{
      ...elementSpec,
      target: { kind: 'element', elementId, elementKind: 'title', axes: elementId === 'title' ? 0 : 1, label: null, current: 'Loss' },
    }])
    render(<ScienceComposerChips selections={selections.getSnapshot()} artifacts={[]} remove={vi.fn()} t={makeTranslate(zh)} />)
    expect(screen.getByText(elementId === 'title' ? 'loss.png v1 · 标题' : 'loss.png v1 · 标题 · 子图 2')).toBeTruthy()
  })

  it('renders nothing when empty and removes region and element chips', () => {
    const selections = createSnapshotStore<readonly ScienceEditSelection[]>([])
    const remove = vi.fn()
    const view = render(<ScienceComposerChips selections={selections.getSnapshot()} artifacts={[]} remove={remove} t={t} />)
    expect(view.container.firstChild).toBeNull()
    act(() => { selections.set([commented, region, elementSpec]) })
    view.rerender(<ScienceComposerChips selections={selections.getSnapshot()} artifacts={[]} remove={remove} t={t} />)
    // No matching artifact fact supplied: falls back to the wire logicalName.
    expect(screen.getByText('loss.png v1 · region 10%,20%: make it blue')).toBeTruthy()
    expect(screen.getByText('residuals.png v2 · region 10%,20%')).toBeTruthy()
    expect(screen.getByText('loss.png v1 · Title · Panel 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove loss.png v1 · region 10%,20%: make it blue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove residuals.png v2 · region 10%,20%' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove loss.png v1 · Title · Panel 1' }))
    expect(remove.mock.calls).toEqual([[0], [1], [2]])
  })

  it('shows the artifact\'s latest known title (C1), not the wire logicalName or the referenced version\'s own title', () => {
    const selections = createSnapshotStore<readonly ScienceEditSelection[]>([commented])
    const artifacts = [
      { artifactId: 'chart-1', version: 1, title: 'Loss curve (draft)', logicalName: 'loss.png' },
      { artifactId: 'chart-1', version: 2, title: 'Loss curve, final', logicalName: 'loss.png' },
    ]
    render(<ScienceComposerChips selections={selections.getSnapshot()} artifacts={artifacts} remove={vi.fn()} t={t} />)
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

it('keeps staged references usable before the Science projection is bound', () => {
  const selection: ScienceEditSelection = {
    artifactId: ScienceArtifactId('chart-1'), logicalName: 'pending.png', version: 1,
    target: { kind: 'normalized-region', x: 0, y: 0, width: 1, height: 1 },
  }
  const remove = vi.fn()
  render(<ScienceComposerDock {...({
    useProjection: () => null, useTargets: (select: (targets: readonly ScienceEditSelection[]) => unknown) => select([selection]),
    remove, t,
  } as Parameters<typeof ScienceComposerDock>[0])} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove pending.png v1 · region 0%,0%' }))
  expect(remove).toHaveBeenCalledWith(0)
})
