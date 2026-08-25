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
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

const reader: Parameters<typeof scienceTurnArtifactsDefinition.start>[2] = { previous: () => undefined }

const t = makeTranslate(zh, commonZh)
afterEach(cleanup)

const v1 = { artifactId: 'a-1', logicalName: 'result.csv', version: 1, title: 'Result',
  attachment: { attachmentId: 'sha256:a', mediaType: 'text/csv', bytes: 10 } }
const v2 = { ...v1, version: 2, attachment: { ...v1.attachment, attachmentId: 'sha256:b' } }
const second = { artifactId: 'a-2', logicalName: 'plot.json', version: 1, title: 'Plot',
  attachment: { attachmentId: 'sha256:c', mediaType: 'application/json', bytes: 20 } }

function startTurn() {
  return scienceTurnArtifactsDefinition.start(
    {} as never, { event: { type: 'turn/start', data: { turn: 4 } } } as never, reader,
  )
}

function updateWith(state: ReturnType<typeof startTurn>, artifacts: unknown[]) {
  return scienceTurnArtifactsDefinition.update(
    { state } as never,
    { event: { type: 'tool/result', data: { meta: { kind: 'science/artifact', version: 1, artifacts } } } } as never,
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
    const { match } = scienceTurnArtifactsDefinition
    expect(match({ type: 'turn/start', data: { turn: 4 } } as never)).toEqual({ id: '4', role: 'start' })
    expect(match({ type: 'tool/result', surfaceOp: 'append', data: { turn: 4 } } as never))
      .toEqual({ id: '4', role: 'update' })
    expect(match({ type: 'tool/result', surfaceOp: { op: 'replace', start: 1, end: 1 }, data: { turn: 4 } } as never))
      .toBeNull()
    expect(match({ type: 'turn/end', data: { turn: 4 } } as never)).toBeNull()
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
      { kind: 'science/artifact', version: 2, artifacts: [] },
      { kind: 'science/artifact', version: 1, artifacts: 'not-an-array' },
      { kind: 'science/artifact', version: 1, artifacts: ['not-an-object'] },
      { kind: 'science/artifact', version: 1, artifacts: [{ ...v1, artifactId: 1 }] },
      { kind: 'science/artifact', version: 1, artifacts: [{ ...v1, logicalName: 1 }] },
      { kind: 'science/artifact', version: 1, artifacts: [{ ...v1, version: '1' }] },
      { kind: 'science/artifact', version: 1, artifacts: [{ ...v1, title: 1 }] },
      { kind: 'science/artifact', version: 1, artifacts: [{ ...v1, attachment: null }] },
      { kind: 'science/artifact', version: 1, artifacts: [{ ...v1, attachment: { ...v1.attachment, attachmentId: 1 } }] },
      { kind: 'science/artifact', version: 1, artifacts: [{ ...v1, attachment: { ...v1.attachment, mediaType: 1 } }] },
      { kind: 'science/artifact', version: 1, artifacts: [{ ...v1, attachment: { ...v1.attachment, bytes: '10' } }] },
    ]
    for (const meta of malformedMetas) expect(updateMeta(meta)).toBe(start)
    // A non-`tool/result` update is ignored outright.
    expect(scienceTurnArtifactsDefinition.update(
      { state: start } as never, { event: { type: 'turn/end', data: {} } } as never,
    )).toBe(start)
  })

  it('publishes Turn Location data only inside the turn scope, and only once state exists', () => {
    const { buildLocationData } = scienceTurnArtifactsDefinition
    if (buildLocationData === undefined) throw new Error('expected buildLocationData')
    const state = { turn: 4, artifacts: [v1] }
    expect(buildLocationData({ state } as never, 'step')).toBeNull()
    expect(buildLocationData({ state: undefined } as never, 'turn')).toBeNull()
    expect(buildLocationData({ state } as never, 'turn')).toEqual({
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
    fireEvent.click(screen.getByRole('listitem', { name: /result\.csv/u }))
    expect(store.instance.getSnapshot().openArtifacts).toEqual([{ artifactId: 'a-1', version: 2 }])
    expect(openArtifact).toHaveBeenCalledTimes(1)
  })

  it('loads a thumbnail for a dimensioned image artifact', async () => {
    const store = testScienceSelectionStore()
    const chart = { artifactId: 'a-3', logicalName: 'plot.png', version: 1, title: 'Plot',
      attachment: { attachmentId: 'sha256:d', mediaType: 'image/png', bytes: 30, width: 4, height: 4 } }
    const loadImage = vi.fn().mockResolvedValue('blob:fake-url')
    const view = render(<ScienceTurnArtifacts {...({
      matched: { artifacts: [chart] }, actions: store.actions, useStore: store.useStore,
      loadImage, openArtifact: vi.fn(), t, sessionId: 'session-1',
    } as unknown as ScienceTurnArtifactsProps)} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    expect(loadImage).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: 'sha256:d' }))
    await waitFor(() => { expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:fake-url') })
  })

  it('keeps the media-type tile when a dimensioned image fails to load', async () => {
    const store = testScienceSelectionStore()
    const chart = { artifactId: 'a-4', logicalName: 'plot2.png', version: 1, title: 'Plot 2',
      attachment: { attachmentId: 'sha256:e', mediaType: 'image/png', bytes: 30, width: 4, height: 4 } }
    const loadImage = vi.fn().mockRejectedValue(new Error('load failed'))
    const view = render(<ScienceTurnArtifacts {...({
      matched: { artifacts: [chart] }, actions: store.actions, useStore: store.useStore,
      loadImage, openArtifact: vi.fn(), t, sessionId: 'session-1',
    } as unknown as ScienceTurnArtifactsProps)} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    // The component's own .catch() is chained onto this same promise ahead of
    // ours, so once ours settles the fallback tile has already been kept.
    await loadImage.mock.results[0]?.value.catch(() => {})
    expect(view.container.querySelector('img')).toBeNull()
  })
})
