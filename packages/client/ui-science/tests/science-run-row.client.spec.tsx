// @vitest-environment jsdom
// Dedicated run_python/run_r row: lifecycle states, the per-language title,
// the plain rendered text always shown, and — once settled with a valid
// tagged presentation — one clickable reference chip per captured file that
// opens the exact artifact version's tab and the Science Details entry. No
// chip renders for an absent, malformed, or empty-artifacts presentation.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ScienceRunRow } from '../src/client/ScienceRunRow.tsx'
import { zh } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

type ScienceRunRowProps = Parameters<typeof ScienceRunRow>[0]

const t: ScienceRunRowProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

const twoArtifactsMeta = {
  kind: 'science/artifact', version: 1,
  artifacts: [
    {
      artifactId: 'artifact-1', logicalName: 'plot.png', version: 1, title: 'plot.png',
      attachment: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 500, width: 10, height: 20 },
    },
    {
      artifactId: 'artifact-2', logicalName: 'summary.csv', version: 1, title: 'summary.csv',
      attachment: { attachmentId: 'sha256:b', mediaType: 'text/csv', bytes: 2048 },
    },
  ],
}

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 3,
    time: 3_000,
    callId: 'call-run',
    call: { name: 'run_python', argsRaw: '{}' },
    callTime: 2_000,
    content: [{ type: 'text', text: 'status: success\n--- stdout ---\nok\n--- stderr ---\n(empty)' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

function running(): RunningToolCall {
  return { callId: 'call-run', name: 'run_python', argsRaw: '{}', turn: 1, step: 1, time: 2_000, callView: null, subCalls: [] }
}

function props(
  block: ScienceRunRowProps['block'],
  over: { toolName?: string; openDetailsView?: (id: string) => void; store?: ReturnType<typeof testScienceSelectionStore> } = {},
): ScienceRunRowProps {
  const store = over.store ?? testScienceSelectionStore()
  return {
    callId: block.callId,
    toolName: over.toolName ?? 'run_python',
    block,
    openFile: vi.fn(),
    cwd: undefined,
    loadImage: vi.fn(),
    openDetailsView: over.openDetailsView ?? vi.fn(),
    useStore: store.useStore,
    actions: store.actions,
    useProjection: vi.fn(),
    sessionId: 'session-1',
    t,
  } as unknown as ScienceRunRowProps
}

describe('ScienceRunRow', () => {
  it('shows a running row titled for the language while the call is in flight', () => {
    const view = render(<ScienceRunRow {...props(running())} />)
    expect(view.container.querySelector('[data-tool="science-run"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.textContent).toContain('Python 运行')
    expect(view.container.textContent).toContain('正在运行')
  })

  it('titles an R call distinctly from a Python call', () => {
    const view = render(<ScienceRunRow {...props(running(), { toolName: 'run_r' })} />)
    expect(view.container.textContent).toContain('R 运行')
  })

  it('always renders the tool\'s own rendered text', () => {
    const view = render(<ScienceRunRow {...props(settled())} />)
    expect(view.container.textContent).toContain('status: success')
    expect(view.container.textContent).toContain('ok')
  })

  it('renders no reference chips when the settled result carries no presentation', () => {
    const view = render(<ScienceRunRow {...props(settled({ meta: undefined }))} />)
    expect(view.container.querySelectorAll('button')).toHaveLength(0)
  })

  it('renders one clickable chip per captured file and opens its exact version on click', () => {
    const openDetailsView = vi.fn()
    const store = testScienceSelectionStore()
    const view = render(<ScienceRunRow {...props(settled({ meta: twoArtifactsMeta }), { openDetailsView, store })} />)
    const list = screen.getByRole('list', { name: '产出文件' })
    const buttons = list.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect(view.container.textContent).toContain('plot.png')
    expect(view.container.textContent).toContain('summary.csv')
    ;(buttons[1] as HTMLElement).click()
    expect(store.instance.getSnapshot().openArtifacts).toEqual([{ artifactId: 'artifact-2', version: 1 }])
    expect(store.instance.getSnapshot().activeArtifactId).toBe('artifact-2')
    expect(openDetailsView).toHaveBeenCalledWith('science')
  })

  it('renders no chips when the presentation carries an empty artifacts list', () => {
    const view = render(<ScienceRunRow {...props(settled({ meta: { kind: 'science/artifact', version: 1, artifacts: [] } }))} />)
    expect(view.container.querySelectorAll('button')).toHaveLength(0)
  })

  it('renders no chips for an unrecognized presentation kind or version', () => {
    const wrongKind = render(<ScienceRunRow {...props(settled({ meta: { ...twoArtifactsMeta, kind: 'science/other' } }))} />)
    expect(wrongKind.container.querySelectorAll('button')).toHaveLength(0)
    cleanup()
    const wrongVersion = render(<ScienceRunRow {...props(settled({ meta: { ...twoArtifactsMeta, version: 2 } }))} />)
    expect(wrongVersion.container.querySelectorAll('button')).toHaveLength(0)
  })

  it('renders no chips when one artifact entry is malformed', () => {
    const view = render(<ScienceRunRow {...props(settled({
      meta: { ...twoArtifactsMeta, artifacts: [twoArtifactsMeta.artifacts[0], { ...twoArtifactsMeta.artifacts[1], version: 'two' }] },
    }))} />)
    expect(view.container.querySelectorAll('button')).toHaveLength(0)
  })

  it('rejects every individually malformed artifact entry shape', () => {
    const item = twoArtifactsMeta.artifacts[0]
    const breakages: unknown[] = [
      null,
      'not-an-object',
      { ...item, artifactId: 1 },
      { ...item, logicalName: 1 },
      { ...item, title: 1 },
      { ...item, attachment: 'not-an-object' },
      { ...item, attachment: null },
      { ...item, attachment: { ...item?.attachment, attachmentId: 1 } },
      { ...item, attachment: { ...item?.attachment, mediaType: 1 } },
      { ...item, attachment: { ...item?.attachment, bytes: '500' } },
    ]
    for (const breakage of breakages) {
      const view = render(<ScienceRunRow {...props(settled({ meta: { kind: 'science/artifact', version: 1, artifacts: [breakage] } }))} />)
      expect(view.container.querySelectorAll('button')).toHaveLength(0)
      cleanup()
    }
  })

  it('renders no chips for a failed call, even when the durable meta happens to carry a presentation', () => {
    const failed = render(<ScienceRunRow {...props(settled({ meta: twoArtifactsMeta, isError: true, error: { name: 'Error', code: 'failed' } }))} />)
    expect(failed.container.querySelectorAll('button')).toHaveLength(0)
    expect(failed.container.textContent).toContain('运行失败')
  })

  it.each([
    { name: 'InterruptedError', code: 'interrupted' },
    { name: 'AbortError', code: 'ABORTED' },
  ])('renders a stopped row for $code', (error) => {
    const view = render(<ScienceRunRow {...props(settled({ error }))} />)
    expect(view.container.querySelector('[data-tool="science-run"]')?.getAttribute('data-state')).toBe('stopped')
    expect(view.container.textContent).toContain('运行已中止')
  })

  it('keeps a pre-dispatch abort in the generic error state', () => {
    const view = render(<ScienceRunRow {...props(settled({ isError: true, error: { name: 'AbortError', code: 'ABORTED_BEFORE_DISPATCH' } }))} />)
    expect(view.container.querySelector('[data-tool="science-run"]')?.getAttribute('data-state')).toBe('error')
    expect(view.container.textContent).toContain('运行失败')
  })
})
