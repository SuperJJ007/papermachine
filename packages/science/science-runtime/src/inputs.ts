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
  /** Validated capture-relative `.png` paths declared for capture, retained until the post-run walk. */
  readonly rasterArtifacts: ReadonlySet<string>
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
  code: 'ARTIFACT_NOT_FOUND',
  subject: string,
): ScienceArtifactVersion {
  const artifact = projection.artifacts.find(candidate =>
    candidate.artifactId === ref.artifactId && candidate.version === ref.version)
  if (artifact === undefined) {
    throw new ScienceRuntimeError(
      code,
      `${subject} ${JSON.stringify(ref.artifactId)}@${String(ref.version)} does not identify a committed artifact version (artifactId must be the UUID from the capture receipt, not the file name)`,
    )
  }
  return artifact
}

/**
 * The field a run input actually needs from its resolved artifact version,
 * whichever authority resolved it. `byteCount` is store-only now (T1's
 * authority rule — the session projection no longer carries it), so the
 * aggregate bound below is enforced solely from bytes actually read rather
 * than a declared-length pre-check.
 */
interface ResolvedRunInputVersion {
  readonly sha256: string
}

/**
 * Resolve one run input's exact committed version, falling back to the
 * project store when this session's own live strict projection has never
 * recorded the referenced artifactId at all. An artifactId this session's
 * own fold already knows (at some version) is resolved from that
 * projection only — same-session references need no store round trip and
 * the projection is already the authority for them. An artifactId the
 * projection has never recorded is a legitimate cross-session reference
 * (S3): a second session in the same project reading an artifact a
 * different session produced. This is the sole point that reference is
 * verified — the store's own transactions are what actually prove it real
 * — before the referencing `science/run-started` event commits; the
 * committed event then carries the reference as fact, which
 * `science-session`'s fold trusts on pure replay without reaching the store
 * (see `transition.ts`'s `requireRunInputArtifactVersion`).
 * @param projection - the requesting session's own live strict projection.
 * @param store - project artifact store used for the cross-session fallback.
 * @param projectId - the session's already-resolved owning project.
 * @param ref - the caller-supplied artifactId/version reference.
 * @param subject - caller-facing noun used in the stable error message.
 * @returns the resolved version's content digest.
 */
async function resolveInputArtifactVersion(
  projection: ScienceProjection,
  store: ScienceArtifactStore,
  projectId: ScienceProjectId,
  ref: ScienceArtifactVersionRef,
  subject: string,
): Promise<ResolvedRunInputVersion> {
  const local = projection.artifacts.find(candidate =>
    candidate.artifactId === ref.artifactId && candidate.version === ref.version)
  if (local !== undefined) return local
  const versions = await store.listVersions(projectId, ref.artifactId)
  const stored = versions.find(candidate => candidate.ordinal === ref.version)
  if (stored === undefined) {
    throw new ScienceRuntimeError(
      'INPUT_NOT_FOUND',
      `${subject} ${JSON.stringify(ref.artifactId)}@${String(ref.version)} does not identify a committed artifact version (artifactId must be the UUID from the capture receipt, not the file name)`,
    )
  }
  return stored
}

/**
 * Validate, resolve, and read every run input before publication, and copy
 * edit-baseline refs so caller mutation cannot alter post-run attribution.
 * @param projection - Current strict Science projection for the exact Session.
 * @param store - Project artifact store used for verified content-addressed reads.
 * @param projectId - The session's already-resolved owning project.
 * @param requestedInputs - Caller-supplied exact versions and destination paths.
 * @param requestedBaselines - Caller-supplied capture paths and exact parents.
 * @param requestedRasterArtifacts - Caller-supplied capture-relative `.png` paths to admit under the `'declared'` raster-capture policy.
 * @param maxFiles - Configured per-run input count bound.
 * @param maxBytes - Configured per-run aggregate input byte bound.
 * @param signal - Fused operation cancellation and timeout signal.
 * @returns Durable input refs, verified bytes, retained edit baselines, and the declared raster-artifact path set.
 */
export async function prepareRunArtifacts(
  projection: ScienceProjection,
  store: ScienceArtifactStore,
  projectId: ScienceProjectId,
  requestedInputs: readonly ScienceRunArtifactInput[] | undefined,
  requestedBaselines: Readonly<Record<string, ScienceArtifactVersionRef>> | undefined,
  requestedRasterArtifacts: readonly string[] | undefined,
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

  const resolved = await Promise.all(inputs.map(async input => ({
    input,
    artifact: await resolveInputArtifactVersion(projection, store, projectId, input, 'Science artifact input'),
  })))

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
  // Edit baselines stay resolved from this session's own live projection
  // only, unlike run inputs above: a cross-session baseline would also need
  // `science-session`'s fold to accept an unresolved `parent` reference on
  // replay (`transition.ts`'s `applyArtifactSaved`), which stays strict —
  // out of scope for this slice (S3 covers artifact_inputs, not editBaselines
  // lineage across sessions).
  const editBaselines = new Map<string, ScienceArtifactVersionRef>()
  for (const { path, ref } of baselines) {
    artifactVersion(projection, ref, 'ARTIFACT_NOT_FOUND', 'Science edit baseline')
    editBaselines.set(path, { artifactId: ref.artifactId, version: ref.version })
  }

  // Naming an unrelated (non-`.png`) or nonexistent path here is harmless —
  // capture.ts only ever consults this set for an eligible `.png` file — so
  // this validates path safety only, the same rule inputs and edit
  // baselines already enforce, without requiring the path to exist or end
  // in `.png`.
  const rasterArtifacts = new Set(
    (requestedRasterArtifacts ?? []).map(path => safeRelativePath(path, 'Science raster artifact path', 'INVALID_REQUEST')),
  )
  return { inputs, materialized, editBaselines, rasterArtifacts }
}
