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
  it.each([
    ['text/csv', 'table', 'CSV'],
    ['application/json', 'json', 'JSON'],
    ['text/markdown', 'document', 'MD'],
  ])('renders the %s icon and stays hidden from the accessibility tree', (mediaType, kind, label) => {
    const view = render(<ArtifactFileTile mediaType={mediaType} />)
    expect(view.container.textContent).toBe(label)
    expect(view.container.firstElementChild?.getAttribute('data-kind')).toBe(kind)
    expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
