/**
 * Auto-capture: walk one terminal run's artifact directory and durably save
 * every eligible file as a versioned Science artifact — bytes into the owning
 * project's artifact store, then one `science/artifact-saved` store-reference
 * event — with no model involvement. Hooked from
 * `ScienceRuntime.settlePublishedRun` (index.ts) immediately after each of
 * its two `science/run-finished` append sites.
 */

import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { ProjectArtifactStoreError } from '@deepseek-ai/dsh-science-artifact-store'
import type { ArtifactKind, ScienceArtifactStore, VersionRecord } from '@deepseek-ai/dsh-science-artifact-store'
import { applyScienceEvent, foldScience, projectScienceFold } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceArtifactMediaType,
  ScienceArtifactVersion,
  ScienceArtifactVersionRef,
  ScienceChartState,
  ScienceFoldState,
  ScienceProjectId,
  ScienceRunTerminal,
  ScienceVersionId,
} from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { canonicalWithin } from './scratch.ts'
import { readBoundedFile, walkArtifactFiles } from './artifact-file.ts'

/**
 * Fixed auto-capture extension allowlist, keyed by lower-cased extension.
 * Product scope, not a Loader-exposed knob: no current deployment needs a
 * narrower or wider captured-file type set.
 */
const CAPTURE_MEDIA_TYPE_BY_EXTENSION: ReadonlyMap<string, ScienceArtifactMediaType> = new Map([
  ['.png', 'image/png'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.txt', 'text/plain'],
])

/** Resolve a capture media type from the path's final suffix. */
function captureMediaType(relativePath: string): ScienceArtifactMediaType | undefined {
  const lower = relativePath.toLowerCase()
  return CAPTURE_MEDIA_TYPE_BY_EXTENSION.get(extname(lower))
}

/** Whether a walked relative path is eligible for auto-capture: no dotfile/dot-directory segment, and an allowlisted extension. */
function isCaptureEligible(relativePath: string): boolean {
  if (relativePath.split('/').some(segment => segment.startsWith('.'))) return false
  return captureMediaType(relativePath) !== undefined
}

/**
 * Validated `rasterCapture` Config policy for one run's auto-capture walk.
 * `'declared'` (the default) captures a `.png` only when the run request
 * named it in `rasterArtifacts`; a self-inspection render the model writes
 * for its own QA never becomes a redundant artifact. `'always'`
 * captures every eligible `.png` unconditionally, matching the auto-capture
 * walk's pre-existing behavior for every other accepted extension.
 */
export type RasterCapturePolicy = 'declared' | 'always'

/** Whether one eligible PNG path may be captured under the run's raster-capture policy. */
function isRasterCaptureAllowed(
  relativePath: string,
  mediaType: ScienceArtifactMediaType,
  rasterCapture: RasterCapturePolicy,
  rasterArtifacts: ReadonlySet<string>,
): boolean {
  return mediaType !== 'image/png' || rasterCapture === 'always' || rasterArtifacts.has(relativePath)
}

/**
 * List existing PNG paths admitted by the same rules as auto-capture.
 * @param runArtifacts - canonical run artifact directory.
 * @param rasterCapture - configured PNG capture policy.
 * @param rasterArtifacts - validated declared PNG paths.
 * @returns sorted capture-relative PNG paths eligible for capture.
 */
export async function capturablePngPaths(
  runArtifacts: string,
  rasterCapture: RasterCapturePolicy,
  rasterArtifacts: ReadonlySet<string>,
): Promise<readonly string[]> {
  const walked = (await walkArtifactFiles(runArtifacts)).filter(isCaptureEligible).sort()
  return walked.filter((relativePath) => {
    const mediaType = captureMediaType(relativePath)
    return mediaType === 'image/png'
      && isRasterCaptureAllowed(relativePath, mediaType, rasterCapture, rasterArtifacts)
  })
}

/** Inputs for one terminal run's auto-capture walk. */
export interface CaptureRunArtifactsRequest {
  /** Project artifact store that owns every captured version's bytes and index row. */
  readonly store: ScienceArtifactStore
  /** The session's already-resolved owning project. */
  readonly projectId: ScienceProjectId
  /** Exact live Session that owns the captured versions' events. */
  readonly session: Session
  /** The source run's canonical, already-verified artifact directory. */
  readonly runArtifacts: string
  /** The exact terminal run whose artifact directory is walked; supplies every version's provenance fields. */
  readonly sourceRun: ScienceRunTerminal
  /** Validated exact parent refs keyed by capture-relative output path. */
  readonly editBaselines?: ReadonlyMap<string, ScienceArtifactVersionRef>
  /** Validated Runtime config: this run's raster-capture policy. */
  readonly rasterCapture: RasterCapturePolicy
  /** Validated capture-relative `.png` paths this run declared for capture; consulted only under the `'declared'` policy. */
  readonly rasterArtifacts: ReadonlySet<string>
  /** Validated chart state keyed by capture-relative PNG path. */
  readonly charts?: ReadonlyMap<string, ScienceChartState>
  /** Validated Runtime config bound on one captured file's encoded bytes. */
  readonly captureMaxFileBytes: number
  /** Validated Runtime config bound on eligible files captured from one run. */
  readonly captureMaxFilesPerRun: number
  /** Validated Runtime config bound on artifact versions a session accumulates through auto-capture. */
  readonly captureMaxArtifactVersionsPerSession: number
}

/** Outcome of one auto-capture walk: every version it appended, plus non-silent accounting for what it skipped. */
export interface CaptureRunArtifactsResult {
  /** Versions this walk appended, in capture order. */
  readonly captured: readonly ScienceArtifactVersion[]
  /**
   * Otherwise-eligible `.png` paths left uncaptured under the `'declared'`
   * raster-capture policy because this run did not name them in
   * `rasterArtifacts`. Always empty under `'always'`.
   */
  readonly skippedRasterPaths: readonly string[]
  /** Eligible files skipped for exceeding `captureMaxFileBytes`. */
  readonly skippedOversizedCount: number
  /** Whether more eligible files existed than `captureMaxFilesPerRun` admits; the excess were not attempted. */
  readonly truncatedPerRun: boolean
  /** Whether `captureMaxArtifactVersionsPerSession` was reached before every eligible file was attempted. */
  readonly truncatedPerSession: boolean
  /**
   * Whether a `session.append` rejection (the Session detached, or
   * otherwise refused the append) stopped the walk before every eligible
   * file was attempted.
   */
  readonly appendFailed: boolean
  /** Captured PNG paths that had no valid extracted chart state. */
  readonly chartUnavailablePaths: readonly string[]
}

/**
 * Resolve one capture media type to the store's artifact-kind vocabulary,
 * for a brand-new artifact's `createArtifact` call. Exhaustive over
 * {@link ScienceArtifactMediaType}'s closed set, mirroring the same mapping
 * the store's own v1→v2 migration uses to infer `kind` from legacy data
 * (`schema.ts`'s `inferArtifactKind`).
 */
function artifactKindForMediaType(mediaType: ScienceArtifactMediaType): ArtifactKind {
  switch (mediaType) {
    case 'image/png': return 'figure'
    case 'text/csv': return 'dataset'
    case 'application/json':
    case 'text/markdown':
    case 'text/plain':
      return 'document'
    /* v8 ignore next 2 -- ScienceArtifactMediaType is closed and every member is handled above. */
    default:
      return assertNeverCaptureMediaType(mediaType)
  }
}

/* v8 ignore next 3 -- see assertNeverCaptureMediaType's only caller, above. */
function assertNeverCaptureMediaType(mediaType: never): never {
  throw new Error(`science-runtime: unreachable ScienceArtifactMediaType ${JSON.stringify(mediaType)}`)
}

/**
 * Walk `request.runArtifacts`, admitting every eligible file into the owning
 * project's artifact store as the next version of the logical artifact named
 * by its path relative to that directory, then committing the matching
 * store-reference `science/artifact-saved` event. Content addressing makes
 * admission idempotent: an unchanged file's checksum equals the store's
 * current head version for that logical name, so this walk skips it rather
 * than appending a redundant version. After a direct human edit, a file that
 * still matches the latest run-produced ancestor is also skipped unless this
 * run explicitly names that path in `editBaselines`; this prevents an untouched
 * stale workspace file from reverting the human edit while preserving an
 * intentional model edit or revert — both facts (the head's `sha256` and its
 * `contentOrigin`) are read from the store, the sole authority for a
 * version's provenance, rather than from this session's own local history,
 * which is also what lets a logical name another session already created in
 * this project continue here instead of colliding with the store's
 * `UNIQUE(owningProjectId, logicalName)` constraint. Never throws for an
 * oversized file, a per-run/per-session cap, or a Session that detaches
 * mid-walk — each stops capture early (accounted in the returned result)
 * rather than failing the run that already committed its terminal fact. A
 * store write whose event append is then vetoed is marked `orphan` on the
 * store's own `version_health` row immediately, rather than waiting for a
 * later reconciliation pass.
 * @param request - the source run, its artifact directory, store coordinates, and validated Config bounds.
 * @returns every version appended, plus accounting for what the walk skipped.
 */
export async function captureRunArtifacts(request: CaptureRunArtifactsRequest): Promise<CaptureRunArtifactsResult> {
  const { session, sourceRun, store, projectId } = request
  const walked = (await walkArtifactFiles(request.runArtifacts)).filter(isCaptureEligible).sort()
  const skippedRasterPaths = walked.filter((relativePath) => {
    const mediaType = captureMediaType(relativePath)
    /* v8 ignore next -- isCaptureEligible already required a mapped extension */
    if (mediaType === undefined) return false
    return !isRasterCaptureAllowed(relativePath, mediaType, request.rasterCapture, request.rasterArtifacts)
  })
  const eligible = walked.filter(relativePath => !skippedRasterPaths.includes(relativePath))
  const truncatedPerRun = eligible.length > request.captureMaxFilesPerRun
  const files = eligible.slice(0, request.captureMaxFilesPerRun)

  const captured: ScienceArtifactVersion[] = []
  const chartUnavailablePaths: string[] = []
  let skippedOversizedCount = 0
  let truncatedPerSession = false
  let appendFailed = false
  // Folded once from the complete log, then advanced incrementally per
  // appended `science/artifact-saved` below — replaying the whole log on
  // every one of up to `captureMaxFilesPerRun` iterations would be
  // quadratic in the session's total event count.
  const state: ScienceFoldState = foldScience(session.events)
  // The authorizing run's own turn number, read once from this same fold's
  // tool-call index (`tool/call` facts are unaffected by the Science
  // artifact-event slimming) rather than per file — the authorizing call is
  // fixed for the whole walk.
  const authorizingCall = state.toolCalls.find(call => call.callId === sourceRun.toolCallId)
  /* v8 ignore next 3 -- run-started already validated this toolCallId against a recorded tool/call event in this session */
  if (authorizingCall === undefined) {
    throw new Error('science-runtime: capture could not locate the authorizing run\'s tool/call event')
  }
  const producerTurn = authorizingCall.turn

  // D7: lazily list every artifact this project's store already knows,
  // once per walk, so a logical name this SESSION has never captured before
  // can still continue an artifact a DIFFERENT session already created in
  // the same project, instead of colliding with `createArtifact`'s
  // `UNIQUE(owningProjectId, logicalName)` constraint.
  let projectArtifactIdsByName: ReadonlyMap<string, ScienceArtifactVersion['artifactId']> | undefined
  const projectArtifactIdFor = async (logicalName: string): Promise<ScienceArtifactVersion['artifactId'] | undefined> => {
    if (projectArtifactIdsByName === undefined) {
      const known = await store.listArtifacts(projectId)
      projectArtifactIdsByName = new Map(known.map(candidate => [candidate.logicalName, candidate.artifactId]))
    }
    return projectArtifactIdsByName.get(logicalName)
  }

  for (const relativePath of files) {
    const mediaType = captureMediaType(relativePath)
    /* v8 ignore next -- isCaptureEligible already required a mapped extension */
    if (mediaType === undefined) continue

    const projection = projectScienceFold(state)
    /* v8 ignore next -- capture only ever runs after a durable science/run-finished commit, which requires a bound Science mode */
    if (projection === null) break
    if (projection.artifacts.length >= request.captureMaxArtifactVersionsPerSession) {
      truncatedPerSession = true
      break
    }

    let canonical: string
    try {
      canonical = await canonicalWithin(request.runArtifacts, join(request.runArtifacts, ...relativePath.split('/')))
    } catch {
      // The walk observed this entry, but it no longer resolves under the
      // run's artifact directory (removed, or replaced by a symlink,
      // between the walk and this check) — skip it, not a run failure.
      /* v8 ignore next -- a TOCTOU race, not deterministically reproducible; mirrors the accepted crash-between-commit-and-capture gap */
      continue
    }
    const entry = await lstat(canonical)
    // Re-verify kind defensively: walkArtifactFiles already required a
    // regular non-symlink entry, so only a TOCTOU race changes that before
    // this re-check (same non-reproducible race as the branch above).
    /* v8 ignore next */
    if (!entry.isFile() || entry.isSymbolicLink()) continue
    // A bounded read never pulls more than captureMaxFileBytes + 1 bytes
    // into memory, so an oversized file is caught by its returned length
    // rather than a separate stat-based pre-check (artifact-file.ts).
    const data = await readBoundedFile(canonical, request.captureMaxFileBytes)
    if (data.byteLength > request.captureMaxFileBytes) {
      skippedOversizedCount += 1
      continue
    }
    const sha256 = createHash('sha256').update(data).digest('hex')

    const localKnown = projection.artifacts.filter(candidate => candidate.logicalName === relativePath)
    const localLatest = localKnown.at(-1)
    let artifactId = localLatest?.artifactId ?? await projectArtifactIdFor(relativePath)

    if (artifactId !== undefined) {
      // The store, not this session's own local history, is the sole
      // authority for a version's content_origin and sha256 (T1's authority
      // rule) — both the same-content skip and the human-edit stale-skip
      // below read the store's current head and history rather than
      // `localKnown`, which no longer carries either fact and would also
      // miss a head another session advanced.
      const head = await store.getLatestVersion(projectId, artifactId)
      // An artifactId resolved here (from this session's own fold or D7's
      // listArtifacts lookup) always names a real, already-committed store
      // row, which always has a latest version.
      /* v8 ignore next */
      if (head !== undefined) {
        if (head.sha256 === sha256) continue
        if (head.contentOrigin === 'human-edit' && request.editBaselines?.has(relativePath) !== true) {
          const history = await store.listVersions(projectId, artifactId)
          const latestRunProduced = history.findLast(candidate => candidate.contentOrigin !== 'human-edit')
          if (latestRunProduced?.sha256 === sha256) continue
        }
      }
    }

    const parent = request.editBaselines?.get(relativePath)
    let parentVersionId: ScienceVersionId | undefined
    if (parent !== undefined) {
      const parentVersion = projection.artifacts.find(candidate =>
        candidate.artifactId === parent.artifactId && candidate.version === parent.version)
      /* v8 ignore next 3 -- prepareRunArtifacts validated every baseline against this same projection before the run started */
      if (parentVersion === undefined) {
        throw new Error('science-runtime: capture edit baseline no longer identifies a committed artifact version')
      }
      parentVersionId = parentVersion.versionId
    }

    const chart = mediaType === 'image/png' ? request.charts?.get(relativePath) : undefined
    const figureState = chart === undefined
      ? undefined
      : { figureKey: chart.figureKey, dpi: chart.png.dpi, stateJson: JSON.stringify(chart) }
    const provenance = {
      producerRunId: String(sourceRun.runId),
      producerToolCallId: String(sourceRun.toolCallId),
      producerRequestHeaderSeq: sourceRun.requestHeaderSeq,
      environmentRevision: sourceRun.environmentRevision,
      environmentFingerprint: sourceRun.environmentFingerprint,
      producerTurn,
      ...parentVersionId === undefined ? {} : { baseVersionId: parentVersionId },
      ...figureState === undefined ? {} : { figureState },
    }

    // The store row commits before its session event: the event carries the
    // validated store coordinates as fact (S0's Host-side pre-commit rule).
    let stored: VersionRecord
    if (artifactId !== undefined) {
      stored = await store.appendVersion(projectId, artifactId, { producerSessionId: session.id, data, mediaType, contentOrigin: 'run-auto', ...provenance })
    } else {
      try {
        stored = (await store.createArtifact(projectId, {
          logicalName: relativePath,
          kind: artifactKindForMediaType(mediaType),
          originSessionId: session.id,
          data,
          mediaType,
          contentOrigin: 'run-auto',
          ...provenance,
        })).version
      } catch (error) {
        // A different session raced this same logical name into existence
        // between this walk's D7 lookup and this create call — the store's
        // own UNIQUE(owningProjectId, logicalName) constraint is the true
        // serialization point; re-resolve and append onto the winner rather
        // than failing this file.
        if (!(error instanceof ProjectArtifactStoreError) || error.code !== 'LOGICAL_NAME_CONFLICT') throw error
        const known = await store.listArtifacts(projectId)
        const winner = known.find(candidate => candidate.logicalName === relativePath)
        /* v8 ignore next 3 -- the conflict error itself proves a row with this logicalName now exists */
        if (winner === undefined) throw error
        artifactId = winner.artifactId
        stored = await store.appendVersion(projectId, artifactId, { producerSessionId: session.id, data, mediaType, contentOrigin: 'run-auto', ...provenance })
      }
    }

    const title = basename(relativePath)
    await store.annotateVersion(projectId, stored.versionId, { actor: 'capture', sessionId: session.id, title })

    const artifact: ScienceArtifactVersion = {
      artifactId: stored.artifactId,
      logicalName: relativePath,
      // New content always opens the next version; the store's per-artifact
      // ordinal is that version number, so the log and the index agree.
      version: stored.ordinal,
      title,
      projectId,
      versionId: stored.versionId,
      sha256: stored.sha256,
      seenAt: Date.now(),
    }
    let appended
    try {
      appended = session.append('science/artifact-saved', { version: 1, artifact })
    } catch {
      // The Session detached (or otherwise refused the append) between the
      // walk starting and this file's commit: remaining eligible files in
      // this run stay uncaptured with no automatic retry, and the store row
      // just written is marked orphan immediately rather than left for a
      // later reconciliation pass to discover. `appendFailed` on the
      // returned result is this fact's only signal to the caller
      // (`ScienceRuntime.captureAfterFinish`, which logs it).
      appendFailed = true
      try {
        await store.setVersionHealth(projectId, stored.versionId, { orphan: true })
      } catch {
        // The append already failed for this file; a health-marking failure
        // on top of it leaves the row for the next reconciliation pass
        // instead of compounding this walk's error.
      }
      break
    }
    // Advances `state` for the next iteration's `projectScienceFold` read;
    // `append()`'s own returned event is exactly the next contiguous
    // `nextSeq` this fold needs, since nothing else appends to this Session
    // between iterations of one synchronous walk.
    applyScienceEvent(state, appended)
    captured.push(artifact)
    if (mediaType === 'image/png' && figureState === undefined) chartUnavailablePaths.push(relativePath)
  }

  return {
    captured,
    skippedRasterPaths,
    skippedOversizedCount,
    truncatedPerRun,
    truncatedPerSession,
    appendFailed,
    chartUnavailablePaths,
  }
}
