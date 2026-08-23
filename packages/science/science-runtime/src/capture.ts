/**
 * Auto-capture: walk one terminal run's artifact directory and durably save
 * every eligible file as a versioned Science artifact, with no model
 * involvement. Hooked from `ScienceRuntime.settlePublishedRun` (index.ts)
 * immediately after each of its two `science/run-finished` append sites.
 */

import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, TextMediaType } from '@deepseek-ai/dsh-attachment'
import { applyScienceEvent, foldScience, projectScienceFold, scienceRunsShareTurn, ScienceArtifactId } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceArtifactVersion,
  ScienceArtifactVersionRef,
  ScienceFoldState,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { canonicalWithin } from './scratch.ts'
import { readBoundedFile, walkArtifactFiles } from './artifact-file.ts'

/**
 * Fixed auto-capture extension allowlist, keyed by lower-cased extension.
 * Product scope, not a Loader-exposed knob (mirrors the precedent that
 * `ImageAttachmentLimits.mediaTypes` is a frozen constant): no current
 * deployment needs a narrower or wider captured-file type set.
 */
const CAPTURE_MEDIA_TYPE_BY_EXTENSION: ReadonlyMap<string, 'image/png' | TextMediaType> = new Map([
  ['.png', 'image/png'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.txt', 'text/plain'],
])

const VEGA_LITE_EXTENSION = '.vl.json'

/** Resolve a capture media type, preserving the two-part Vega-Lite suffix before the ordinary last-suffix lookup. */
function captureMediaType(relativePath: string): 'image/png' | TextMediaType | undefined {
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
  /** Attachment service that admits and durably stores captured bytes. */
  readonly attachments: AttachmentStore
  /** Exact live Session that owns the captured versions. */
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
  /** Eligible files skipped for exceeding `captureMaxFileBytes` (by this Runtime's cap or the attachment store's own admission cap). */
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

/**
 * Walk `request.runArtifacts`, admitting every eligible file as the next
 * version of the logical artifact named by its path relative to that
 * directory. Content-addressed storage makes admission idempotent: an
 * unchanged file's freshly admitted reference compares equal to the latest
 * committed version's own opaque reference, so this walk skips it rather
 * than appending a redundant version. After a direct human edit, a file that
 * still matches the latest run-produced ancestor is also skipped unless this
 * run explicitly names that path in `editBaselines`; this prevents an untouched
 * stale workspace file from reverting the human edit while preserving an
 * intentional model edit or revert. Never throws for an oversized file,
 * a per-run/per-session cap, or a Session that detaches mid-walk — each
 * stops capture early (accounted in the returned result) rather than
 * failing the run that already committed its terminal fact.
 * @param request - the source run, its artifact directory, and validated Config bounds.
 * @returns every version appended, plus accounting for what the walk skipped.
 */
export async function captureRunArtifacts(request: CaptureRunArtifactsRequest): Promise<CaptureRunArtifactsResult> {
  const { session, sourceRun } = request
  const eligible = (await walkArtifactFiles(request.runArtifacts)).filter(isCaptureEligible).sort()
  const truncatedPerRun = eligible.length > request.captureMaxFilesPerRun
  const files = eligible.slice(0, request.captureMaxFilesPerRun)

  const captured: ScienceArtifactVersion[] = []
  let skippedOversizedCount = 0
  let truncatedPerSession = false
  let appendFailed = false
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

    const isImage = mediaType === 'image/png'
    if (isImage && !request.attachments.imageLimits.mediaTypes.includes('image/png')) continue
    if (!isImage && !request.attachments.textLimits.mediaTypes.includes(mediaType)) continue

    let attachment
    try {
      // Captured images are scientific evidence: verbatim admission stores
      // the run's exact bytes, so a later read-back compares byte-identical
      // to what the run wrote (the store's default route normalizes — strips
      // metadata, may re-encode or downscale — which breaks that contract).
      attachment = isImage
        ? await request.attachments.saveImage({ data, mediaType: 'image/png', name: basename(relativePath), normalization: 'verbatim' })
        : await request.attachments.saveText({ data, mediaType, name: basename(relativePath) })
    } catch (error) {
      // The deployment's own image/text byte cap can be narrower than this
      // Runtime's captureMaxFileBytes; treat that admission rejection the
      // same as an oversized file rather than failing the run.
      if (error instanceof AttachmentError) {
        skippedOversizedCount += 1
        continue
      }
      throw error
    }

    const logical = projection.artifacts.filter(candidate => candidate.logicalName === relativePath)
    const latest = logical.at(-1)
    if (latest !== undefined && latest.attachment.attachmentId === attachment.attachmentId) continue
    if (latest?.origin === 'human-edit' && request.editBaselines?.has(relativePath) !== true) {
      const latestRunProduced = logical.findLast(candidate => candidate.origin !== 'human-edit')
      if (latestRunProduced?.attachment.attachmentId === attachment.attachmentId) continue
    }
    let version = 1
    if (latest !== undefined) {
      if (latest.origin === 'human-edit') {
        version = latest.version + 1
      } else {
        const latestSource = state.runs.find(candidate => candidate.runId === latest.runId)
        /* v8 ignore next -- strict fold admits every run-produced artifact only after its source run. */
        if (latestSource === undefined) {
          throw new Error('science-runtime: latest artifact source run is missing from its strict fold')
        }
        version = scienceRunsShareTurn(state, sourceRun, latestSource) ? latest.version : latest.version + 1
      }
    }

    const parent = request.editBaselines?.get(relativePath)
    // An edit result opens a new version descending from its named baseline;
    // superseding the baseline itself would self-parent the committed
    // version (its own `parent` naming its own `{artifactId, version}`),
    // which the strict fold's C3 self-parent check rejects on every later
    // replay. This collides only when the baseline names the very version
    // the same-turn supersede rule above just computed — an ordinary
    // same-turn rewrite with no baseline, or a baseline older than the
    // version being superseded, both still supersede unchanged.
    if (latest !== undefined && parent !== undefined && parent.artifactId === latest.artifactId && parent.version === version) {
      version = latest.version + 1
    }
    const artifact: ScienceArtifactVersion = {
      artifactId: latest?.artifactId ?? ScienceArtifactId(randomUUID()),
      logicalName: relativePath,
      // A version is what one request turn produced: rewriting the same file
      // while still answering the tool-call turn that produced it supersedes that
      // version rather than opening another one, so the reader's version list
      // holds results rather than the run-to-run iteration behind them.
      version,
      ...(parent === undefined ? {} : { parent }),
      title: basename(relativePath),
      origin: 'auto',
      attachment,
      runId: sourceRun.runId,
      toolCallId: sourceRun.toolCallId,
      requestHeaderSeq: sourceRun.requestHeaderSeq,
      environmentRevision: sourceRun.environmentRevision,
      environmentFingerprint: sourceRun.environmentFingerprint,
      createdAt: Date.now(),
    }
    let appended
    try {
      appended = session.append('science/artifact-saved', { version: 1, artifact })
    } catch {
      // The Session detached (or otherwise refused the append) between the
      // walk starting and this file's commit: remaining eligible files in
      // this run stay uncaptured with no automatic retry, symmetric to the
      // crash-between-commit-and-capture gap this Runtime already accepts.
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
