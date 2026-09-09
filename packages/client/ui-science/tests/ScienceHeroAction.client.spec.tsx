// @vitest-environment jsdom
/**
 * The root-level Files action: visible only while the current Session is
 * blank (not yet started) and running the built-in `science` preset — every
 * other current-Session shape, and no current Session at all, renders
 * nothing, since the Session header owns the control once a Session starts.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { ScienceHeroAction, type ScienceHeroActionProps } from '../src/client/ScienceHeroAction.tsx'
import { en } from '../src/client/locales.ts'

const SESSION = 'session-1' as SessionId
const t: ScienceHeroActionProps['t'] = makeTranslate(en)

afterEach(cleanup)

function props(
  current: SessionId | undefined,
  session?: { blank: boolean; agentPreset?: string },
  toggleDetails = vi.fn(),
): ScienceHeroActionProps {
  const state = {
    ids: current === undefined ? [] : [current],
    byId: current === undefined || session === undefined ? {} : {
      [current]: {
        id: current, displayTitle: current, running: false, updatedAt: 0,
        blank: session.blank, ...session.agentPreset === undefined ? {} : { agentPreset: session.agentPreset },
      },
    },
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } satisfies SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  return { useSessions, toggleDetails, t } as unknown as ScienceHeroActionProps
}

describe('ScienceHeroAction visibility', () => {
  it('renders nothing while no Session is current', () => {
    const { container } = render(<ScienceHeroAction {...props(undefined)} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the current Session id has no listed summary', () => {
    const { container } = render(<ScienceHeroAction {...props(SESSION)} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for a non-blank Science session (the header owns it there)', () => {
    const { container } = render(<ScienceHeroAction {...props(SESSION, { blank: false, agentPreset: 'science' })} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for a blank session running a non-Science preset', () => {
    const { container } = render(<ScienceHeroAction {...props(SESSION, { blank: true, agentPreset: 'research-assistant' })} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the Files action for a blank Science session', () => {
    render(<ScienceHeroAction {...props(SESSION, { blank: true, agentPreset: 'science' })} />)
    expect(screen.getByRole('button', { name: 'Science details' })).toBeTruthy()
  })
})

describe('ScienceHeroAction activation', () => {
  it('routes its click through the owner-supplied toggle', () => {
    const toggleDetails = vi.fn()
    render(<ScienceHeroAction {...props(SESSION, { blank: true, agentPreset: 'science' }, toggleDetails)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Science details' }))
    expect(toggleDetails).toHaveBeenCalledTimes(1)
  })
})
