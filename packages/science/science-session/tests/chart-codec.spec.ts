import { describe, expect, it } from 'vitest'
import {
  decodeScienceArtifact,
  decodeScienceChartState,
  MAX_CHART_ELEMENTS,
} from '../src/index.ts'
import type { ScienceChartElement, ScienceChartState } from '../src/index.ts'
import { artifact } from './fixtures.ts'

const element = (id = 'title', current: unknown = 'Quarterly revenue'): ScienceChartElement => ({
  id,
  kind: 'title',
  axes: null,
  label: null,
  current,
})

const chart = (overrides: Partial<ScienceChartState> = {}): ScienceChartState => ({
  runtime: 'matplotlib',
  figureKey: 'plot.png',
  png: { width: 640, height: 480, dpi: 100 },
  elements: [element()],
  ops: [],
  hitmap: [{ id: 'title', bbox: [10, 20, 100, 40], z: 3 }],
  hitmapStatus: 'ok',
  ...overrides,
})

describe('Science chart codec', () => {
  it('decodes a bounded live-figure state and a PNG artifact carrying it', () => {
    const value = chart()
    expect(decodeScienceChartState(value)).toEqual(value)
    expect(decodeScienceArtifact(artifact({ chart: value }))).toMatchObject({ chart: value })
  })

  it('rejects too many elements', () => {
    const elements = Array.from({ length: MAX_CHART_ELEMENTS + 1 }, (_, index) => element(`title.${String(index)}`))
    expect(() => decodeScienceChartState(chart({ elements }))).toThrow(/200/)
  })

  it('rejects a complete state above the byte ceiling', () => {
    const elements = Array.from({ length: MAX_CHART_ELEMENTS }, (_, index) => (
      element(`title.${String(index)}`, 'x'.repeat(300))
    ))
    expect(() => decodeScienceChartState(chart({ elements, hitmap: [] }))).toThrow(/65536/)
  })

  it('rejects a hit whose id is absent from the element catalog', () => {
    expect(() => decodeScienceChartState(chart({
      hitmap: [{ id: 'missing', bbox: [0, 0, 1, 1], z: 0 }],
    }))).toThrow(/reference an element/)
  })

  it('rejects duplicate element ids, unordered hit bounds, and hits on an unavailable map', () => {
    expect(() => decodeScienceChartState(chart({
      elements: [element(), element()],
    }))).toThrow(/unique/)
    expect(() => decodeScienceChartState(chart({
      hitmap: [{ id: 'title', bbox: [2, 0, 1, 1], z: 0 }],
    }))).toThrow(/ordered/)
    expect(() => decodeScienceChartState(chart({
      hitmapStatus: 'unavailable',
    }))).toThrow(/must be empty/)
  })

  it('rejects a hit outside the PNG pixel bounds', () => {
    expect(() => decodeScienceChartState(chart({
      hitmap: [{ id: 'title', bbox: [0, 0, 641, 1], z: 0 }],
    }))).toThrow(/PNG pixel bounds/)
  })

  it('rejects chart state on a non-PNG artifact version', () => {
    expect(() => decodeScienceArtifact(artifact({ mediaType: 'text/plain', chart: chart() }))).toThrow(/only image\/png/)
  })
})
