// @vitest-environment jsdom
// ArtifactFileTile: the known-extension labels, the generic fallback for an
// unrecognized text media type, and that the tile is hidden from the
// accessibility tree (every call site supplies its own accessible name).

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { zh as displayZh } from '../src/client/science-display-locales.ts'
import { ArtifactFileTile, artifactExtensionLabel } from '../src/client/ArtifactFileTile.tsx'

const t = makeTranslate({ ...zh, ...displayZh })

afterEach(cleanup)

describe('artifactExtensionLabel', () => {
  it.each([
    ['text/csv', 'CSV'],
    ['application/json', 'JSON'],
    ['text/markdown', 'MD'],
    ['text/plain', 'TXT'],
  ])('labels %s as %s', (mediaType, label) => {
    expect(artifactExtensionLabel(mediaType, t)).toBe(label)
  })

  it('falls back to the uppercased subtype for an unrecognized text media type', () => {
    expect(artifactExtensionLabel('text/x-yaml', t)).toBe('X-YAML')
  })

  it('falls back to the whole media type uppercased when it carries no subtype', () => {
    expect(artifactExtensionLabel('bogus', t)).toBe('BOGUS')
  })
})

describe('ArtifactFileTile', () => {
  it.each([
    ['text/csv', 'table', 'CSV'],
    ['application/json', 'json', 'JSON'],
    ['text/markdown', 'document', 'MD'],
  ])('renders the %s icon and stays hidden from the accessibility tree', (mediaType, kind, label) => {
    const view = render(<ArtifactFileTile mediaType={mediaType} t={t} />)
    expect(view.container.textContent).toBe(label)
    expect(view.container.firstElementChild?.getAttribute('data-kind')).toBe(kind)
    expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
