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
import type { ArtifactId, ArtifactRecord, ScienceArtifactStore } from '@deepseek-ai/dsh-science-artifact-store'
import { applyScienceEvent, foldScience, projectScienceFold } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceArtifactMediaType,
  ScienceArtifactVersion,
  ScienceArtifactVersionRef,
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

const VEGA_LITE_EXTENSION = '.vl.json'

/** Resolve a capture media type, preserving the two-part Vega-Lite suffix before the ordinary last-suffix lookup. */
function captureMediaType(relativePath: string): ScienceArtifactMediaType | undefined {
  const lower = relativePath.toLowerCase()
  if (lower.endsWith(VEGA_LITE_EXTENSION)) return 'application/vnd.vega-lite+json'
  return CAPTURE_MEDIA_TYPE_BY_EXTENSION.get(extname(lower))
}

/** Whether a walked relative path is eligible for auto-capture: no dotfile/dot-directory segment, and an allowlisted extension. */
function isCaptureEligible(relativePath: string): boolean {
  if (relativePath.split('/').some(segment => segment.startsWith('.'))) return false
  return captureMediaType(relativePath) !== undefined
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
}

/** Twelve-character preview the store records beside a full binding fingerprint. */
function fingerprintPreview(fingerprint: string): string {
  return fingerprint.slice(0, 12)
}

/**
 * Walk `request.runArtifacts`, admitting every eligible file into the owning
 * project's artifact store as the next version of the logical artifact named
 * by its path relative to that directory, then committing the matching
 * store-reference `science/artifact-saved` event. Content addressing makes
 * admission idempotent: an unchanged file's checksum equals the latest
 * committed version's own `sha256`, so this walk skips it rather than
 * appending a redundant version. After a direct human edit, a file that
 * still matches the latest run-produced ancestor is also skipped unless this
 * run explicitly names that path in `editBaselines`; this prevents an untouched
 * stale workspace file from reverting the human edit while preserving an
 * intentional model edit or revert. Never throws for an oversized file,
 * a per-run/per-session cap, or a Session that detaches mid-walk — each
 * stops capture early (accounted in the returned result) rather than
 * failing the run that already committed its terminal fact. A store write
 * whose event append is then vetoed leaves an orphaned store version with no
 * session reference — accepted provenance decay, symmetric to the
 * crash-between-commit-and-capture gap this Runtime already accepts.
 * @param request - the source run, its artifact directory, store coordinates, and validated Config bounds.
 * @returns every version appended, plus accounting for what the walk skipped.
 */
