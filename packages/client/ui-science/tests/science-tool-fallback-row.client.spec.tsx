// @vitest-environment jsdom
/**
 * Shared fallback presentation used by dedicated Science rows when their
 * tagged presentation is absent: no current row falls back to a status-and-
 * text-only card today, so this suite exercises the exported building block
 * directly against its own props contract.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ScienceToolFallbackRow, scienceToolResultText, type ScienceToolFallbackClasses,
} from '../src/client/ScienceToolFallbackRow.tsx'

afterEach(cleanup)

const classes: ScienceToolFallbackClasses = {
  card: 'card', header: 'header', leading: 'leading', title: 'title', status: 'status', fallbackText: 'text',
}

describe('ScienceToolFallbackRow', () => {
  it('renders a status label and durable text when both are present', () => {
    const view = render(
      <ScienceToolFallbackRow dataTool="science-fixture" state="error" leading={<span>icon</span>}
        title="Fixture" status="Failed" text="boom" classes={classes} />,
    )
    expect(view.container.querySelector('[data-tool="science-fixture"]')?.getAttribute('data-state')).toBe('error')
    expect(view.getByText('Failed')).toBeTruthy()
    expect(view.getByText('boom')).toBeTruthy()
  })

  it('omits the status label and text block when both are absent, and still renders trailing content', () => {
    const view = render(
      <ScienceToolFallbackRow dataTool="science-fixture" state="ok" leading={<span>icon</span>}
        title="Fixture" status={null} text={null} classes={classes} after={<span>after</span>} />,
    )
    expect(view.container.querySelector('.status')).toBeNull()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(view.getByText('after')).toBeTruthy()
  })
})

describe('scienceToolResultText', () => {
  it('serializes a non-text content block to JSON instead of the raw text join', () => {
    const block = {
      kind: 'tool-result',
      content: [{ type: 'tool-result', toolCallId: 'call-1', content: [], isError: false }],
    } as unknown as ToolResultNode
    expect(scienceToolResultText(block)).toBe(JSON.stringify(block.content[0], null, 2))
  })
})
