// @vitest-environment jsdom
/**
 * The provenance drill-in: the breadcrumb (root segment jumps back to
 * content), and the current content origin/creation time facts shown for one
 * resolved version. The former Code/Execution-log/Messages/Environment
 * sub-tabs are gone with the `runId`/`toolCallId`/`producerSessionId` fields
 * they needed — see `ScienceArtifactProvenance.tsx`'s own module JSDoc.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceArtifactProvenance, type ScienceArtifactProvenanceProps } from '../src/client/ScienceArtifactProvenance.tsx'
import type { ScienceRenderableVersion } from '../src/client/version-summaries.ts'
import { en } from '../src/client/locales.ts'

type Props = ScienceArtifactProvenanceProps
const t: Props['t'] = makeTranslate(en)

afterEach(cleanup)

function chart(over: Partial<ScienceRenderableVersion> = {}): ScienceRenderableVersion {
  return {
    artifactId: 'chart-1' as never, logicalName: 'loss-curve', version: 2, title: 'Loss curve',
    versionId: 'version-abc', sha256: 'abc', mediaType: 'image/png', byteCount: 10,
    contentOrigin: 'run-auto', createdAt: 3_000,
    ...over,
  }
}

function renderProvenance(over: Partial<Props> = {}) {
  const onBack = vi.fn()
  const view = render(<ScienceArtifactProvenance chart={chart()} onBack={onBack} t={t} {...over} />)
  return { view, onBack }
}

describe('ScienceArtifactProvenance: breadcrumb', () => {
  it('names the exact resolved version and returns to content on click', () => {
    const { onBack } = renderProvenance()
    expect(screen.getByText('Provenance')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Loss curve' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('ScienceArtifactProvenance: content origin and creation time', () => {
  it.each([
    ['run-auto', 'Produced by an automatic run'],
    ['human-edit', 'Produced by a human edit'],
    ['import', 'Produced by an import'],
  ] as const)('shows %s as %s', (contentOrigin, expected) => {
    renderProvenance({ chart: chart({ contentOrigin }) })
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('shows the exact version number and its creation time', () => {
    renderProvenance({ chart: chart({ version: 5, createdAt: new Date('2026-01-01T00:00:00Z').getTime() }) })
    expect(screen.getByText('v5')).toBeTruthy()
    expect(screen.getByText(/Created at/u)).toBeTruthy()
  })
})
