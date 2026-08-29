// @vitest-environment jsdom
/** Turn-end Science artifacts deduplicate by logical id and open exact final versions. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ScienceTurnArtifacts } from '../src/client/ScienceTurnArtifacts.tsx'
import { scienceTurnArtifactsDefinition, selectScienceTurnArtifacts } from '../src/client/science-turn-artifacts.ts'
import type { ScienceTurnArtifactsProps } from '../src/client/ScienceTurnArtifacts.tsx'
import { zh } from '../src/client/locales.ts'
import type { ScienceImageLoader } from '../src/client/science-attachment-loader.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

const reader: Parameters<typeof scienceTurnArtifactsDefinition.start>[2] = { previous: () => undefined }

const t = makeTranslate(zh, commonZh)
afterEach(cleanup)

const v1 = { artifactId: 'a-1', logicalName: 'result.csv', version: 1, title: 'Result',
  content: { versionId: 'version-a', mediaType: 'text/csv', byteCount: 10 } }
const v2 = { ...v1, version: 2, content: { ...v1.content, versionId: 'version-b' } }
const second = { artifactId: 'a-2', logicalName: 'plot.json', version: 1, title: 'Plot',
  content: { versionId: 'version-c', mediaType: 'application/json', byteCount: 20 } }

function startTurn() {
  return scienceTurnArtifactsDefinition.start(
    {} as never, { event: { type: 'turn/start', data: { turn: 4 } } } as never, reader,
  )
}

function updateWith(state: ReturnType<typeof startTurn>, artifacts: unknown[]) {
  return scienceTurnArtifactsDefinition.update(
    { state } as never,
    { event: { type: 'tool/result', data: { meta: { kind: 'science/artifact', version: 2, artifacts } } } } as never,
  )
}

describe('scienceTurnArtifactsDefinition', () => {
  it('keeps one final version per artifact id across a Turn', () => {
    const afterFirst = updateWith(startTurn(), [v1, second])
    const afterSecond = updateWith(afterFirst, [v2])
    expect(afterSecond.artifacts).toEqual([v2, second])
  })

  it('discards a stale replacement instead of overwriting a newer already-seen version', () => {
    const afterV2 = updateWith(startTurn(), [v2])
    const afterStaleV1 = updateWith(afterV2, [v1])
    expect(afterStaleV1.artifacts).toEqual([v2])
  })

  it('rejects a start invoked from anything but its own turn/start match', () => {
    expect(() => scienceTurnArtifactsDefinition.start(
      {} as never, { event: { type: 'tool/result', data: {} } } as never, reader,
    )).toThrow('science-turn-artifacts start requires turn/start')
  })

  it('claims turn/start and an appended tool/result, and declines every other event', () => {
    expect(scienceTurnArtifactsDefinition.match({ type: 'turn/start', data: { turn: 4 } } as never))
      .toEqual({ id: '4', role: 'start' })
    expect(scienceTurnArtifactsDefinition.match({ type: 'tool/result', surfaceOp: 'append', data: { turn: 4 } } as never))
      .toEqual({ id: '4', role: 'update' })
    expect(scienceTurnArtifactsDefinition.match(
      { type: 'tool/result', surfaceOp: { op: 'replace', start: 1, end: 1 }, data: { turn: 4 } } as never,
    )).toBeNull()
    expect(scienceTurnArtifactsDefinition.match({ type: 'turn/end', data: { turn: 4 } } as never)).toBeNull()
  })

  it('leaves state untouched for every malformed presentation shape', () => {
    const start = startTurn()
    const updateMeta = (meta: unknown) => scienceTurnArtifactsDefinition.update(
      { state: start } as never,
      { event: { type: 'tool/result', data: { meta } } } as never,
    )
    const malformedMetas: unknown[] = [
      null,
      'not-an-object',
      ['array-not-record'],
      { kind: 'other', version: 1, artifacts: [] },
      { kind: 'science/artifact', version: 1, artifacts: [] },
      { kind: 'science/artifact', version: 2, artifacts: 'not-an-array' },
      { kind: 'science/artifact', version: 2, artifacts: ['not-an-object'] },
      { kind: 'science/artifact', version: 2, artifacts: [{ ...v1, artifactId: 1 }] },
      { kind: 'science/artifact', version: 2, artifacts: [{ ...v1, logicalName: 1 }] },
      { kind: 'science/artifact', version: 2, artifacts: [{ ...v1, version: '1' }] },
      { kind: 'science/artifact', version: 2, artifacts: [{ ...v1, title: 1 }] },
      { kind: 'science/artifact', version: 2, artifacts: [{ ...v1, content: null }] },
      { kind: 'science/artifact', version: 2, artifacts: [{ ...v1, content: { ...v1.content, versionId: 1 } }] },
      { kind: 'science/artifact', version: 2, artifacts: [{ ...v1, content: { ...v1.content, mediaType: 1 } }] },
      { kind: 'science/artifact', version: 2, artifacts: [{ ...v1, content: { ...v1.content, byteCount: '10' } }] },
    ]
    for (const meta of malformedMetas) expect(updateMeta(meta)).toBe(start)
    // A non-`tool/result` update is ignored outright.
    expect(scienceTurnArtifactsDefinition.update(
      { state: start } as never, { event: { type: 'turn/end', data: {} } } as never,
    )).toBe(start)
  })

  it('publishes Turn Location data only inside the turn scope, and only once state exists', () => {
    if (scienceTurnArtifactsDefinition.buildLocationData === undefined) throw new Error('expected buildLocationData')
    const state = { turn: 4, artifacts: [v1] }
    expect(scienceTurnArtifactsDefinition.buildLocationData({ state } as never, 'step')).toBeNull()
    expect(scienceTurnArtifactsDefinition.buildLocationData({ state: undefined } as never, 'turn')).toBeNull()
    expect(scienceTurnArtifactsDefinition.buildLocationData({ state } as never, 'turn')).toEqual({
      kind: 'turn', turn: 4, key: 'science-turn-artifacts', value: { artifacts: [v1] },
    })
  })
})

describe('selectScienceTurnArtifacts', () => {
  it('declines a Turn with no published data or an empty artifact list', () => {
    const dataStore = { get: () => undefined }
    expect(selectScienceTurnArtifacts({ turn: { data: dataStore } } as never)).toBeNull()
    const emptyStore = { get: () => ({ artifacts: [] }) }
    expect(selectScienceTurnArtifacts({ turn: { data: emptyStore } } as never)).toBeNull()
  })

  it('claims a Turn once it published at least one artifact', () => {
    const store = { get: () => ({ artifacts: [v1] }) }
    expect(selectScienceTurnArtifacts({ turn: { data: store } } as never)).toEqual({ artifacts: [v1] })
  })
})

describe('ScienceTurnArtifacts', () => {
  it('renders the Turn group once and opens the clicked exact version', () => {
    const store = testScienceSelectionStore()
    const openArtifact = vi.fn()
    render(<ScienceTurnArtifacts {...({
      matched: { artifacts: [v2, second] }, actions: store.actions, useStore: store.useStore,
      loadImage: vi.fn(), openArtifact, t, sessionId: 'session-1',
    } as unknown as ScienceTurnArtifactsProps)} />)
    expect(screen.getByText('本轮产出 2 个文件')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(screen.getByRole('listitem', { name: /^Result/u }))
    expect(store.instance.getSnapshot().openArtifacts).toEqual([{ kind: 'artifact', artifactId: 'a-1', version: 2 }])
    expect(openArtifact).toHaveBeenCalledTimes(1)
  })

  it('falls back to the logical name when the kept version has no curated title', () => {
    const store = testScienceSelectionStore()
    render(<ScienceTurnArtifacts {...({
      matched: { artifacts: [{ ...v2, title: '' }] }, actions: store.actions, useStore: store.useStore,
      loadImage: vi.fn(), openArtifact: vi.fn(), t, sessionId: 'session-1',
    } as unknown as ScienceTurnArtifactsProps)} />)
    expect(screen.getByRole('listitem', { name: 'result.csv v2' })).toBeTruthy()
  })

  it('loads a thumbnail for a dimensioned image artifact', async () => {
    const store = testScienceSelectionStore()
    const chart = { artifactId: 'a-3', logicalName: 'plot.png', version: 1, title: 'Plot',
      content: { versionId: 'version-d', mediaType: 'image/png', byteCount: 30 } }
    const loadImage = vi.fn<ScienceImageLoader>().mockResolvedValue('blob:fake-url')
    const view = render(<ScienceTurnArtifacts {...({
      matched: { artifacts: [chart] }, actions: store.actions, useStore: store.useStore,
      loadImage, openArtifact: vi.fn(), t, sessionId: 'session-1',
    } as unknown as ScienceTurnArtifactsProps)} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    expect(loadImage).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version-d' }))
    await waitFor(() => { expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:fake-url') })
  })

  it('keeps the media-type tile when a dimensioned image fails to load', async () => {
    const store = testScienceSelectionStore()
    const chart = { artifactId: 'a-4', logicalName: 'plot2.png', version: 1, title: 'Plot 2',
      content: { versionId: 'version-e', mediaType: 'image/png', byteCount: 30 } }
    const loadImage = vi.fn<ScienceImageLoader>().mockRejectedValue(new Error('load failed'))
    const view = render(<ScienceTurnArtifacts {...({
      matched: { artifacts: [chart] }, actions: store.actions, useStore: store.useStore,
      loadImage, openArtifact: vi.fn(), t, sessionId: 'session-1',
    } as unknown as ScienceTurnArtifactsProps)} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    // The component's own .catch() is chained onto this same promise ahead of
    // ours, so once ours settles the fallback tile has already been kept.
    const loadImageResult = loadImage.mock.results[0]
    if (loadImageResult?.type !== 'return') throw new Error('expected loadImage to return a rejected promise')
    await loadImageResult.value.catch(() => {})
    expect(view.container.querySelector('img')).toBeNull()
  })
})

/** `count` distinct artifacts, sized only for the overflow-rule boundary tests below. */
function overflowArtifacts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    artifactId: `a-overflow-${String(index)}`, logicalName: `file-${String(index)}.csv`, version: 1,
    title: `File ${String(index)}`,
    content: { versionId: `version-overflow-${String(index)}`, mediaType: 'text/csv', byteCount: 10 },
  }))
}

function renderTray(count: number) {
  const store = testScienceSelectionStore()
  return render(<ScienceTurnArtifacts {...({
    matched: { artifacts: overflowArtifacts(count) }, actions: store.actions, useStore: store.useStore,
    loadImage: vi.fn(), openArtifact: vi.fn(), t, sessionId: 'session-1',
  } as unknown as ScienceTurnArtifactsProps)} />)
}

describe('ScienceTurnArtifacts turn-tail overflow', () => {
  it('shows all 5 cards with no "+N more" button below the threshold', () => {
    renderTray(5)
    expect(screen.getByText('本轮产出 5 个文件')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows all 6 cards uncollapsed at the exact boundary', () => {
    renderTray(6)
    expect(screen.getByText('本轮产出 6 个文件')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('collapses 7 cards to 5 plus a "+2 更多" button, and expands to all 7 on click', () => {
    renderTray(7)
    expect(screen.getByText('本轮产出 7 个文件')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    const more = screen.getByRole('button', { name: '+2 更多' })
    fireEvent.click(more)
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.queryByRole('button')).toBeNull()
    // The title's count is the total produced this Turn, never the visible slice.
    expect(screen.getByText('本轮产出 7 个文件')).toBeTruthy()
  })
})
