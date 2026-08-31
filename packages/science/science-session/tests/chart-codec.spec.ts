import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import {
  decodeScienceArtifact,
  decodeScienceChartState,
  MAX_CHART_ELEMENTS,
  MAX_CHART_OPS,
} from '../src/index.ts'
import type { ScienceChartElement, ScienceChartState } from '../src/index.ts'
import { artifact } from './fixtures.ts'

const element = (id = 'title', current: JsonValue = 'Quarterly revenue'): ScienceChartElement => ({
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

  it('decodes every supported chart operation', () => {
    const ops = [
      { op: 'set_title', axes: null, text: 'Updated title' },
      { op: 'set_subtitle', axes: null, text: 'Updated subtitle' },
      { op: 'set_subtitle', axes: 1, text: 'Panel subtitle' },
      { op: 'set_axis_label', axes: 0, axis: 'x', text: 'Treatment' },
      { op: 'set_legend_position', axes: null, position: 'upper right' },
      { op: 'toggle_grid', axes: 0, visible: true },
      { op: 'set_font', axes: null, family: 'DejaVu Sans', size: 14 },
    ] as const
    expect(decodeScienceChartState(chart({ ops })).ops).toEqual(ops)
  })

  it('rejects invalid operation operands and unknown operations', () => {
    for (const invalid of [{ axes: -1, text: 'Subtitle' }, { axes: null, text: 'bad\u0000text' }]) {
      expect(() => decodeScienceChartState(chart({ ops: [{ op: 'set_subtitle', ...invalid }] }))).toThrow()
    }
    expect(() => decodeScienceChartState(chart({
      ops: [{ op: 'set_title', axes: -1, text: 'Title' }],
    }))).toThrow()
    expect(() => decodeScienceChartState(chart({
      ops: [{ op: 'set_title', axes: null, text: 'bad\u0000text' }],
    }))).toThrow()
    expect(() => decodeScienceChartState(chart({
      ops: [{ op: 'set_legend_position', axes: null, position: 'outside' } as never],
    }))).toThrow()
    expect(() => decodeScienceChartState(chart({
      ops: [{ op: 'unknown', axes: null } as never],
    }))).toThrow()
    expect(() => decodeScienceChartState(chart({
      ops: [{ op: 'set_font', axes: null, family: 'DejaVu Sans', size: 3 }],
    }))).toThrow()
    expect(() => decodeScienceChartState(chart({
      ops: [{ op: 'set_font', axes: null, family: '', size: 12 }],
    }))).toThrow()
    expect(() => decodeScienceChartState(chart({
      ops: [{ op: 'set_font', axes: null, family: 'bad\u0000font', size: 12 }],
    }))).toThrow()
  })

  it('rejects too many operations and operation data above the complete-state byte ceiling', () => {
    expect(() => decodeScienceChartState(chart({
      ops: Array.from({ length: MAX_CHART_OPS + 1 }, () => ({ op: 'set_title', axes: null, text: 'x' })),
    }))).toThrow(/100/)
    expect(() => decodeScienceChartState(chart({
      ops: Array.from({ length: MAX_CHART_OPS }, () => ({
        op: 'set_title' as const,
        axes: null,
        text: 'x'.repeat(500),
      })),
      elements: Array.from({ length: MAX_CHART_ELEMENTS }, (_, index) => (
        element(`title.${String(index)}`, 'x'.repeat(100))
      )),
      hitmap: [],
    }))).toThrow(/65536/)
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
