// @vitest-environment jsdom
/** Science process cells stay one line until the user expands their durable material. */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ScienceClientProjection } from '@deepseek-ai/dsh-science-session/types'
import { ScienceAnnotationRow } from '../src/client/ScienceAnnotationRow.tsx'
import { ScienceExecutionRow } from '../src/client/ScienceExecutionRow.tsx'
import { ScienceOutcomeRow, type ScienceOutcomeInjected } from '../src/client/ScienceOutcomeRow.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)
afterEach(cleanup)

function settled(name: string, over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 3, time: 3_000, callId: `call-${name}`,
    call: { name, argsRaw: JSON.stringify({ code: 'print("hello")\nprint("done")' }) }, callTime: 2_000,
    content: [{ type: 'text', text: 'hello\ndone' }], isError: false,
    callView: null, resultView: null, subCalls: [], ...over,
  }
}

function running(name: string): RunningToolCall {
  return { callId: `call-${name}`, name, argsRaw: '{}', turn: 1, step: 1, time: 2_000, callView: null, subCalls: [] }
}

function props(
  block: ToolResultNode | RunningToolCall,
  toolName: string,
  overrides: Partial<ToolCallViewProps & ScienceOutcomeInjected & { cancel: () => void }> = {},
) {
  return {
    block, toolName, callId: block.callId, inspect: vi.fn(), openFile: vi.fn(), loadImage: vi.fn(), loadScienceImage: vi.fn(),
    loadVersions: vi.fn(async () => ({ ok: true, value: { versions: [] } })),
    openDetailsView: vi.fn(), useProjection: vi.fn(), sessionId: 'session-1', cancel: vi.fn(), t, ...overrides,
  } as unknown as ToolCallViewProps & PropsLocale<'science'> & ScienceOutcomeInjected & { cancel: () => void }
}

/** One `formatRunResult`-shaped tool-result content string (tool-science `run.ts`'s durable text shape). */
function runResultText(opts: {
  stdout?: string
  stdoutTruncated?: boolean
  stderr?: string
  stderrTruncated?: boolean
  status?: string
} = {}): string {
  const { stdout = '', stdoutTruncated = false, stderr = '', stderrTruncated = false, status = 'success' } = opts
  const lines = [`status: ${status}`, '--- stdout ---', stdout === '' ? '(empty)' : stdout]
  if (stdoutTruncated) lines.push('(stdout truncated)')
  lines.push('--- stderr ---', stderr === '' ? '(empty)' : stderr)
  if (stderrTruncated) lines.push('(stderr truncated)')
  return lines.join('\n')
}

/** One `science` projection whose single run joins the given `toolCallId`. */
function projectionWithRun(toolCallId: string, run: Partial<ScienceClientProjection['runs'][number]> = {}): ScienceClientProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: null,
    runs: [{
      runId: 'run-1' as never, language: 'python', toolCallId: toolCallId as never, requestHeaderSeq: 1,
      environmentRevision: 1, environmentFingerprintPreview: 'f'.repeat(12), startedAt: 0,
      codeSha256: 'c'.repeat(64), kernelEpoch: 3, status: 'success', finishedAt: 900,
      stdoutBytes: 0, stderrBytes: 0, stdoutTruncated: false, stderrTruncated: false,
      ...run,
    } as ScienceClientProjection['runs'][number]],
    kernels: [],
    artifacts: [],
    trace: { turns: [], calls: [] },
    outcome: null,
    metrics: { runCount: 1, successfulRunCount: 1, artifactCount: 0, artifactVersionCount: 0, outcomeRevision: 0, kernelCount: 1 },
    lastScienceEventSeq: 1,
  }
}

function projectionWithChart(): ScienceClientProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: null,
    runs: [],
    kernels: [],
    artifacts: [{
      artifactId: 'chart-1' as never, logicalName: 'loss-curve', version: 1, title: 'Loss curve',
      versionId: 'version-abc' as never, sha256: 'abc', seenAt: 500,
    }],
    trace: { turns: [], calls: [] },
    outcome: null,
    metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 1, artifactVersionCount: 1, outcomeRevision: 1, kernelCount: 0 },
    lastScienceEventSeq: 1,
  }
}

