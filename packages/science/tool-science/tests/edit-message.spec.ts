/** Exact-version admission and model-visible message tests for Science viewer edits. */

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
import {
  createScienceEditMessage,
  resolveScienceEdit,
  ScienceEditError,
  ScienceEditService,
} from '../src/edit-message.ts'
import * as EditService from '../src/edit-service.ts'

function image(over: Partial<ScienceRunArtifactVersion> = {}): ScienceRunArtifactVersion {
  return {
    artifactId: ScienceArtifactId('chart-1'),
    producerSessionId: SessionId('session-1'),
    logicalName: 'loss.png',
    version: 1,
    title: 'Loss',
    origin: 'auto',
    projectId: ScienceProjectId('project-1'),
    versionId: ScienceVersionId('store-version-image'),
    sha256: 'a'.repeat(64),
    mediaType: 'image/png',
    byteCount: 100,
    runId: ScienceRunId('run-1'),
    toolCallId: CallId('call-1'),
    requestHeaderSeq: 2,
    environmentRevision: 1,
    environmentFingerprint: 'b'.repeat(64),
    createdAt: 1,
    ...over,
  }
}

function vega(over: Partial<ScienceRunArtifactVersion> = {}): ScienceRunArtifactVersion {
  return image({
    logicalName: 'loss.vl.json',
    versionId: ScienceVersionId('store-version-vega'),
    sha256: 'c'.repeat(64),
    mediaType: 'image/png',
    byteCount: 200,
    ...over,
  })
}

