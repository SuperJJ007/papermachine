/** Exact-version admission and model-visible message tests for Science raster edits. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import ScienceArtifactStore from '@deepseek-ai/dsh-science-artifact-store'
import { ScienceArtifactId, ScienceProjectId, ScienceRunId, ScienceVersionId } from '@deepseek-ai/dsh-science-session'
import type { ScienceRunArtifactVersion } from '@deepseek-ai/dsh-science-session'
import { createScienceEditMessage, resolveScienceEdit, ScienceEditError, ScienceEditService } from '../src/edit-message.ts'
import * as EditService from '../src/edit-service.ts'
import { scienceElementCurrentSummary } from '../src/element-summary.ts'

function image(over: Partial<ScienceRunArtifactVersion> = {}): ScienceRunArtifactVersion {
  return {
    artifactId: ScienceArtifactId('chart-1'), producerSessionId: SessionId('session-1'), logicalName: 'loss.png',
    version: 1, title: 'Loss', origin: 'auto', projectId: ScienceProjectId('project-1'),
    versionId: ScienceVersionId('store-version-image'), sha256: 'a'.repeat(64), mediaType: 'image/png', byteCount: 100,
    runId: ScienceRunId('run-1'), toolCallId: CallId('call-1'), requestHeaderSeq: 2,
    environmentRevision: 1, environmentFingerprint: 'b'.repeat(64), createdAt: 1,
    chart: {
      runtime: 'matplotlib', figureKey: 'loss.png', png: { width: 100, height: 80, dpi: 100 },
      elements: [
        { id: 'axes[0].title', kind: 'title', axes: 0, label: null, current: 'Loss' },
        { id: 'subtitle', kind: 'subtitle', axes: null, label: null, current: 'Subtitle' },
      ],
      ops: [], hitmap: [], hitmapStatus: 'unavailable',
    },
    ...over,
  }
}

function region(x = 0.1, y = 0.2, width = 0.3, height = 0.4) {
  return { kind: 'normalized-region' as const, x, y, width, height }
}

function element(over: {
  elementId?: string
  elementKind?: 'title' | 'subtitle'
  axes?: number | null
  label?: string | null
  current?: string
} = {}) {
  return {
    kind: 'element' as const, elementId: over.elementId ?? 'axes[0].title', elementKind: over.elementKind ?? 'title',
    axes: over.axes === undefined ? 0 : over.axes,
    label: over.label === undefined ? null : over.label,
    current: over.current ?? 'Loss',
  }
}

function mintedImage(name: string): ImageAttachmentRef {
  return { attachmentId: AttachmentId(`sha256:${name}`), mediaType: 'image/png', bytes: 100, width: 100, height: 80 }
}

describe('Science edit-message admission', () => {
  it('registers the Remote as an independent Host plugin and removes it on fiber disposal', async () => {
    const ctx = new Context()
    const dshHome = await mkdtemp(join(tmpdir(), 'science-edit-service-'))
    try {
      await ctx.plugin(LocalAttachmentStore, { dshHome })
      await ctx.plugin(ScienceArtifactStore, { dshHome })
      ctx.provide('scienceRuntime', {} as never)
      const fiber = await ctx.plugin(EditService)
      expect(ctx.get('scienceEdits')).toBeInstanceOf(ScienceEditService)
      await fiber.dispose()
      expect(ctx.get('scienceEdits')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('emits the exact normalized region and immutable version with its minted image', () => {
    const artifact = image()
    const minted = mintedImage('minted-image')
    const resolved = resolveScienceEdit([artifact], { targets: [{
      artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1, target: region(), comment: ' brighten this area ',
    }], instruction: ' increase contrast ' })
    const message = createScienceEditMessage(resolved, new Map([[String(artifact.versionId), minted]]))
    expect(message.source).toEqual({
      kind: 'science-edit', targets: [{ artifactId: 'chart-1', logicalName: 'loss.png', version: 1, target: region(), comment: 'brighten this area' }],
      instruction: 'increase contrast',
    })
    expect(message.content).toEqual([
      { type: 'text', text: [
        'Edit these Science artifact targets:',
        '- loss.png v1 · region(0.1,0.2,0.3,0.4):"brighten this area"',
        'Instruction: increase contrast',
        'Use exactly these artifact versions as artifact_inputs sources and as edit_of parents for the corresponding edited outputs; do not substitute newer versions:',
        '- chart-1 v1',
      ].join('\n') },
      { type: 'image', attachment: minted },
    ])
  })

  it('admits an element target the viewer built from the shared scienceElementCurrentSummary, including a non-string current', () => {
    // ScienceChartEditPanel.tsx builds an element target's `current` field
    // with this exact same exported function; a legend element's current is
    // a JSON object, not a string, so this proves the shared serialization
    // — not just a hand-typed string literal — is what Host admission
    // recomputes and matches.
    const legendCurrent = { position: 'right', title: null, visible: true }
    const artifact = image({
      chart: {
        runtime: 'matplotlib', figureKey: 'loss.png', png: { width: 100, height: 80, dpi: 100 },
        elements: [{ id: 'axes[0].legend', kind: 'legend', axes: 0, label: null, current: legendCurrent }],
        ops: [], hitmap: [], hitmapStatus: 'unavailable',
      },
    })
    const resolved = resolveScienceEdit([artifact], { targets: [{
      artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1,
      target: {
        kind: 'element', elementId: 'axes[0].legend', elementKind: 'legend', axes: 0, label: null,
        current: scienceElementCurrentSummary(legendCurrent),
      },
    }], instruction: 'move the legend' })
    expect(resolved.targets).toHaveLength(1)
    expect(resolved.targets[0]?.target).toEqual({
      kind: 'element', elementId: 'axes[0].legend', elementKind: 'legend', axes: 0, label: null,
      current: JSON.stringify(legendCurrent),
    })
  })

  it('rejects a region target whose message image was not minted', () => {
    const artifact = image()
    const resolved = resolveScienceEdit([artifact], {
      targets: [{ artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1, target: region() }], instruction: 'increase contrast',
    })
    expect(() => createScienceEditMessage(resolved)).toThrow(/has no minted message image/)
  })

  it('rejects stale, missing, malformed, and media-mismatched selections', () => {
    expect(() => resolveScienceEdit([image(), image({ version: 2, createdAt: 2 })], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target: region(),
    }], instruction: 'edit selected version' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_STALE_VERSION' }))
    expect(() => resolveScienceEdit([], { targets: [{
      artifactId: ScienceArtifactId('missing'), logicalName: 'missing.png', version: 1, target: region(),
    }], instruction: 'edit selected version' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_NOT_FOUND' }))
    expect(() => resolveScienceEdit([image()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target: region(0.8, 0, 0.3, 1),
    }], instruction: 'crop' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    expect(() => resolveScienceEdit([image({ mediaType: 'application/json' })], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target: region(),
    }], instruction: 'crop' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_MISMATCH' }))
  })

  it('validates region coordinates, instructions, and target comments', () => {
    for (const target of [
      region(Number.NaN), region(-0.1), region(0, -0.1), region(0, 0, 0), region(0, 0, 1, 0), region(0, 0.5, 1, 0.6),
    ]) {
      expect(() => resolveScienceEdit([image()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target,
      }], instruction: 'change it' })).toThrow(/positive rectangle/)
    }
    for (const instruction of ['', '   ', 'has\u0000null', '\uD800 lone surrogate']) {
      expect(() => resolveScienceEdit([image()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target: region(),
      }], instruction })).toThrow(/instruction must be non-empty/)
    }
    expect(() => resolveScienceEdit([image()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target: region(), comment: '  ',
    }], instruction: 'change it' })).toThrow(/target comment must be non-empty/)
  })

  it('admits multiple targets atomically, deduplicates version images, and identifies a failing position', () => {
    const first = image()
    const second = image({ artifactId: ScienceArtifactId('chart-2'), logicalName: 'residuals.png',
      versionId: ScienceVersionId('store-version-residuals') })
    const firstMinted = mintedImage('first')
    const secondMinted = mintedImage('second')
    const message = createScienceEditMessage(resolveScienceEdit([first, second], {
      targets: [
        { artifactId: first.artifactId, logicalName: first.logicalName, version: 1, target: region(0, 0, 0.5, 1) },
        { artifactId: first.artifactId, logicalName: first.logicalName, version: 1, target: region(0.5, 0, 0.5, 1) },
        { artifactId: second.artifactId, logicalName: second.logicalName, version: 1, target: region() },
      ], instruction: 'use one palette',
    }), new Map([[String(first.versionId), firstMinted], [String(second.versionId), secondMinted]]))
    expect(message.source.kind === 'science-edit' && message.source.targets).toHaveLength(3)
    expect(message.content.filter(block => block.type === 'image')).toEqual([
      { type: 'image', attachment: firstMinted }, { type: 'image', attachment: secondMinted },
    ])
    const text = message.content[0]
    if (text?.type !== 'text') throw new Error('expected text content')
    expect(text.text.match(/^- chart-1 v1$/gm)).toHaveLength(1)

    let caught: unknown
    try {
      resolveScienceEdit([first], { targets: [
        { artifactId: first.artifactId, logicalName: first.logicalName, version: 1, target: region() },
        { artifactId: ScienceArtifactId('missing'), logicalName: 'missing.png', version: 1, target: region() },
      ], instruction: 'change both' })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ScienceEditError)
    expect((caught as ScienceEditError).message).toContain('target 2')
  })

  it('resolves a precise element target against the addressed chart and renders every identity field', () => {
    const artifact = image()
    const resolved = resolveScienceEdit([artifact], { targets: [
      { artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1, target: element({ current: 'Loss' }) },
      { artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1, target: element({ elementId: 'subtitle', elementKind: 'subtitle', axes: null, current: 'Subtitle' }) },
    ], instruction: 'shorten the title' })
    const message = createScienceEditMessage(resolved)
    expect(message.source).toMatchObject({ kind: 'science-edit',
      targets: [
        { target: { kind: 'element', elementId: 'axes[0].title', elementKind: 'title', axes: 0, label: null, current: 'Loss' } },
        { target: { kind: 'element', elementId: 'subtitle', elementKind: 'subtitle', axes: null, label: null, current: 'Subtitle' } },
      ] })
    expect(message.content).toEqual([{ type: 'text', text: [
      'Edit these Science artifact targets:',
      '- loss.png v1 · element("axes[0].title", kind=title, axes=0, label=null, current="Loss")',
      '- loss.png v1 · element("subtitle", kind=subtitle, axes=null, label=null, current="Subtitle")',
      'Instruction: shorten the title',
      'Use exactly these artifact versions as artifact_inputs sources and as edit_of parents for the corresponding edited outputs; do not substitute newer versions:',
      '- chart-1 v1',
    ].join('\n') }])
  })

  it('rejects incomplete, malformed, or mismatched element identity fields', () => {
    for (const target of [element({ elementId: '' }), element({ elementId: '  ' }), element({ elementKind: '' as never })]) {
      expect(() => resolveScienceEdit([image()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target,
      }], instruction: 'change it' })).toThrow(/valid element id and kind/)
    }
    for (const current of ['', 'has\u0000null', '\uD800 lone surrogate']) {
      expect(() => resolveScienceEdit([image()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target: element({ current }),
      }], instruction: 'change it' })).toThrow(/current value must be non-empty well-formed/)
    }
    for (const target of [element({ axes: -1 }), element({ label: '' })]) {
      expect(() => resolveScienceEdit([image()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target,
      }], instruction: 'change it' })).toThrow(/target (axes|label)/)
    }
    expect(() => resolveScienceEdit([image()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1,
      target: element({ elementId: 'missing' }),
    }], instruction: 'change it' })).toThrow(/does not match the addressed chart element/)
    const { chart: _chart, ...withoutChart } = image()
    expect(() => resolveScienceEdit([withoutChart], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target: element(),
    }], instruction: 'change it' })).toThrow(/addressable chart/)
  })

  it('omits the image attachment for an element target and mixes cleanly with a region target on the same version', () => {
    const artifact = image()
    const minted = mintedImage('minted-image')
    const resolved = resolveScienceEdit([artifact], { targets: [
      { artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1, target: region() },
      { artifactId: artifact.artifactId, logicalName: artifact.logicalName, version: 1, target: element() },
    ], instruction: 'use one palette and shorten the title' })
    const message = createScienceEditMessage(resolved, new Map([[String(artifact.versionId), minted]]))
    expect(message.content.filter(block => block.type === 'image')).toEqual([{ type: 'image', attachment: minted }])
  })

  it('rejects empty, duplicate, and cross-version target sets before admission', () => {
    expect(() => resolveScienceEdit([image()], { targets: [], instruction: 'change it' })).toThrow(/select at least one/)
    const duplicate = { artifactId: ScienceArtifactId('chart-1'), logicalName: 'loss.png', version: 1, target: region() }
    expect(() => resolveScienceEdit([image()], { targets: [duplicate, duplicate], instruction: 'change it' }))
      .toThrow(/target 2 duplicates/)
    expect(() => resolveScienceEdit([image(), image({ version: 2 })], {
      targets: [duplicate, { ...duplicate, version: 2, target: region(0.5, 0, 0.5, 1) }], instruction: 'change it',
    })).toThrow(/target 2 selects a second version/)
  })
})
