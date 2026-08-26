/** Focused pre-publication validation for artifact inputs and edit baselines. */

import { describe, expect, it, vi } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ScienceArtifactStore } from '@deepseek-ai/dsh-science-artifact-store'
import { ScienceArtifactId, ScienceProjectId, ScienceRunId, ScienceVersionId } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactMediaType, ScienceArtifactVersion, ScienceProjection } from '@deepseek-ai/dsh-science-session'
import { prepareRunArtifacts } from '../src/inputs.ts'

const PROJECT_ID = ScienceProjectId('inputs-project')
const TEXT_ID = ScienceArtifactId('text-artifact')
const IMAGE_ID = ScienceArtifactId('image-artifact')
const STYLE_ID = ScienceArtifactId('style-artifact')
const TEXT_SHA = '1'.repeat(64)
const IMAGE_SHA = '2'.repeat(64)
const STYLE_SHA = '3'.repeat(64)

function artifact(
  artifactId: ReturnType<typeof ScienceArtifactId>,
  logicalName: string,
  mediaType: ScienceArtifactMediaType,
  sha256: string,
  byteCount: number,
): ScienceArtifactVersion {
  return {
    artifactId,
    logicalName,
    version: 1,
    title: logicalName,
    origin: 'auto',
    projectId: PROJECT_ID,
    versionId: ScienceVersionId(`${logicalName}-v1`),
    sha256,
    mediaType,
    byteCount,
    runId: ScienceRunId('source-run'),
    toolCallId: CallId('source-call'),
    requestHeaderSeq: 1,
    environmentRevision: 1,
    environmentFingerprint: 'fingerprint',
    createdAt: 1,
  }
}

const projection = {
  artifacts: [
    artifact(TEXT_ID, 'text.txt', 'text/plain', TEXT_SHA, 2),
    artifact(IMAGE_ID, 'image.png', 'image/png', IMAGE_SHA, 3),
    artifact(STYLE_ID, 'style.vl.json', 'application/vnd.vega-lite+json', STYLE_SHA, 2),
    {
      artifactId: STYLE_ID,
      logicalName: 'style.vl.json',
      version: 2,
      parent: { artifactId: STYLE_ID, version: 1 },
      title: 'style.vl.json',
      origin: 'human-edit',
      projectId: PROJECT_ID,
      versionId: ScienceVersionId('style.vl.json-v2'),
      sha256: '4'.repeat(64),
      mediaType: 'application/vnd.vega-lite+json',
      byteCount: 2,
      environmentRevision: 1,
      environmentFingerprint: 'fingerprint',
      createdAt: 2,
    },
  ],
} as unknown as ScienceProjection

function storeHarness(blobs: Readonly<Record<string, Uint8Array>> = {}) {
  const readBlob = vi.fn(async (_projectId: unknown, sha256: string) => {
    const data = blobs[sha256]
    if (data !== undefined) return data
    if (sha256 === TEXT_SHA) return Uint8Array.of(1, 2)
    if (sha256 === IMAGE_SHA) return Uint8Array.of(3, 4, 5)
    return Uint8Array.of(9, 9)
  })
  return { store: { readBlob } as unknown as ScienceArtifactStore, readBlob }
}

function store(blobs: Readonly<Record<string, Uint8Array>> = {}): ScienceArtifactStore {
  return storeHarness(blobs).store
}

const signal = new AbortController().signal

