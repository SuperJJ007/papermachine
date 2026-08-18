// @vitest-environment jsdom
// Dedicated publish_outcome row: lifecycle states, presentation parsing
// (valid, stale/absent/invalid falls back to a plain row), evidence labels
// for run/chart/message, chart-thumbnail resolution from the live `science`
// projection, and the missing-chart-visual report.

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ScienceClientArtifactVersion, ScienceClientProjection } from '@deepseek-ai/dsh-science-session/types'
import { ScienceOutcomeRow } from '../src/client/ScienceOutcomeRow.tsx'
import { zh } from '../src/client/locales.ts'

type ScienceOutcomeRowProps = Parameters<typeof ScienceOutcomeRow>[0]

const t: ScienceOutcomeRowProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

const validMeta = {
  kind: 'science/outcome', version: 1,
  revision: 2, title: 'Model converges', summaryMarkdown: 'The **loss** dropped steadily.',
  evidence: [
    { kind: 'run', run_id: 'run-1' },
    { kind: 'chart', chart_id: 'chart-1', version: 1 },
    { kind: 'message', seq: 7 },
  ],
  publishedAt: 5000,
}

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 9,
    time: 9_000,
    callId: 'call-outcome',
    call: { name: 'publish_outcome', argsRaw: '{}' },
    callTime: 8_000,
    content: [{ type: 'text', text: 'Outcome revision 2: Model converges' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

function running(): RunningToolCall {
  return { callId: 'call-outcome', name: 'publish_outcome', argsRaw: '{}', turn: 1, step: 1, time: 8_000, callView: null, subCalls: [] }
}

function projectionWithChart(): ScienceClientProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: null,
    runs: [],
    artifacts: [{
      artifactId: 'chart-1' as never, logicalName: 'loss-curve', version: 1, title: 'Loss curve', origin: 'model',
      attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 100, width: 10, height: 10 },
      runId: 'run-1' as never, toolCallId: 'call-chart-1' as never, requestHeaderSeq: 4,
      environmentRevision: 1,
      environmentFingerprintPreview: 'f'.repeat(12), createdAt: 500,
    }],
    outcome: null,
    metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 1, artifactVersionCount: 1, outcomeRevision: 1 },
    lastScienceEventSeq: 1,
  }
}

function props(
  block: ScienceOutcomeRowProps['block'],
  projection?: ScienceClientProjection | null,
  load?: ScienceOutcomeRowProps['loadImage'],
): ScienceOutcomeRowProps {
  return {
    callId: block.callId,
    toolName: 'publish_outcome',
    block,
    openFile: vi.fn(),
    cwd: undefined,
    loadImage: load ?? vi.fn().mockResolvedValue('blob:fake-url'),
    useProjection: vi.fn(() => projection),
    sessionId: 'session-1',
    t,
  } as unknown as ScienceOutcomeRowProps
}

