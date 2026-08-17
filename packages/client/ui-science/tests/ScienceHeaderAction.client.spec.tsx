// @vitest-environment jsdom
/**
 * The Science session-header action: visible only for a built-in Science
 * session, hidden for every Standard or custom preset (including no preset
 * at all), and its one click routes through the owner-supplied
 * `openDetailsView` — it opens no panel of its own.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { ScienceHeaderAction, type ScienceHeaderActionProps } from '../src/client/ScienceHeaderAction.tsx'
import { en } from '../src/client/locales.ts'

const SESSION = 'session-1' as SessionId
const t: ScienceHeaderActionProps['t'] = makeTranslate(en)

afterEach(cleanup)

function props(agentPreset: string | undefined, openDetailsView = vi.fn()): ScienceHeaderActionProps {
  const state = {
    ids: [SESSION],
    byId: {
      [SESSION]: {
        id: SESSION, displayTitle: SESSION, running: false, blank: false, updatedAt: 0,
        ...agentPreset === undefined ? {} : { agentPreset },
      },
    },
    current: SESSION,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } satisfies SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  return { sessionId: SESSION, useSessions, openDetailsView, t } as unknown as ScienceHeaderActionProps
}

describe('ScienceHeaderAction visibility', () => {
  it('renders nothing for a Standard session (no agentPreset)', () => {
    const { container } = render(<ScienceHeaderAction {...props(undefined)} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for a custom non-Science preset', () => {
    const { container } = render(<ScienceHeaderAction {...props('research-assistant')} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the action for a built-in Science session', () => {
    render(<ScienceHeaderAction {...props('science')} />)
    expect(screen.getByRole('button', { name: 'Science details' })).toBeTruthy()
  })
})

describe('ScienceHeaderAction activation', () => {
  it('opens the routed science Details entry through openDetailsView, and nothing else', () => {
    const openDetailsView = vi.fn()
    render(<ScienceHeaderAction {...props('science', openDetailsView)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Science details' }))
    expect(openDetailsView).toHaveBeenCalledTimes(1)
    expect(openDetailsView).toHaveBeenCalledWith('science')
  })
})