export async function captureRunArtifacts(request: CaptureRunArtifactsRequest): Promise<CaptureRunArtifactsResult> {
  const { session, sourceRun, store, projectId } = request
  const eligible = (await walkArtifactFiles(request.runArtifacts)).filter(isCaptureEligible).sort()
  const truncatedPerRun = eligible.length > request.captureMaxFilesPerRun
  const files = eligible.slice(0, request.captureMaxFilesPerRun)

  const captured: ScienceArtifactVersion[] = []
  let skippedOversizedCount = 0
  let truncatedPerSession = false
  let appendFailed = false
  // Populated lazily, at most once per walk, only when a file's logicalName
  // has no local record: this session's own fold already answers "does an
  // artifact for this logicalName exist" for every file a prior run of THIS
  // session captured, so most walks never need it. When needed, it is the
  // project store's authoritative view of every artifact in the project —
  // including ones a DIFFERENT session created (S3 cross-session
  // continuation) — which this session's own fold cannot see.
  let projectArtifacts: readonly ArtifactRecord[] | undefined
  // Folded once from the complete log, then advanced incrementally per
  // appended `science/artifact-saved` below — replaying the whole log on
  // every one of up to `captureMaxFilesPerRun` iterations would be
  // quadratic in the session's total event count.
  const state: ScienceFoldState = foldScience(session.events)

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

    const logical = projection.artifacts.filter(candidate => candidate.logicalName === relativePath)
    const latest = logical.at(-1)
    if (latest !== undefined && latest.sha256 === sha256) continue
    if (latest?.origin === 'human-edit' && request.editBaselines?.has(relativePath) !== true) {
      const latestRunProduced = logical.findLast(candidate => candidate.origin !== 'human-edit')
      if (latestRunProduced?.sha256 === sha256) continue
    }

    // This session's own fold has no local record of this logicalName: a
    // different session in the same project may already own it (S3
    // cross-session continuation). Check the project store — the
    // authoritative project-wide index this session's own fold cannot see —
    // before deciding to create a brand-new artifact; otherwise a second
    // session capturing the same-named output would fork a duplicate
    // artifactId instead of extending the one the project already has.
    let crossSessionArtifactId: ArtifactId | undefined
    if (latest === undefined) {
      projectArtifacts ??= await store.listArtifacts(projectId)
      const existing = projectArtifacts.find(candidate => candidate.logicalName === relativePath)
      if (existing !== undefined) {
        const existingLatest = await store.getVersion(projectId, existing.latestVersionId)
        if (existingLatest !== undefined && existingLatest.sha256 === sha256) continue
        crossSessionArtifactId = existing.artifactId
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

    const provenance = {
      producerRunId: String(sourceRun.runId),
      producerToolCallId: String(sourceRun.toolCallId),
      producerRequestHeaderSeq: sourceRun.requestHeaderSeq,
      environmentRevision: String(sourceRun.environmentRevision),
      environmentFingerprintPreview: fingerprintPreview(sourceRun.environmentFingerprint),
    }
    const title = basename(relativePath)
    const artifactId = latest?.artifactId ?? crossSessionArtifactId
    // The store row commits before its session event: the event carries the
    // validated store coordinates as fact (S0's Host-side pre-commit rule).
    const stored = artifactId === undefined
      ? (await store.createArtifact(projectId, {
        logicalName: relativePath,
        originSessionId: session.id,
        data,
        mediaType,
        origin: 'auto',
        title,
        ...provenance,
      })).version
      : await store.appendVersion(projectId, artifactId, {
        producerSessionId: session.id,
        data,
        mediaType,
        origin: 'auto',
        title,
        ...parentVersionId === undefined ? {} : { editBaselines: parentVersionId },
        ...provenance,
      })

    const artifact: ScienceArtifactVersion = {
      artifactId: stored.artifactId,
      producerSessionId: stored.producerSessionId,
      logicalName: relativePath,
      // New content always opens the next version; the store's per-artifact
      // ordinal is that version number, so the log and the index agree.
      version: stored.ordinal,
      ...(parent === undefined ? {} : { parent }),
      title,
      origin: 'auto',
      projectId,
      versionId: stored.versionId,
      sha256: stored.sha256,
      mediaType,
      byteCount: stored.byteCount,
      runId: sourceRun.runId,
      toolCallId: sourceRun.toolCallId,
      requestHeaderSeq: sourceRun.requestHeaderSeq,
      environmentRevision: sourceRun.environmentRevision,
      environmentFingerprint: sourceRun.environmentFingerprint,
      createdAt: stored.createdAt,
    }
    let appended
    try {
      appended = session.append('science/artifact-saved', { version: 1, artifact })
    } catch {
      // The Session detached (or otherwise refused the append) between the
      // walk starting and this file's commit: remaining eligible files in
      // this run stay uncaptured with no automatic retry, and the store row
      // just written stays as an orphaned version no event references.
      // `appendFailed` on the returned result is this fact's only signal —
      // the caller (`ScienceRuntime.captureAfterFinish`) logs it.
      appendFailed = true
      break
    }
    // Advances `state` for the next iteration's `projectScienceFold` read;
    // `append()`'s own returned event is exactly the next contiguous
    // `nextSeq` this fold needs, since nothing else appends to this Session
    // between iterations of one synchronous walk.
    applyScienceEvent(state, appended)
    captured.push(artifact)
  }

  return { captured, skippedOversizedCount, truncatedPerRun, truncatedPerSession, appendFailed }
}