describe('Science execution cells', () => {
  it('keeps Python code and output folded, then reveals both from the one-line cell', () => {
    const block = settled('run_python')
    const view = render(<ScienceExecutionRow {...props(block, 'run_python')} />)
    expect(view.container.querySelector('[data-science-cell]')).toBeTruthy()
    expect(screen.queryByText('hello\ndone')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Python 运行/u }))
    expect([...view.container.querySelectorAll('pre')].at(-1)?.textContent).toContain('hello\ndone')
    expect(view.container.querySelector('code')?.textContent).toContain('print("hello")')
  })

  it('labels R distinctly and keeps failed state visible while collapsed', () => {
    const view = render(<ScienceExecutionRow {...props(settled('run_r', {
      isError: true, error: { name: 'Error', code: 'failed' }, content: [{ type: 'text', text: 'boom' }],
    }), 'run_r')} />)
    expect(view.container.textContent).toContain('R 运行')
    expect(view.container.textContent).toContain('运行失败')
    expect(view.container.querySelector('[data-state="error"]')).toBeTruthy()
  })

  it('shows the raw call arguments verbatim when they are not the durable JSON code shape', () => {
    const block = settled('run_python', { call: { name: 'run_python', argsRaw: 'not json' } })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python')} />)
    fireEvent.click(screen.getByRole('button', { name: /Python 运行/u }))
    expect(view.container.querySelector('code')?.textContent).toBe('not json')
  })

  it('shows the raw call arguments verbatim when they parse as JSON but carry no string `code` field', () => {
    const block = settled('run_python', { call: { name: 'run_python', argsRaw: '{}' } })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python')} />)
    fireEvent.click(screen.getByRole('button', { name: /Python 运行/u }))
    expect(view.container.querySelector('code')?.textContent).toBe('{}')
  })

  it('state 1 — running: shows a live elapsed status, the degraded static summary, and wires the interrupt button to the existing whole-turn cancel', () => {
    vi.useFakeTimers()
    vi.setSystemTime(12_000)
    const cancel = vi.fn()
    const view = render(<ScienceExecutionRow {...props(running('run_python'), 'run_python', { cancel })} />)
    expect(view.container.querySelector('[data-tool="science-run"][data-state="running"]')).toBeTruthy()
    expect(view.container.textContent).toContain('运行中 · 00:10')
    expect(view.container.textContent).toContain('正在执行…')
    fireEvent.click(screen.getByRole('button', { name: '中断' }))
    expect(cancel).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(view.container.textContent).toContain('运行中 · 00:15')
    vi.useRealTimers()
  })

  it('state 1 — running: prefers the science projection run\'s own startedAt over the call event time when a matching run exists', () => {
    vi.useFakeTimers()
    vi.setSystemTime(12_000)
    const block = running('run_python')
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId, { status: 'running', startedAt: 7_000 } as never)),
    })} />)
    expect(view.container.textContent).toContain('运行中 · 00:05')
    vi.useRealTimers()
  })

  it('state 2 — success, short output: folds the retained stdout by default and keeps the kernel badge visible', () => {
    const block = settled('run_python', {
      content: [{ type: 'text', text: runResultText({ stdout: 'line one\nline two' }) }],
    })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId)),
    })} />)
    expect(view.container.querySelector('[data-tool="science-run"][data-state="success"]')).toBeTruthy()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(view.container.textContent).toContain('内核 #3')
    const fold = screen.getByRole('button', { name: /标准输出 2 行/u })
    fireEvent.click(fold)
    expect(view.container.querySelector('pre')?.textContent).toBe('line one\nline two')
  })

  it('state 2 — success, empty output: shows only the status header, with no output box and no fold', () => {
    const block = settled('run_python', { content: [{ type: 'text', text: runResultText() }] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId)),
    })} />)
    expect(view.container.querySelector('[data-tool="science-run"][data-state="success"]')).toBeTruthy()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(view.container.querySelector('button')).toBeNull()
  })

  it('state 3/5 — captured artifacts never render a chip in the row regardless of stdout size', () => {
    const block = settled('run_python', {
      content: [{ type: 'text', text: runResultText({ stdout: 'ok' }) }],
      meta: {
        kind: 'science/artifact', version: 1, artifacts: [{
          artifactId: 'chart-1', logicalName: 'loss', version: 1, title: 'Loss',
          attachment: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 10, width: 1, height: 1 },
        }],
      },
    })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId)),
    })} />)
    expect(view.container.querySelector('[role="listitem"]')).toBeNull()
    expect(screen.queryByText('loss', { exact: false })).toBeNull()
  })

  it('state 4 — success, long output: folds behind a line-count/size caret and reveals the full text on click', () => {
    const stdout = Array.from({ length: 12 }, (_, i) => `line ${String(i)}`).join('\n')
    const block = settled('run_python', { content: [{ type: 'text', text: runResultText({ stdout }) }] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId)),
    })} />)
    expect(view.container.querySelector('pre')).toBeNull()
    const fold = screen.getByRole('button', { name: /标准输出 12 行 · \d/u })
    fireEvent.click(fold)
    expect(view.container.querySelector('pre')?.textContent).toBe(stdout)
  })

  it('state 6 — failed: shows the tail-first stderr summary and the full stack behind its own fold', () => {
    const stderr = 'Traceback (most recent call last):\n  File "<run>", line 1\nKeyError: \'x\''
    const block = settled('run_python', { content: [{ type: 'text', text: runResultText({ status: 'failed', stderr }) }] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId, { status: 'failed', failureCode: 'EXECUTION_FAILED' })),
    })} />)
    const pres = () => [...view.container.querySelectorAll('pre')]
    expect(view.container.querySelector('[data-tool="science-run"][data-state="failed"]')).toBeTruthy()
    expect(view.container.textContent).toContain('失败 · 执行报错')
    expect(pres()).toHaveLength(1)
    expect(pres()[0]?.textContent).toBe('  File "<run>", line 1\nKeyError: \'x\'')
    fireEvent.click(screen.getByRole('button', { name: /完整调用栈 3 行/u }))
    expect(pres()).toHaveLength(2)
    expect(pres()[1]?.textContent).toBe(stderr)
  })

  it('state 7 — kernel died: names the exited and next kernel epoch with no invented variable count, and views the exit reason', () => {
    const block = settled('run_python', { content: [{ type: 'text', text: runResultText({ status: 'failed' }) }] })
    const inspect = vi.fn()
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      inspect,
      useProjection: vi.fn(() => projectionWithRun(block.callId, { status: 'failed', failureCode: 'KERNEL_DIED', kernelEpoch: 3 })),
    })} />)
    expect(view.container.querySelector('[data-tool="science-run"][data-state="kernel-died"]')).toBeTruthy()
    expect(view.container.textContent).toContain('中断 · 内核已退出')
    expect(view.container.textContent).toContain('内核 #3')
    expect(view.container.textContent).toContain('内核 #4')
    fireEvent.click(screen.getByRole('button', { name: '查看退出原因' }))
    expect(inspect).toHaveBeenCalledOnce()
  })

  it('state 7 — omits the view-exit-reason button when no inspect callback is available', () => {
    const block = settled('run_python', { content: [{ type: 'text', text: runResultText({ status: 'failed' }) }] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      inspect: undefined,
      useProjection: vi.fn(() => projectionWithRun(block.callId, { status: 'failed', failureCode: 'KERNEL_DIED' })),
    })} />)
    expect(view.container.querySelector('button')).toBeNull()
  })

  it('state 8 — success, output truncated: the fold names the retained tail size and a banner explains the cap', () => {
    const stdout = 'kept tail only'
    const block = settled('run_python', { content: [{ type: 'text', text: runResultText({ stdout, stdoutTruncated: true }) }] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId, { stdoutTruncated: true })),
    })} />)
    expect(screen.getByRole('button', { name: /标准输出 · 保留末尾/u })).toBeTruthy()
    expect(view.container.textContent).toContain('开头部分未保留')
    expect(view.container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /标准输出 · 保留末尾/u }))
    expect(view.container.querySelector('pre')?.textContent).toBe(stdout)
  })

  it('degrades to the plain folded cell when the science projection has no matching run — never inventing kernel or run facts', () => {
    const block = settled('run_python', { content: [{ type: 'text', text: runResultText({ stdout: 'x' }) }] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => ({ ...projectionWithRun('other-call'), runs: [] })),
    })} />)
    expect(view.container.querySelector('[data-tool="science-run"][data-state="success"]')).toBeNull()
    expect(view.container.querySelector('[data-science-cell]')).toBeTruthy()
    expect(screen.queryByText('内核', { exact: false })).toBeNull()
  })

  it('degrades to the plain folded cell when the durable text does not carry the formatRunResult section markers', () => {
    const block = settled('run_python', { content: [{ type: 'text', text: 'a bespoke non-standard result' }] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId)),
    })} />)
    expect(view.container.querySelector('[data-tool="science-run"][data-state="success"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Python 运行/u }))
    expect(screen.getByText('a bespoke non-standard result')).toBeTruthy()
  })

  it('treats a replay-derived interrupted run status the same as an ordinary failure, defensively, since it never settles a tool call as ok in practice', () => {
    const block = settled('run_python', { content: [{ type: 'text', text: runResultText({ status: 'interrupted' }) }] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python', {
      useProjection: vi.fn(() => projectionWithRun(block.callId, {
        status: 'interrupted', finishedAt: 900, interruptedAtSeq: 5,
      } as never)),
    })} />)
    expect(view.container.querySelector('[data-tool="science-run"][data-state="failed"]')).toBeTruthy()
  })

  it('shows a stopped status label when the run was interrupted', () => {
    const view = render(<ScienceExecutionRow {...props(settled('run_python', {
      isError: true, error: { name: 'Error', code: 'interrupted' }, content: [{ type: 'text', text: 'stopped' }],
    }), 'run_python')} />)
    expect(view.container.textContent).toContain('运行已中止')
    expect(view.container.querySelector('[data-state="stopped"]')).toBeTruthy()
  })

  it('falls back to an empty summary when the call head is truncated out of the window and output is empty', () => {
    const block = settled('run_python', { call: null, content: [] })
    const view = render(<ScienceExecutionRow {...props(block, 'run_python')} />)
    expect(view.container.querySelector('[data-science-cell]')).toBeTruthy()
    // No code, no output, and no lifecycle status: nothing is expandable, so
    // the row never exposes a disclosure control.
    expect(view.container.querySelector('code')).toBeNull()
    expect(screen.queryByRole('button', { name: /Python 运行/u })).toBeNull()
  })

  it('renders annotation as a folded process cell with no inline artifact navigation', () => {
    const view = render(<ScienceAnnotationRow {...props(settled('annotate_artifact'), 'annotate_artifact')} />)
    expect(view.container.querySelector('[data-science-cell]')).toBeTruthy()
    expect(view.container.querySelector('[data-tool="science-artifact"]')).toBeNull()
    expect(screen.queryByText('hello\ndone')).toBeNull()
  })

  it('summarizes an empty completed annotation result with an empty summary rather than throwing', () => {
    const view = render(<ScienceAnnotationRow {...props(settled('annotate_artifact', { content: [] }), 'annotate_artifact')} />)
    expect(view.container.querySelector('[data-state="ok"]')).toBeTruthy()
  })

  it('summarizes annotation lifecycle states distinctly: running, failed, and stopped', () => {
    const runningView = render(<ScienceAnnotationRow {...props(running('annotate_artifact'), 'annotate_artifact')} />)
    expect(runningView.container.textContent).toContain('正在标注成果')
    cleanup()

    const errorView = render(<ScienceAnnotationRow {...props(settled('annotate_artifact', {
      isError: true, error: { name: 'Error', code: 'failed' }, content: [{ type: 'text', text: 'boom' }],
    }), 'annotate_artifact')} />)
    expect(errorView.container.textContent).toContain('成果标注失败')
    cleanup()

    const stoppedView = render(<ScienceAnnotationRow {...props(settled('annotate_artifact', {
      isError: true, error: { name: 'Error', code: 'interrupted' }, content: [{ type: 'text', text: 'stopped' }],
    }), 'annotate_artifact')} />)
    expect(stoppedView.container.textContent).toContain('成果标注已中止')
  })
})