/** Minted session message attachment a region target's raster rides the edit message as. */
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
      const fiber = await ctx.plugin(EditService)
      expect(ctx.get('scienceEdits')).toBeInstanceOf(ScienceEditService)
      await fiber.dispose()
      expect(ctx.get('scienceEdits')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
      await rm(dshHome, { recursive: true, force: true })
    }
  })
  it('emits the exact Vega-Lite path and immutable version in the durable message source and model text', () => {
    const resolved = resolveScienceEdit([vega()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'),
      version: 1,
      target: { kind: 'spec-path', path: ' encoding.color ' },
    }], instruction: ' make it blue ',
    })
    const message = createScienceEditMessage(resolved)
    expect(message.source).toEqual({
      kind: 'science-edit', targets: [{ artifactId: 'chart-1', version: 1,
        target: { kind: 'spec-path', path: 'encoding.color' } }], instruction: 'make it blue',
    })
    expect(message.content).toEqual([{ type: 'text', text: [
      'Edit these Science artifact targets:',
      '- loss.vl.json v1 · encoding.color',
      'Instruction: make it blue',
      'Use exactly these artifact versions as artifact_inputs sources and as edit_of parents for the corresponding edited outputs; do not substitute newer versions:',
      '- chart-1 v1',
    ].join('\n') }])
  })

  it('attaches the minted raster image for the selected region, keyed by the target store version', () => {
    const artifact = image()
    const minted = mintedImage('minted-image')
    const message = createScienceEditMessage(resolveScienceEdit([artifact], { targets: [{
      artifactId: artifact.artifactId,
      version: 1,
      target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    }], instruction: 'increase contrast' }), new Map([[String(artifact.versionId), minted]]))
    expect(message.source).toMatchObject({
      kind: 'science-edit', targets: [{ artifactId: 'chart-1', version: 1,
        target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }],
    })
    expect(message.content[1]).toEqual({ type: 'image', attachment: minted })
  })

  it('rejects a region target whose message image was not minted', () => {
    const artifact = image()
    expect(() => createScienceEditMessage(resolveScienceEdit([artifact], { targets: [{
      artifactId: artifact.artifactId,
      version: 1,
      target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    }], instruction: 'increase contrast' }))).toThrow(/has no minted message image/)
  })

  it('rejects an older selected version instead of substituting the current version', () => {
    const versions = [image(), image({ version: 2, createdAt: 2 })]
    expect(() => resolveScienceEdit(versions, { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'normalized-region', x: 0, y: 0, width: 1, height: 1 },
    }], instruction: 'edit selected version' })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_STALE_VERSION' }))
  })

  it('rejects missing artifacts, malformed regions, and targets that do not match the media type', () => {
    expect(() => resolveScienceEdit([], { targets: [{
      artifactId: ScienceArtifactId('missing'), version: 1,
      target: { kind: 'spec-path', path: 'mark' } }], instruction: 'change mark',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_NOT_FOUND' }))
    expect(() => resolveScienceEdit([image()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'normalized-region', x: 0.8, y: 0, width: 0.3, height: 1 } }], instruction: 'crop',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    expect(() => resolveScienceEdit([image()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'spec-path', path: 'mark' } }], instruction: 'change mark',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_MISMATCH' }))
    expect(() => resolveScienceEdit([vega()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'normalized-region', x: 0, y: 0, width: 1, height: 1 } }], instruction: 'crop',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_MISMATCH' }))
  })

  it('rejects malformed spec paths and ill-formed instructions', () => {
    for (const path of ['', ' ', 'encoding..color', '.mark', 'mark.', 'encoding.color!']) {
      expect(() => resolveScienceEdit([vega()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), version: 1,
        target: { kind: 'spec-path', path } }], instruction: 'change it',
      })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    }
    for (const instruction of ['', '   ', 'has\u0000null', '\uD800 lone surrogate']) {
      expect(() => resolveScienceEdit([vega()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), version: 1,
        target: { kind: 'spec-path', path: 'mark' } }], instruction,
      })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    }
    expect(() => resolveScienceEdit([vega()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1, target: { kind: 'unsupported' } as never,
    }], instruction: 'change it' })).toThrow(/science edit target/)
  })

  it('validates an element comment like the shared instruction and preserves it in model-visible text', () => {
    const resolved = resolveScienceEdit([vega({ version: 5, logicalName: 'chart.vl.json' })], {
      targets: [{ artifactId: 'chart-1' as never, version: 5, target: { kind: 'spec-path', path: 'encoding.y' }, comment: ' 改成蓝色 ' }],
      instruction: 'apply the selected edits',
    })
    const content = createScienceEditMessage(resolved).content[0]
    expect(content?.type).toBe('text')
    if (content?.type !== 'text') throw new Error('expected text content')
    expect(content.text).toContain('- chart.vl.json v5 · encoding.y:"改成蓝色"')
    expect(() => resolveScienceEdit([vega()], {
      targets: [{ artifactId: 'chart-1' as never, version: 1, target: { kind: 'spec-path', path: 'mark' }, comment: '  ' }],
      instruction: 'change it',
    })).toThrow(/target comment must be non-empty/)
  })

  it('admits multiple exact targets atomically and attaches every raster in target order', () => {
    const chart = vega()
    const raster = image({
      artifactId: ScienceArtifactId('chart-2'),
      logicalName: 'residuals.png',
      versionId: ScienceVersionId('store-version-residuals'),
    })
    const minted = mintedImage('minted-residuals')
    const message = createScienceEditMessage(resolveScienceEdit([chart, raster], {
      targets: [
        { artifactId: chart.artifactId, version: 1, target: { kind: 'spec-path', path: 'encoding.y' } },
        { artifactId: raster.artifactId, version: 1, target: { kind: 'normalized-region', x: 0, y: 0, width: 0.5, height: 1 } },
      ],
      instruction: 'use one blue palette',
    }), new Map([[String(raster.versionId), minted]]))
    if (message.source.kind !== 'science-edit') throw new Error('expected a science-edit source')
    expect(message.source.targets).toHaveLength(2)
    expect(message.content).toHaveLength(2)
    expect(message.content[1]).toEqual({ type: 'image', attachment: minted })
  })

  it('identifies the failing selection without admitting any part of a multi-target request', () => {
    let caught: unknown
    try {
      resolveScienceEdit([vega()], {
        targets: [
          { artifactId: ScienceArtifactId('chart-1'), version: 1, target: { kind: 'spec-path', path: 'mark' } },
          { artifactId: ScienceArtifactId('missing'), version: 1, target: { kind: 'spec-path', path: 'mark' } },
        ],
        instruction: 'make both blue',
      })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ScienceEditError)
    if (!(caught instanceof ScienceEditError)) throw new Error('expected ScienceEditError')
    expect(caught.code).toBe('SCIENCE_EDIT_TARGET_NOT_FOUND')
    expect(caught.message).toContain('target 2')
  })

  it('rejects empty, duplicate, and cross-version target sets before admission', () => {
    expect(() => resolveScienceEdit([vega()], { targets: [], instruction: 'change it' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    const duplicate = { artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'spec-path' as const, path: 'mark' } }
    expect(() => resolveScienceEdit([vega()], { targets: [duplicate, duplicate], instruction: 'change it' }))
      .toThrow(/target 2 duplicates/)
    expect(() => resolveScienceEdit([vega(), vega({ version: 2 })], {
      targets: [duplicate, { ...duplicate, version: 2, target: { kind: 'spec-path', path: 'encoding.x' } }],
      instruction: 'change it',
    })).toThrow(/target 2 selects a second version/)
  })

  it('lists one exact parent line per artifact while retaining each distinct target', () => {
    const chart = vega()
    const message = createScienceEditMessage(resolveScienceEdit([chart], {
      targets: [
        { artifactId: chart.artifactId, version: 1, target: { kind: 'spec-path', path: 'encoding.x' } },
        { artifactId: chart.artifactId, version: 1, target: { kind: 'spec-path', path: 'encoding.y' } },
      ],
      instruction: 'align axes',
    }))
    const text = message.content[0]
    if (text?.type !== 'text') throw new Error('expected text content')
    expect(text.text.match(/^- chart-1 v1$/gm)).toHaveLength(1)
    expect(text.text).toContain('- loss.vl.json v1 · encoding.x')
    expect(text.text).toContain('- loss.vl.json v1 · encoding.y')
  })
})
