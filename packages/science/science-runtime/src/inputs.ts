/** Artifact-version input and edit-baseline preparation for unpublished runs. */

import type { ScienceArtifactStore } from '@deepseek-ai/dsh-science-artifact-store'
import type {
  ScienceArtifactVersion,
  ScienceArtifactVersionRef,
  ScienceProjectId,
  ScienceProjection,
  ScienceRunArtifactInput,
} from '@deepseek-ai/dsh-science-session'
import { ScienceRuntimeError } from './types.ts'
import type { ScienceRunInputBytes } from './scratch.ts'

/** Prepared immutable request values retained through execution and capture. */
export interface PreparedRunArtifacts {
  /** Complete durable input mapping in request order. */
  readonly inputs: readonly ScienceRunArtifactInput[]
  /** Verified attachment bytes paired with the same paths. */
  readonly materialized: readonly ScienceRunInputBytes[]
  /** Validated capture-path baselines retained until the post-run walk. */
  readonly editBaselines: ReadonlyMap<string, ScienceArtifactVersionRef>
}

/**
 * Require one forward-slash relative file path. Empty, dot,
 * parent, backslash, NUL, and malformed-Unicode segments are rejected.
 * @param path - Caller-supplied input or capture-relative path.
 * @param subject - Caller-facing noun used in the stable error message.
 * @param code - Stable path-error classification for this request surface.
 * @returns The unchanged path after validation.
 */
function safeRelativePath(
  path: string,
  subject: string,
  code: 'INPUT_PATH_INVALID' | 'INVALID_REQUEST',
): string {
  const segments = path.split('/')
  if (path.length === 0 || path.includes('\\') || path.includes('\0') || !path.isWellFormed()
    || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new ScienceRuntimeError(code, `${subject} must be a forward-slash relative file path`)
  }
  return path
}

/**
 * Reject exact, case-folded, ancestor, and descendant path collisions within
 * one caller-supplied path set. Case-folded so a case-insensitive filesystem
 * (the materialization target for both `artifact_inputs` and `edit_of`
 * paths) cannot admit two paths that would land on the same on-disk entry.
 * @param paths - Candidate paths already validated by `safeRelativePath`.
 * @param code - Stable classification for the collision this set represents.
 * @param message - Safe caller-facing explanation naming the colliding set.
 */
function assertNoPathCollisions(
  paths: readonly string[],
  code: 'INPUT_PATH_INVALID' | 'INVALID_REQUEST',
  message: string,
): void {
  const folded = paths.map(path => path.normalize('NFC').toLocaleLowerCase('en-US'))
  for (const [index, candidate] of folded.entries()) {
    for (const existing of folded.slice(0, index)) {
      if (candidate === existing || candidate.startsWith(`${existing}/`) || existing.startsWith(`${candidate}/`)) {
        throw new ScienceRuntimeError(code, message)
      }
    }
  }
}

/** Resolve an exact committed version from the live strict projection. */
function artifactVersion(
  projection: ScienceProjection,
  ref: ScienceArtifactVersionRef,
  code: 'INPUT_NOT_FOUND' | 'ARTIFACT_NOT_FOUND',
  subject: string,
): ScienceArtifactVersion {
  const artifact = projection.artifacts.find(candidate =>
    candidate.artifactId === ref.artifactId && candidate.version === ref.version)
  if (artifact === undefined) {
    throw new ScienceRuntimeError(
      code,
      `${subject} ${JSON.stringify(ref.artifactId)}@${String(ref.version)} does not identify a committed artifact version`,
    )
  }
  return artifact
}

/**
 * Validate, resolve, and read every run input before publication, and copy
 * edit-baseline refs so caller mutation cannot alter post-run attribution.
 * @param projection - Current strict Science projection for the exact Session.
 * @param store - Project artifact store used for verified content-addressed reads.
 * @param projectId - The session's already-resolved owning project.
 * @param requestedInputs - Caller-supplied exact versions and destination paths.
 * @param requestedBaselines - Caller-supplied capture paths and exact parents.
 * @param maxFiles - Configured per-run input count bound.
 * @param maxBytes - Configured per-run aggregate input byte bound.
 * @param signal - Fused operation cancellation and timeout signal.
 * @returns Durable input refs, verified bytes, and retained edit baselines.
 */
export async function prepareRunArtifacts(
  projection: ScienceProjection,
  store: ScienceArtifactStore,
  projectId: ScienceProjectId,
  requestedInputs: readonly ScienceRunArtifactInput[] | undefined,
  requestedBaselines: Readonly<Record<string, ScienceArtifactVersionRef>> | undefined,
  maxFiles: number,
  maxBytes: number,
  signal: AbortSignal,
): Promise<PreparedRunArtifacts> {
  const inputs = (requestedInputs ?? []).map(input => ({
    artifactId: input.artifactId,
    version: input.version,
    path: safeRelativePath(input.path, 'Science artifact input path', 'INPUT_PATH_INVALID'),
  }))
  if (inputs.length > maxFiles) {
    throw new ScienceRuntimeError('INPUT_TOO_LARGE', `Science artifact inputs exceed the configured ${String(maxFiles)}-file bound`)
  }
  assertNoPathCollisions(
    inputs.map(input => input.path),
    'INPUT_PATH_INVALID',
    'Science artifact input paths collide inside the reserved inputs directory',
  )

  const resolved = inputs.map(input => ({
    input,
    artifact: artifactVersion(projection, input, 'INPUT_NOT_FOUND', 'Science artifact input'),
  }))
  const declaredBytes = resolved.reduce((sum, entry) => sum + entry.artifact.byteCount, 0)
  if (declaredBytes > maxBytes) {
    throw new ScienceRuntimeError('INPUT_TOO_LARGE', `Science artifact inputs exceed the configured ${String(maxBytes)}-byte bound`)
  }

  const materialized: ScienceRunInputBytes[] = []
  let actualBytes = 0
  for (const entry of resolved) {
    signal.throwIfAborted()
    const data = await store.readBlob(projectId, entry.artifact.sha256)
    actualBytes += data.byteLength
    if (actualBytes > maxBytes) {
      throw new ScienceRuntimeError('INPUT_TOO_LARGE', `Science artifact inputs exceed the configured ${String(maxBytes)}-byte bound`)
    }
    materialized.push({ path: entry.input.path, data })
  }

  const baselines = Object.entries(requestedBaselines ?? {}).map(([rawPath, ref]) => ({
    path: safeRelativePath(rawPath, 'Science edit baseline path', 'INVALID_REQUEST'),
    ref,
  }))
  assertNoPathCollisions(
    baselines.map(baseline => baseline.path),
    'INVALID_REQUEST',
    'Science edit baseline paths collide under the reserved artifact directory',
  )
  const editBaselines = new Map<string, ScienceArtifactVersionRef>()
  for (const { path, ref } of baselines) {
    artifactVersion(projection, ref, 'ARTIFACT_NOT_FOUND', 'Science edit baseline')
    editBaselines.set(path, { artifactId: ref.artifactId, version: ref.version })
  }
  return { inputs, materialized, editBaselines }
}