describe('Science Outcome cell', () => {
  const validMeta = {
    kind: 'science/outcome', version: 1, revision: 2, title: 'Stable result',
    summaryMarkdown: 'The **result** holds.',
    evidence: [
      { kind: 'run', run_id: 'run-1' },
      { kind: 'chart', chart_id: 'chart-1', version: 1 },
      { kind: 'message', seq: 7 },
    ],
    publishedAt: 5_000,
  }

  it('shows only the published revision until expanded, then reveals the full Outcome', () => {
    const block = settled('publish_outcome', { meta: {
      kind: 'science/outcome', version: 1, revision: 2, title: 'Stable result',
      summaryMarkdown: 'The **result** holds.', evidence: [], publishedAt: 5_000,
    } })
    render(<ScienceOutcomeRow {...props(block, 'publish_outcome')} />)
    expect(screen.getByText('结论已发布 · 第 2 版')).toBeTruthy()
    expect(screen.queryByText('Stable result')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    expect(screen.getByText('Stable result')).toBeTruthy()
    expect(document.querySelector('strong')?.textContent).toBe('result')
  })

  it('renders every evidence kind, resolving a cited chart thumbnail from the live science projection', async () => {
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    const loadVersions = vi.fn(async () => ({ ok: true, value: { versions: [{
      versionId: 'version-abc', artifactId: 'chart-1', logicalName: 'loss-curve', ordinal: 1, title: 'Loss curve',
      contentOrigin: 'run-auto', createdAt: 500, mediaType: 'image/png', byteCount: 100,
    }] } } as never))
    render(<ScienceOutcomeRow {...props(
      settled('publish_outcome', { meta: validMeta }), 'publish_outcome',
      { useProjection: vi.fn(() => projectionWithChart()), loadScienceImage: load, loadVersions },
    )} />)
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    expect(screen.getByText('运行 run-1')).toBeTruthy()
    expect(screen.getByText('图表 chart-1 v1')).toBeTruthy()
    expect(screen.getByText('消息 #7')).toBeTruthy()
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).toMatchObject({ versionId: 'version-abc' })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
  })

  it('reports a missing chart visual when the projection lacks the cited version, without inventing one', () => {
    render(<ScienceOutcomeRow {...props(
      settled('publish_outcome', { meta: validMeta }), 'publish_outcome',
      { useProjection: vi.fn(() => null) },
    )} />)
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    expect(screen.getByText('引用的成果不可用')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders a file-type tile (not the missing-visual report) when the cited artifact is not an image', async () => {
    const projection = projectionWithChart()
    const source = projection.artifacts[0]
    if (source === undefined) throw new Error('expected run-produced chart fixture')
    const textArtifact = {
      ...source, versionId: 'version-def' as never, sha256: 'def', mediaType: 'text/csv' as const, byteCount: 40,
    }
    const loadVersions = vi.fn(async () => ({ ok: true, value: { versions: [{
      versionId: 'version-def', artifactId: 'chart-1', logicalName: 'loss-curve', ordinal: 1, title: 'Loss curve',
      contentOrigin: 'run-auto', createdAt: 500, mediaType: 'text/csv', byteCount: 40,
    }] } } as never))
    render(<ScienceOutcomeRow {...props(
      settled('publish_outcome', { meta: validMeta }), 'publish_outcome',
      { useProjection: vi.fn(() => ({ ...projection, artifacts: [textArtifact] })), loadVersions },
    )} />)
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    await waitFor(() => { expect(screen.getByText('CSV')).toBeTruthy() })
    expect(screen.queryByText('引用的成果不可用')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows a running status row while the call is in flight', () => {
    const view = render(<ScienceOutcomeRow {...props(running('publish_outcome'), 'publish_outcome')} />)
    expect(view.container.querySelector('[data-tool="science-outcome"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.textContent).toContain('正在发布结论')
  })

  it('shows a failed status row and a stopped status row, each without an Outcome card', () => {
    const errorView = render(<ScienceOutcomeRow {...props(settled('publish_outcome', {
      meta: validMeta, isError: true, error: { name: 'Error', code: 'failed' },
      content: [{ type: 'text', text: 'boom' }],
    }), 'publish_outcome')} />)
    expect(errorView.container.querySelector('[data-tool="science-outcome"]')?.getAttribute('data-state')).toBe('error')
    expect(errorView.container.textContent).toContain('结论发布失败')
    cleanup()

    const stoppedView = render(<ScienceOutcomeRow {...props(settled('publish_outcome', {
      meta: validMeta, isError: true, error: { name: 'Error', code: 'interrupted' },
      content: [{ type: 'text', text: 'stopped' }],
    }), 'publish_outcome')} />)
    expect(stoppedView.container.querySelector('[data-tool="science-outcome"]')?.getAttribute('data-state')).toBe('stopped')
    expect(stoppedView.container.textContent).toContain('结论发布已中止')
  })

  it('falls back to the durable text when metadata is absent or evidence is malformed', () => {
    const absent = render(<ScienceOutcomeRow {...props(settled('publish_outcome', { meta: undefined }), 'publish_outcome')} />)
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    expect(absent.container.querySelector('ul')).toBeNull()
    expect(absent.container.textContent).toContain('hello')
    cleanup()

    const malformed = render(<ScienceOutcomeRow {...props(settled('publish_outcome', {
      meta: { ...validMeta, evidence: [{ kind: 'unknown' }] },
    }), 'publish_outcome')} />)
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    expect(malformed.container.querySelector('ul')).toBeNull()
    expect(malformed.container.querySelector('strong')).toBeNull()
  })

  it('falls back to an empty summary when metadata and durable text are both absent', () => {
    const view = render(<ScienceOutcomeRow {...props(settled('publish_outcome', { meta: undefined, content: [] }), 'publish_outcome')} />)
    expect(view.container.querySelector('[data-tool="science-outcome"]')?.getAttribute('data-state')).toBe('ok')
    expect(view.container.querySelector('ul')).toBeNull()
  })

  it('rejects an unrecognized presentation kind or version', () => {
    const wrongKind = render(<ScienceOutcomeRow {...props(settled('publish_outcome', {
      meta: { ...validMeta, kind: 'science/other' },
    }), 'publish_outcome')} />)
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    expect(wrongKind.container.querySelector('ul')).toBeNull()
    cleanup()

    const wrongVersion = render(<ScienceOutcomeRow {...props(settled('publish_outcome', {
      meta: { ...validMeta, version: 2 },
    }), 'publish_outcome')} />)
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    expect(wrongVersion.container.querySelector('ul')).toBeNull()
  })

  it('rejects every individually malformed presentation field', () => {
    const breakages: Record<string, unknown>[] = [
      { revision: '2' },
      { title: 1 },
      { summaryMarkdown: 1 },
      { publishedAt: '5000' },
      { evidence: 'not-an-array' },
      { evidence: [{ kind: 'run', run_id: 1 }] },
      { evidence: [{ kind: 'chart', chart_id: 'chart-1', version: 'two' }] },
      { evidence: [{ kind: 'message', seq: 'seven' }] },
      { evidence: [{ kind: 'unknown' }] },
      { evidence: ['not-an-object'] },
    ]
    for (const breakage of breakages) {
      const view = render(<ScienceOutcomeRow {...props(settled('publish_outcome', {
        meta: { ...validMeta, ...breakage },
      }), 'publish_outcome')} />)
      fireEvent.click(screen.getByRole('button', { name: /结论/u }))
      expect(view.container.querySelector('ul')).toBeNull()
      cleanup()
    }
  })

  it('loads a chart thumbnail from the exact immutable version reference', async () => {
    const projection = projectionWithChart()
    const source = projection.artifacts[0]
    if (source === undefined) throw new Error('expected run-produced chart fixture')
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    const loadVersions = vi.fn(async () => ({ ok: true, value: { versions: [{
      versionId: 'version-abc', artifactId: 'chart-1', logicalName: 'loss-curve', ordinal: 1, title: 'Loss curve',
      contentOrigin: 'run-auto', createdAt: 500, mediaType: 'image/png', byteCount: 100,
    }] } } as never))
    render(<ScienceOutcomeRow {...props(
      settled('publish_outcome', { meta: validMeta }), 'publish_outcome',
      { useProjection: vi.fn(() => projection), loadScienceImage: load, loadVersions },
    )} />)
    fireEvent.click(screen.getByRole('button', { name: /结论/u }))
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).toMatchObject({ versionId: 'version-abc', mediaType: 'image/png', byteCount: 100 })
  })
})
