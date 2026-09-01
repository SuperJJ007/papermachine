// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
})

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    document.title = 'stale title'
    const mounted = render(<DocumentTitle productName="DeepSeek Harness" />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.rerender(<DocumentTitle productName="DeepSeek Harness" title="First title" />)
    expect(document.title).toBe('First title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle productName="DeepSeek Harness" title="Revised title" />)
    expect(document.title).toBe('Revised title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle productName="DeepSeek Harness" />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.unmount()
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('uses the generic title when no brand plugin resolves a product name', () => {
    const mounted = render(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — DSH Local Build')
    mounted.unmount()
    expect(document.title).toBe('DSH Local Build')
  })
})
