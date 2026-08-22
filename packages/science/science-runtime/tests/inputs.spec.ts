/** Focused pre-publication validation for artifact inputs and edit baselines. */

import { describe, expect, it, vi } from 'vitest'
import type { AttachmentStore, ImageAttachmentRef, TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId } from '@deepseek-ai/dsh-llm'
import { ScienceArtifactId, ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactVersion, ScienceProjection } from '@deepseek-ai/dsh-science-session'
import { prepareRunArtifacts } from '../src/inputs.ts'

const TEXT_ID = ScienceArtifactId('text-artifact')
const IMAGE_ID = ScienceArtifactId('image-artifact')
const textRef: TextAttachmentRef = {
  attachmentId: AttachmentId('sha256:text'), mediaType: 'text/plain', bytes: 2, name: 'text.txt',
}
const imageRef: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:image'), mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'image.png',
}

function artifact(
  artifactId: ReturnType<typeof ScienceArtifactId>,
  attachment: ImageAttachmentRef | TextAttachmentRef,
): ScienceArtifactVersion {
  return {
    artifactId,
    logicalName: attachment.name ?? 'artifact',
    version: 1,
    title: attachment.name ?? 'artifact',
    origin: 'auto',
    attachment,
    runId: ScienceRunId('source-run'),
    toolCallId: CallId('source-call'),
    requestHeaderSeq: 1,
    environmentRevision: 1,
    environmentFingerprint: 'fingerprint',
    createdAt: 1,
  }
}

const projection = {
  artifacts: [artifact(TEXT_ID, textRef), artifact(IMAGE_ID, imageRef)],
} as unknown as ScienceProjection

function attachmentHarness(options: { readonly text?: Uint8Array; readonly image?: Uint8Array } = {}) {
  const readText = vi.fn().mockResolvedValue({ ref: textRef, data: options.text ?? Uint8Array.of(1, 2) })
  const readImage = vi.fn().mockResolvedValue({ ref: imageRef, data: options.image ?? Uint8Array.of(3, 4, 5) })
  return { store: { readText, readImage } as unknown as AttachmentStore, readText, readImage }
}

function attachments(options: { readonly text?: Uint8Array; readonly image?: Uint8Array } = {}): AttachmentStore {
  return attachmentHarness(options).store
}

const signal = new AbortController().signal

describe('prepareRunArtifacts', () => {
  it('copies empty requests and reads both attachment families in request order', async () => {
    await expect(prepareRunArtifacts(projection, attachments(), undefined, undefined, 2, 5, signal)).resolves.toEqual({
      inputs: [], materialized: [], editBaselines: new Map(),
    })
    const { store, readText, readImage } = attachmentHarness()
    await expect(prepareRunArtifacts(projection, store, [
      { artifactId: TEXT_ID, version: 1, path: 'text.txt' },
      { artifactId: IMAGE_ID, version: 1, path: 'images/image.png' },
    ], { 'branch.txt': { artifactId: TEXT_ID, version: 1 } }, 2, 5, signal)).resolves.toMatchObject({
      inputs: [
        { artifactId: TEXT_ID, version: 1, path: 'text.txt' },
        { artifactId: IMAGE_ID, version: 1, path: 'images/image.png' },
      ],
      materialized: [
        { path: 'text.txt', data: Uint8Array.of(1, 2) },
        { path: 'images/image.png', data: Uint8Array.of(3, 4, 5) },
      ],
      editBaselines: new Map([['branch.txt', { artifactId: TEXT_ID, version: 1 }]]),
    })
    expect(readText).toHaveBeenCalledOnce()
    expect(readImage).toHaveBeenCalledOnce()
  })

  it.each(['', 'a\\b', 'a\0b', '\ud800', 'a//b', '.', '..', 'a/./b', 'a/../b'])(
    'rejects unsafe input path %j',
    async (path) => {
      await expect(prepareRunArtifacts(projection, attachments(), [
        { artifactId: TEXT_ID, version: 1, path },
      ], undefined, 1, 2, signal)).rejects.toMatchObject({ code: 'INPUT_PATH_INVALID' })
    },
  )

  it.each([
    ['same.txt', 'same.txt'],
    ['Case.txt', 'case.txt'],
    ['e\u0301.txt', '\u00e9.txt'],
    ['data', 'data/file.txt'],
    ['data/file.txt', 'data'],
  ])('rejects colliding input paths %j and %j', async (first, second) => {
    await expect(prepareRunArtifacts(projection, attachments(), [
      { artifactId: TEXT_ID, version: 1, path: first },
      { artifactId: TEXT_ID, version: 1, path: second },
    ], undefined, 2, 4, signal)).rejects.toMatchObject({ code: 'INPUT_PATH_INVALID' })
  })

  it('rejects count, missing-version, declared-byte, and verified-byte excess', async () => {
    await expect(prepareRunArtifacts(projection, attachments(), [
      { artifactId: TEXT_ID, version: 1, path: 'a.txt' },
    ], undefined, 0, 2, signal)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
    await expect(prepareRunArtifacts(projection, attachments(), [
      { artifactId: TEXT_ID, version: 2, path: 'a.txt' },
    ], undefined, 1, 2, signal)).rejects.toMatchObject({ code: 'INPUT_NOT_FOUND' })
    await expect(prepareRunArtifacts(projection, attachments(), [
      { artifactId: TEXT_ID, version: 1, path: 'a.txt' },
    ], undefined, 1, 1, signal)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
    await expect(prepareRunArtifacts(projection, attachments({ text: Uint8Array.of(1, 2, 3) }), [
      { artifactId: TEXT_ID, version: 1, path: 'a.txt' },
    ], undefined, 1, 2, signal)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
  })

  it('rejects unsafe and unresolved edit baselines', async () => {
    await expect(prepareRunArtifacts(projection, attachments(), undefined, {
      '../output.txt': { artifactId: TEXT_ID, version: 1 },
    }, 1, 2, signal)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(prepareRunArtifacts(projection, attachments(), undefined, {
      'output.txt': { artifactId: TEXT_ID, version: 2 },
    }, 1, 2, signal)).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it.each([
    ['Edited.PNG', 'edited.png'],
    ['édited.png', 'édited.png'],
    ['out', 'out/edited.png'],
    ['out/edited.png', 'out'],
  ])('rejects colliding edit baseline paths %j and %j on a case-insensitive filesystem', async (first, second) => {
    await expect(prepareRunArtifacts(projection, attachments(), undefined, {
      [first]: { artifactId: TEXT_ID, version: 1 },
      [second]: { artifactId: TEXT_ID, version: 1 },
    }, 1, 2, signal)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('admits an artifact-input path and an edit-baseline path that share the same literal string', async () => {
    // The two sets materialize into disjoint directories (inputs/ vs the
    // per-run artifact directory), so an identical string in each is not a
    // filesystem collision — only within-set collisions are rejected.
    const { store, readText } = attachmentHarness()
    await expect(prepareRunArtifacts(projection, store, [
      { artifactId: TEXT_ID, version: 1, path: 'shared.txt' },
    ], {
      'shared.txt': { artifactId: TEXT_ID, version: 1 },
    }, 1, 2, signal)).resolves.toMatchObject({
      inputs: [{ artifactId: TEXT_ID, version: 1, path: 'shared.txt' }],
      editBaselines: new Map([['shared.txt', { artifactId: TEXT_ID, version: 1 }]]),
    })
    expect(readText).toHaveBeenCalledOnce()
  })
})
