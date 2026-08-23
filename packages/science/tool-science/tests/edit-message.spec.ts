/** Exact-version admission and model-visible message tests for Science viewer edits. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId } from '@deepseek-ai/dsh-llm'
import { ScienceArtifactId, ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactVersion } from '@deepseek-ai/dsh-science-session'
import {
  createScienceEditMessage,
  resolveScienceEdit,
  ScienceEditError,
  ScienceEditService,
} from '../src/edit-message.ts'
import * as EditService from '../src/edit-service.ts'

function image(over: Partial<ScienceArtifactVersion> = {}): ScienceArtifactVersion {
  return {
    artifactId: ScienceArtifactId('chart-1'),
    logicalName: 'loss.png',
    version: 1,
    title: 'Loss',
    origin: 'auto',
    attachment: {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png',
      bytes: 100,
      width: 100,
      height: 80,
    },
    runId: ScienceRunId('run-1'),
    toolCallId: CallId('call-1'),
    requestHeaderSeq: 2,
    environmentRevision: 1,
    environmentFingerprint: 'b'.repeat(64),
    createdAt: 1,
    ...over,
  }
}

function vega(over: Partial<ScienceArtifactVersion> = {}): ScienceArtifactVersion {
  return image({
    logicalName: 'loss.vl.json',
    attachment: {
      attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`),
      mediaType: 'application/vnd.vega-lite+json',
      bytes: 200,
    },
    ...over,
  })
}

describe('Science edit-message admission', () => {
  it('registers the Remote as an independent Host plugin and removes it on fiber disposal', async () => {
    const ctx = new Context()
    try {
      const fiber = await ctx.plugin(EditService)
      expect(ctx.get('scienceEdits')).toBeInstanceOf(ScienceEditService)
      await fiber.dispose()
      expect(ctx.get('scienceEdits')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
  it('emits the exact Vega-Lite path and immutable version in the durable message source and model text', () => {
    const resolved = resolveScienceEdit([vega()], {
      artifactId: ScienceArtifactId('chart-1'),
      version: 1,
      target: { kind: 'spec-path', path: ' encoding.color ' },
      instruction: ' make it blue ',
    })
    const message = createScienceEditMessage(resolved)
    expect(message.source).toEqual({
      kind: 'science-edit', artifactId: 'chart-1', version: 1,
      target: { kind: 'spec-path', path: 'encoding.color' }, instruction: 'make it blue',
    })
    expect(message.content).toEqual([{ type: 'text', text: [
      'Edit Science artifact "loss.vl.json" (chart-1 v1).',
      'Spec path: encoding.color',
      'Instruction: make it blue',
      'Use exactly chart-1 v1 as an artifact_inputs source and as the edit_of parent for the edited output. Do not substitute a newer version.',
    ].join('\n') }])
  })

  it('attaches the exact raster version after normalizing the selected region', () => {
    const artifact = image()
    const message = createScienceEditMessage(resolveScienceEdit([artifact], {
      artifactId: artifact.artifactId,
      version: 1,
      target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      instruction: 'increase contrast',
    }))
    expect(message.source).toMatchObject({
      kind: 'science-edit', artifactId: 'chart-1', version: 1,
      target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    })
    expect(message.content[1]).toEqual({ type: 'image', attachment: artifact.attachment })
  })

  it('rejects an older selected version instead of substituting the current version', () => {
    const versions = [image(), image({ version: 2, createdAt: 2 })]
    expect(() => resolveScienceEdit(versions, {
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'normalized-region', x: 0, y: 0, width: 1, height: 1 },
      instruction: 'edit selected version',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_STALE_VERSION' }))
  })

  it('rejects missing artifacts, malformed regions, and targets that do not match the media type', () => {
    expect(() => resolveScienceEdit([], {
      artifactId: ScienceArtifactId('missing'), version: 1,
      target: { kind: 'spec-path', path: 'mark' }, instruction: 'change mark',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_NOT_FOUND' }))
    expect(() => resolveScienceEdit([image()], {
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'normalized-region', x: 0.8, y: 0, width: 0.3, height: 1 }, instruction: 'crop',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    expect(() => resolveScienceEdit([image()], {
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'spec-path', path: 'mark' }, instruction: 'change mark',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_MISMATCH' }))
    expect(() => resolveScienceEdit([vega()], {
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'normalized-region', x: 0, y: 0, width: 1, height: 1 }, instruction: 'crop',
    })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_TARGET_MISMATCH' }))
  })

  it('rejects malformed spec paths and ill-formed instructions', () => {
    for (const path of ['', ' ', 'encoding..color', '.mark', 'mark.', 'encoding.color!']) {
      expect(() => resolveScienceEdit([vega()], {
        artifactId: ScienceArtifactId('chart-1'), version: 1,
        target: { kind: 'spec-path', path }, instruction: 'change it',
      })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    }
    for (const instruction of ['', '   ', 'has\u0000null', '\uD800 lone surrogate']) {
      expect(() => resolveScienceEdit([vega()], {
        artifactId: ScienceArtifactId('chart-1'), version: 1,
        target: { kind: 'spec-path', path: 'mark' }, instruction,
      })).toThrow(expect.objectContaining<Partial<ScienceEditError>>({ code: 'SCIENCE_EDIT_INVALID_REQUEST' }))
    }
  })
})
