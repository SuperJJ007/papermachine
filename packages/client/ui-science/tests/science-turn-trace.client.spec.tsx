// @vitest-environment jsdom
/** Turn-local artifact trace card budget, truncation, and actions. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { ScienceTurnTrace, type ScienceTurnTraceProps } from '../src/client/ScienceTurnTrace.tsx'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

const t = makeTranslate(en)
afterEach(cleanup)

function traceProps(over: Partial<ScienceTurnTraceProps> = {}): ScienceTurnTraceProps {
  const request = 'Explain an unusually long requested transformation '.repeat(20)
  const snapshot = {
    nodes: [{ kind: 'user', seq: 1, time: 1, source: { kind: 'user' },
      content: [{ type: 'text', text: request }, { type: 'image', source: 'ignored' }] }],
    chat: { nodes: new Map() },
  } as unknown as ConversationSnapshot
  const store = testScienceSelectionStore()
  return {
    sessionId: 'session-1' as never,
    seq: 9,
    turn: {} as never,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    useSession: (selector: (value: ConversationSnapshot) => unknown) => selector(snapshot),
    useProjection: vi.fn().mockReturnValue(null),
    useStore: store.useStore,
    actions: store.actions,
    matched: {
      calls: [
        { callId: 'python-1', name: 'run_python' },
        { callId: 'python-2', name: 'run_python' },
        { callId: 'r-1', name: 'run_r' },
      ],
      artifacts: [{
        artifactId: 'artifact-1', logicalName: `${'very-long-name-'.repeat(20)}.png`, version: 4, title: 'Plot',
        attachment: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 10, width: 2, height: 2 },
      }],
    },
    openArtifact: vi.fn(),
    t,
    ...over,
  } as unknown as ScienceTurnTraceProps
}

describe('ScienceTurnTrace', () => {
  it('renders exactly three compact semantic rows and counts executions rather than distinct languages', () => {
    const view = render(<ScienceTurnTrace {...traceProps()} />)
    fireEvent.click(within(view.container).getByRole('button', { name: 'This turn produced 1 files · View trace' }))

    const card = document.querySelector<HTMLElement>('[data-science-turn-card]')
    expect(card).not.toBeNull()
    expect(card?.children).toHaveLength(3)
    expect(card?.children[0]?.textContent).toContain('Explain an unusually long requested transformation')
    expect(card?.children[1]?.textContent).toBe('Python · R · 3 runs · 1 files')
    expect(card?.children[2]?.querySelectorAll('button')).toHaveLength(4)
  })

  it('falls back to the unavailable-request copy and the em dash when no run_python/run_r call occurred', () => {
    const props = traceProps({ seq: 0, matched: { calls: [{ callId: 'x', name: 'other_tool' }], artifacts: [] } })
    const view = render(<ScienceTurnTrace {...props} />)
    fireEvent.click(within(view.container).getByRole('button', { name: 'This turn produced 0 files · View trace' }))
    const card = view.container.querySelector<HTMLElement>('[data-science-turn-card]')
    expect(card?.children[0]?.textContent).toBe('The request for this turn is not loaded')
    expect(card?.children[1]?.textContent).toBe('— · 0 runs · 0 files')
  })

  it('keeps long request and file text in truncating rows inside a narrow owner', () => {
    const view = render(<div style={{ width: 260 }}><ScienceTurnTrace {...traceProps()} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'This turn produced 1 files · View trace' }))
    const card = view.container.querySelector<HTMLElement>('[data-science-turn-card]')
    const rows = card === null ? [] : [...card.children] as HTMLElement[]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const style = getComputedStyle(row)
      expect(style.overflow).toBe('hidden')
      expect(style.overflowWrap).toBe('anywhere')
    }
    // The two free-text rows line-clamp to one visible line — wrapping is
    // enabled (not `nowrap`) so `overflowWrap` can actually break a long
    // unbroken token, and the clamp then re-collapses that wrapped box back
    // to a single line instead of letting it grow the card.
    for (const row of [rows[0]!, rows[1]!]) {
      expect(row.style.getPropertyValue('-webkit-line-clamp')).toBe('1')
      expect(row.style.whiteSpace).not.toBe('nowrap')
    }
    // The links row holds discrete buttons, not wrapped text: it keeps the
    // module's `display: flex` layout instead of the line-clamp box.
    expect(rows[2]!.style.getPropertyValue('-webkit-line-clamp')).toBe('')
    expect(within(rows[2]!).getByRole('button', { name: /very-long-name/ })).toBeTruthy()
  })

  it('opens an artifact from its versioned trace node', () => {
    const openArtifact = vi.fn()
    const store = testScienceSelectionStore()
    const props = traceProps({ openArtifact, useStore: store.useStore, actions: store.actions })
    const view = render(<ScienceTurnTrace {...props} />)
    fireEvent.click(within(view.container).getByRole('button', { name: 'This turn produced 1 files · View trace' }))
    fireEvent.click(within(view.container).getByRole('button', { name: /\.png v4/ }))
    expect(store.instance.getSnapshot().openArtifacts).toEqual([{ artifactId: 'artifact-1', version: 4 }])
    expect(store.instance.getSnapshot().activeArtifactId).toBe('artifact-1')
    expect(openArtifact).toHaveBeenCalledTimes(1)
  })

  it('renders nothing below the card while no science projection is available, even with a run expanded', () => {
    const view = render(<ScienceTurnTrace {...traceProps({ useProjection: vi.fn().mockReturnValue(null) })} />)
    fireEvent.click(within(view.container).getByRole('button', { name: 'This turn produced 1 files · View trace' }))
    fireEvent.click(within(view.container).getAllByRole('button', { name: 'run_python' })[0]!)
    expect(view.container.querySelector('[data-science-turn-card]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Inspect code and logs in tool details' })).toBeNull()
  })

  it('falls back to an inspect-call button when the expanded call has no matching run yet, disabled without inspectCall', () => {
    const view = render(<ScienceTurnTrace {...traceProps({
      inspectCall: undefined, useProjection: vi.fn().mockReturnValue({ runs: [] }),
    })} />)
    fireEvent.click(within(view.container).getByRole('button', { name: 'This turn produced 1 files · View trace' }))
    fireEvent.click(within(view.container).getAllByRole('button', { name: 'run_python' })[0]!)
    const inspect = screen.getByRole('button', { name: 'Inspect code and logs in tool details' })
    expect((inspect as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens the resolved call through inspectCall when a matching run is still absent', () => {
    const inspectCall = vi.fn()
    const view = render(<ScienceTurnTrace {...traceProps({ inspectCall, useProjection: vi.fn().mockReturnValue({ runs: [] }) })} />)
    fireEvent.click(within(view.container).getByRole('button', { name: 'This turn produced 1 files · View trace' }))
    fireEvent.click(within(view.container).getAllByRole('button', { name: 'run_python' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect code and logs in tool details' }))
    expect(inspectCall).toHaveBeenCalledWith('python-1')
  })

  it('renders the resolved run\'s details, and collapses them again on a second click of the same call', () => {
    const run = { toolCallId: 'python-1', runId: 'run-1', language: 'python', status: 'success' }
    const view = render(<ScienceTurnTrace {...traceProps({ useProjection: vi.fn().mockReturnValue({ runs: [run] }) })} />)
    fireEvent.click(within(view.container).getByRole('button', { name: 'This turn produced 1 files · View trace' }))
    const runButton = within(view.container).getAllByRole('button', { name: 'run_python' })[0]!
    fireEvent.click(runButton)
    expect(screen.getByText('Code')).toBeTruthy()
    expect(runButton.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(runButton)
    expect(screen.queryByText('Code')).toBeNull()
    expect(runButton.getAttribute('aria-expanded')).toBe('false')
  })
})
