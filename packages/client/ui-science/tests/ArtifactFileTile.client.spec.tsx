// @vitest-environment jsdom
// ArtifactFileTile: the known-extension labels, the generic fallback for an
// unrecognized text media type, and that the tile is hidden from the
// accessibility tree (every call site supplies its own accessible name).

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactFileTile, artifactExtensionLabel } from '../src/client/ArtifactFileTile.tsx'

afterEach(cleanup)

describe('artifactExtensionLabel', () => {
  it.each([
    ['text/csv', 'CSV'],
    ['application/json', 'JSON'],
    ['text/markdown', 'MD'],
    ['text/plain', 'TXT'],
  ])('labels %s as %s', (mediaType, label) => {
    expect(artifactExtensionLabel(mediaType)).toBe(label)
  })

  it('falls back to the uppercased subtype for an unrecognized text media type', () => {
    expect(artifactExtensionLabel('text/x-yaml')).toBe('X-YAML')
  })

  it('falls back to the whole media type uppercased when it carries no subtype', () => {
    expect(artifactExtensionLabel('bogus')).toBe('BOGUS')
  })
})

describe('ArtifactFileTile', () => {
  it('renders the extension label and stays hidden from the accessibility tree', () => {
    const view = render(<ArtifactFileTile mediaType="text/csv" />)
    expect(view.container.textContent).toBe('CSV')
    expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