describe('prepareRunArtifacts', () => {
  it('copies empty requests and reads every input from the project store in request order', async () => {
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, undefined, undefined, 2, 5, signal)).resolves.toEqual({
      inputs: [], materialized: [], editBaselines: new Map(),
    })
    const { store: reads, readBlob } = storeHarness()
    await expect(prepareRunArtifacts(projection, reads, PROJECT_ID, [
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
    expect(readBlob).toHaveBeenNthCalledWith(1, PROJECT_ID, TEXT_SHA)
    expect(readBlob).toHaveBeenNthCalledWith(2, PROJECT_ID, IMAGE_SHA)
  })

  it('admits a human-edited version as both an artifact input and an edit baseline', async () => {
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, [
      { artifactId: STYLE_ID, version: 2, path: 'source.vl.json' },
    ], {
      'result.vl.json': { artifactId: STYLE_ID, version: 2 },
    }, 1, 2, signal)).resolves.toMatchObject({
      inputs: [{ artifactId: STYLE_ID, version: 2, path: 'source.vl.json' }],
      editBaselines: new Map([['result.vl.json', { artifactId: STYLE_ID, version: 2 }]]),
    })
  })

  it.each(['', 'a\\b', 'a\0b', '\ud800', 'a//b', '.', '..', 'a/./b', 'a/../b'])(
    'rejects unsafe input path %j',
    async (path) => {
      await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, [
        { artifactId: TEXT_ID, version: 1, path },
      ], undefined, 1, 2, signal)).rejects.toMatchObject({ code: 'INPUT_PATH_INVALID' })
    },
  )

  it.each([
    ['same.txt', 'same.txt'],
    ['Case.txt', 'case.txt'],
    ['é.txt', 'é.txt'],
    ['data', 'data/file.txt'],
    ['data/file.txt', 'data'],
  ])('rejects colliding input paths %j and %j', async (first, second) => {
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, [
      { artifactId: TEXT_ID, version: 1, path: first },
      { artifactId: TEXT_ID, version: 1, path: second },
    ], undefined, 2, 4, signal)).rejects.toMatchObject({ code: 'INPUT_PATH_INVALID' })
  })

  it('rejects count, missing-version, declared-byte, and verified-byte excess', async () => {
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, [
      { artifactId: TEXT_ID, version: 1, path: 'a.txt' },
    ], undefined, 0, 2, signal)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, [
      { artifactId: TEXT_ID, version: 2, path: 'a.txt' },
    ], undefined, 1, 2, signal)).rejects.toMatchObject({ code: 'INPUT_NOT_FOUND' })
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, [
      { artifactId: TEXT_ID, version: 1, path: 'a.txt' },
    ], undefined, 1, 1, signal)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
    await expect(prepareRunArtifacts(projection, store({ [TEXT_SHA]: Uint8Array.of(1, 2, 3) }), PROJECT_ID, [
      { artifactId: TEXT_ID, version: 1, path: 'a.txt' },
    ], undefined, 1, 2, signal)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
  })

  it('rejects unsafe and unresolved edit baselines', async () => {
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, undefined, {
      '../output.txt': { artifactId: TEXT_ID, version: 1 },
    }, 1, 2, signal)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, undefined, {
      'output.txt': { artifactId: TEXT_ID, version: 2 },
    }, 1, 2, signal)).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it.each([
    ['Edited.PNG', 'edited.png'],
    ['e\u0301dited.png', '\u00e9dited.png'],
    ['out', 'out/edited.png'],
    ['out/edited.png', 'out'],
  ])('rejects colliding edit baseline paths %j and %j on a case-insensitive filesystem', async (first, second) => {
    await expect(prepareRunArtifacts(projection, store(), PROJECT_ID, undefined, {
      [first]: { artifactId: TEXT_ID, version: 1 },
      [second]: { artifactId: TEXT_ID, version: 1 },
    }, 1, 2, signal)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('admits an artifact-input path and an edit-baseline path that share the same literal string', async () => {
    // The two sets materialize into disjoint directories (inputs/ vs the
    // per-run artifact directory), so an identical string in each is not a
    // filesystem collision — only within-set collisions are rejected.
    const { store: reads, readBlob } = storeHarness()
    await expect(prepareRunArtifacts(projection, reads, PROJECT_ID, [
      { artifactId: TEXT_ID, version: 1, path: 'shared.txt' },
    ], {
      'shared.txt': { artifactId: TEXT_ID, version: 1 },
    }, 1, 2, signal)).resolves.toMatchObject({
      inputs: [{ artifactId: TEXT_ID, version: 1, path: 'shared.txt' }],
      editBaselines: new Map([['shared.txt', { artifactId: TEXT_ID, version: 1 }]]),
    })
    expect(readBlob).toHaveBeenCalledOnce()
  })
})
