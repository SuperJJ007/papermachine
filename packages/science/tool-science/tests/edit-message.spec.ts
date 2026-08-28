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

function image(over: Partial<ScienceRunArtifactVersion> = {}): ScienceRunArtifactVersion {
  return {
    artifactId: ScienceArtifactId('chart-1'), producerSessionId: SessionId('session-1'), logicalName: 'loss.png',
    version: 1, title: 'Loss', origin: 'auto', projectId: ScienceProjectId('project-1'),
    versionId: ScienceVersionId('store-version-image'), sha256: 'a'.repeat(64), mediaType: 'image/png', byteCount: 100,
    runId: ScienceRunId('run-1'), toolCallId: CallId('call-1'), requestHeaderSeq: 2,
    environmentRevision: 1, environmentFingerprint: 'b'.repeat(64), createdAt: 1, ...over,
  }
}

function region(x = 0.1, y = 0.2, width = 0.3, height = 0.4) {
  return { kind: 'normalized-region' as const, x, y, width, height }
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
      artifactId: artifact.artifactId, version: 1, target: region(), comment: ' brighten this area ',
    }], instruction: ' increase contrast ' })
    const message = createScienceEditMessage(resolved, new Map([[String(artifact.versionId), minted]]))
    expect(message.source).toEqual({
      kind: 'science-edit', targets: [{ artifactId: 'chart-1', version: 1, target: region(), comment: 'brighten this area' }],
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

  it('rejects a region target whose message image was not minted', () => {
    const artifact = image()
    const resolved = resolveScienceEdit([artifact], {
      targets: [{ artifactId: artifact.artifactId, version: 1, target: region() }], instruction: 'increase contrast',
    })
    expect(() => createScienceEditMessage(resolved)).toThrow(/has no minted message image/)
  })

  it('rejects stale, missing, malformed, and media-mismatched selections', () => {
    expect(() => resolveScienceEdit([image(), image({ version: 2, createdAt: 2 })], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1, target: region(),
    }], instruction: 'edit selected version' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_STALE_VERSION' }))
    expect(() => resolveScienceEdit([], { targets: [{
      artifactId: ScienceArtifactId('missing'), version: 1, target: region(),
    }], instruction: 'edit selected version' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_NOT_FOUND' }))
    expect(() => resolveScienceEdit([image()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1, target: region(0.8, 0, 0.3, 1),
    }], instruction: 'crop' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    expect(() => resolveScienceEdit([image({ mediaType: 'application/json' })], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1, target: region(),
    }], instruction: 'crop' }))
      .toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_MISMATCH' }))
  })

  it('validates region coordinates, instructions, and target comments', () => {
    for (const target of [
      region(Number.NaN), region(-0.1), region(0, -0.1), region(0, 0, 0), region(0, 0, 1, 0), region(0, 0.5, 1, 0.6),
    ]) {
      expect(() => resolveScienceEdit([image()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), version: 1, target,
      }], instruction: 'change it' })).toThrow(/positive rectangle/)
    }
    for (const instruction of ['', '   ', 'has\u0000null', '\uD800 lone surrogate']) {
      expect(() => resolveScienceEdit([image()], { targets: [{
        artifactId: ScienceArtifactId('chart-1'), version: 1, target: region(),
      }], instruction })).toThrow(/instruction must be non-empty/)
    }
    expect(() => resolveScienceEdit([image()], { targets: [{
      artifactId: ScienceArtifactId('chart-1'), version: 1, target: region(), comment: '  ',
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
        { artifactId: first.artifactId, version: 1, target: region(0, 0, 0.5, 1) },
        { artifactId: first.artifactId, version: 1, target: region(0.5, 0, 0.5, 1) },
        { artifactId: second.artifactId, version: 1, target: region() },
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
        { artifactId: first.artifactId, version: 1, target: region() },
        { artifactId: ScienceArtifactId('missing'), version: 1, target: region() },
      ], instruction: 'change both' })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ScienceEditError)
    expect((caught as ScienceEditError).message).toContain('target 2')
  })

  it('rejects empty, duplicate, and cross-version target sets before admission', () => {
    expect(() => resolveScienceEdit([image()], { targets: [], instruction: 'change it' })).toThrow(/select at least one/)
    const duplicate = { artifactId: ScienceArtifactId('chart-1'), version: 1, target: region() }
    expect(() => resolveScienceEdit([image()], { targets: [duplicate, duplicate], instruction: 'change it' }))
      .toThrow(/target 2 duplicates/)
    expect(() => resolveScienceEdit([image(), image({ version: 2 })], {
      targets: [duplicate, { ...duplicate, version: 2, target: region(0.5, 0, 0.5, 1) }], instruction: 'change it',
    })).toThrow(/target 2 selects a second version/)
  })
})
