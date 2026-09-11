// @vitest-environment jsdom
/** Version facts remain tied to the active request when reads settle out of order. */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useScienceVersionSummaries, type LoadScienceVersions } from '../src/client/version-summaries.ts'
import { versionSummary } from './science-details-view-fixtures.client.ts'

afterEach(cleanup)

it('retains accepted facts and discards stale or rejected reads', async () => {
  let resolve!: (result: Awaited<ReturnType<LoadScienceVersions>>) => void
  const pending = new Promise<Awaited<ReturnType<LoadScienceVersions>>>((accept) => { resolve = accept })
  const summary = versionSummary({ versionId: 'new' })
  const load = vi.fn<LoadScienceVersions>().mockReturnValueOnce(pending)
    .mockResolvedValueOnce({ ok: true, value: { versions: [summary] } })
    .mockResolvedValueOnce({ ok: false, error: { code: 'denied', message: 'denied', details: {} } } as never)
  const view = renderHook(({ ids }) => useScienceVersionSummaries(load, ids), { initialProps: { ids: ['old'] } })
  view.rerender({ ids: ['new'] })
  await waitFor(() => { expect(view.result.current.get('new')).toEqual(summary) })
  await act(async () => { resolve({ ok: true, value: { versions: [versionSummary({ versionId: 'old' })] } }); await pending })
  expect(view.result.current.has('old')).toBe(false)
  view.rerender({ ids: ['denied'] })
  await act(async () => {})
  expect(view.result.current.get('new')).toEqual(summary)
  expect(view.result.current.has('denied')).toBe(false)
})