describe('ScienceOutcomeRow', () => {
  it('shows a running row while the call is in flight', () => {
    const view = render(<ScienceOutcomeRow {...props(running())} />)
    expect(view.container.querySelector('[data-tool="science-outcome"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.textContent).toContain('正在发布结论')
  })

  it('renders title, revision, Markdown summary, and every evidence label', () => {
    const view = render(<ScienceOutcomeRow {...props(settled({ meta: validMeta }), projectionWithChart())} />)
    expect(view.container.textContent).toContain('Model converges')
    expect(view.container.textContent).toContain('第 2 版')
    expect(view.container.querySelector('strong')?.textContent).toBe('loss')
    expect(view.container.textContent).toContain('运行 run-1')
    expect(view.container.textContent).toContain('图表 chart-1 v1')
    expect(view.container.textContent).toContain('消息 #7')
  })

  it('resolves a cited chart thumbnail from the live science projection', async () => {
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    const view = render(<ScienceOutcomeRow {...props(settled({ meta: validMeta }), projectionWithChart(), load)} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).toMatchObject({ attachmentId: 'sha256:abc' })
    await waitFor(() => { expect(view.container.querySelector('img')).not.toBeNull() })
  })

  it('reports a missing chart visual when the projection lacks the cited version, without inventing one', () => {
    const view = render(<ScienceOutcomeRow {...props(settled({ meta: validMeta }), null)} />)
    expect(view.container.textContent).toContain('图表 chart-1 v1')
    expect(view.container.textContent).toContain('引用的文件不可用')
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('renders a file-type tile (not the missing-visual report) when the cited artifact exists but is not an image', () => {
    const projection = projectionWithChart()
    const textArtifact: ScienceClientArtifactVersion = {
      ...projection.artifacts[0]!,
      attachment: { attachmentId: 'sha256:def' as never, mediaType: 'text/csv', bytes: 40 },
    }
    const view = render(<ScienceOutcomeRow {...props(settled({ meta: validMeta }), { ...projection, artifacts: [textArtifact] })} />)
    expect(view.container.textContent).toContain('图表 chart-1 v1')
    expect(view.container.textContent).toContain('CSV')
    expect(view.container.textContent).not.toContain('引用的文件不可用')
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('falls back to a plain row with the rendered text when metadata is absent', () => {
    const view = render(<ScienceOutcomeRow {...props(settled({ meta: undefined }))} />)
    expect(view.container.querySelector('[data-tool="science-outcome"]')?.getAttribute('data-state')).toBe('ok')
    expect(view.container.textContent).toContain('Outcome revision 2: Model converges')
  })

  it('falls back to a plain row when evidence is malformed', () => {
    const view = render(<ScienceOutcomeRow {...props(settled({
      meta: { ...validMeta, evidence: [{ kind: 'chart', chart_id: 'chart-1' }] },
    }))} />)
    // The rich card (Markdown summary + evidence list) never renders; the raw
    // durable text is shown verbatim instead.
    expect(view.container.querySelector('ul')).toBeNull()
    expect(view.container.querySelector('strong')).toBeNull()
    expect(view.container.textContent).toContain('Outcome revision 2: Model converges')
  })

  it('renders an error row without an Outcome card even when meta is present', () => {
    const view = render(<ScienceOutcomeRow {...props(settled({
      meta: validMeta, isError: true, error: { name: 'Error', code: 'failed' },
      content: [{ type: 'text', text: 'boom' }],
    }))} />)
    expect(view.container.querySelector('[data-tool="science-outcome"]')?.getAttribute('data-state')).toBe('error')
    expect(view.container.textContent).toContain('结论发布失败')
    expect(view.container.textContent).toContain('boom')
  })

  it('rejects an unrecognized presentation kind or version', () => {
    const wrongKind = render(<ScienceOutcomeRow {...props(settled({ meta: { ...validMeta, kind: 'science/other' } }))} />)
    expect(wrongKind.container.querySelector('ul')).toBeNull()
    cleanup()
    const wrongVersion = render(<ScienceOutcomeRow {...props(settled({ meta: { ...validMeta, version: 2 } }))} />)
    expect(wrongVersion.container.querySelector('ul')).toBeNull()
  })

  it('rejects every individually malformed presentation field', () => {
    const breakages: Record<string, unknown>[] = [
      { revision: '2' },
      { summaryMarkdown: 1 },
      { evidence: 'not-an-array' },
      { evidence: [{ kind: 'run', run_id: 1 }] },
      { evidence: [{ kind: 'chart', chart_id: 'chart-1', version: 'two' }] },
      { evidence: [{ kind: 'message', seq: 'seven' }] },
      { evidence: [{ kind: 'unknown' }] },
      { evidence: ['not-an-object'] },
    ]
    for (const breakage of breakages) {
      const view = render(<ScienceOutcomeRow {...props(settled({ meta: { ...validMeta, ...breakage } }))} />)
      expect(view.container.querySelector('ul')).toBeNull()
      cleanup()
    }
  })

  it('renders a chart thumbnail without a display name when the projected attachment carries none', async () => {
    const projection = projectionWithChart()
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    render(<ScienceOutcomeRow {...props(settled({ meta: validMeta }), projection, load)} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).not.toHaveProperty('name')
  })

  it('falls back to a plain row with no text when the durable content is empty', () => {
    const view = render(<ScienceOutcomeRow {...props(settled({ meta: undefined, content: [] }))} />)
    expect(view.container.querySelector('pre')).toBeNull()
  })

  it('renders non-text durable content as formatted JSON in the fallback row', () => {
    const view = render(<ScienceOutcomeRow {...props(settled({ meta: undefined, content: [{ type: 'reasoning', text: 'note' }] }))} />)
    expect(view.container.textContent).toContain('"type": "reasoning"')
  })

  it('renders a chart thumbnail with its display name when the projected attachment carries one', async () => {
    const named: ScienceClientProjection = {
      ...projectionWithChart(),
      artifacts: [{ ...projectionWithChart().artifacts[0]!, attachment: { ...projectionWithChart().artifacts[0]!.attachment, name: 'loss.png' } }],
    }
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    render(<ScienceOutcomeRow {...props(settled({ meta: validMeta }), named, load)} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).toMatchObject({ name: 'loss.png' })
  })

  it('renders a stopped row for an interrupted call', () => {
    const view = render(<ScienceOutcomeRow {...props(settled({ error: { name: 'InterruptedError', code: 'interrupted' } }))} />)
    expect(view.container.querySelector('[data-tool="science-outcome"]')?.getAttribute('data-state')).toBe('stopped')
    expect(view.container.textContent).toContain('结论发布已中止')
  })
})
