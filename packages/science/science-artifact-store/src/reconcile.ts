/**
 * Store ↔ session reconciliation: compare the store's own version rows
 * against the `science/artifact-saved` events a caller has already read from
 * that project's session logs, and repair the store — never the session
 * log — to match. This package never reads session logs itself; a caller
 * (`dsh-science-runtime`) reads them, folds duplicate events per
 * `versionId` (last write wins), and passes the result in as `events`.
 * @module @deepseek-ai/dsh-science-artifact-store/reconcile
 */

import { extname } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ArtifactId, ProjectId, VersionId } from './ids.ts'
import { inferArtifactKind } from './schema.ts'
import type { ProjectArtifactStoreEngine } from './store.ts'
import type { VersionRecord } from './types.ts'

/**
 * The fallback fields a `science/artifact-saved` event carries, after a
 * caller has folded a session log's events per `versionId` (last write wins)
 * — see the package README's Reconciliation section for the full six-case
 * table this classifies against. `producerSessionId` is not itself an event
 * field (T2a's slimming removed content provenance from the event
 * entirely); it is the id of the session whose log the event was read from,
 * which the caller supplies since only it walked that log.
 */
export interface ReconcileArtifactSavedEvent {
  readonly artifactId: ArtifactId
  readonly versionId: VersionId
  /** The event's own `version` field — the store's per-artifact ordinal. */
  readonly ordinal: number
  readonly logicalName: string
  readonly sha256: string
  readonly title: string | null
  readonly caption: string | null
  /** The event's own `seenAt` (or, for a legacy log, its `createdAt` fallback). */
  readonly seenAt: number
  readonly producerSessionId: SessionId
}

/**
 * One version's classification against its (possibly absent) session-log
 * event. `'orphan'` and `'content-conflict'` both mean "no session event
 * currently affirms these exact bytes"; `'metadata-diverged'` means the
 * bytes agree but the event's presentation snapshot is stale, which is
 * expected and requires no repair (the store's latest annotation already is
 * the current fact). A dangling event (an event with no matching store row
 * at all) is not a `ReconcileVersionKind` — it never reaches `classifyVersion`,
 * since there is no `VersionRecord` to classify; see `reconcileProject`'s own
 * dangling-event pass.
 */
export type ReconcileVersionKind = 'consistent' | 'orphan' | 'content-conflict' | 'metadata-diverged'

/**
 * Classify one store version row against its (possibly absent) session-log
 * event. Pure and side-effect-free — `reconcileProject` is the only caller
 * that turns a classification into a store write.
 * @param version - the store's own row for this version.
 * @param event - the folded session-log event for the same `versionId`, when one exists.
 * @returns the classification.
 */
export function classifyVersion(version: VersionRecord, event: ReconcileArtifactSavedEvent | undefined): ReconcileVersionKind {
  if (event === undefined) return 'orphan'
  if (event.sha256 !== version.sha256) return 'content-conflict'
  const titleMatches = event.title === (version.title ?? null)
  const captionMatches = event.caption === (version.caption ?? null)
  return titleMatches && captionMatches ? 'consistent' : 'metadata-diverged'
}

/**
 * Fixed extension → media-type map used only to reconstruct a dangling
 * event's `mediaType`, since T2a's event slimming removed `mediaType` from
 * `science/artifact-saved` entirely and this is the closest remaining fact.
 * Mirrors `dsh-science-runtime`'s auto-capture extension allowlist;
 * duplicated rather than imported because this package is a dependency OF
 * `dsh-science-runtime`, never the reverse.
 */
const RECONSTRUCT_MEDIA_TYPE_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.txt', 'text/plain'],
])

/**
 * Infer a media type from a dangling event's `logicalName` extension. An
 * unrecognized extension falls back to `application/octet-stream`, honestly
 * naming that this reconstruction could not identify the content, rather
 * than guessing one of the five known types.
 */
function inferMediaTypeFromLogicalName(logicalName: string): string {
  return RECONSTRUCT_MEDIA_TYPE_BY_EXTENSION.get(extname(logicalName.toLowerCase())) ?? 'application/octet-stream'
}

/** Bounds one `reconcileProject` call's work. */
export interface ReconcileOptions {
  /**
   * Upper bound on how many of the project's existing version rows this
   * call checks, and how many dangling events (events with no matching
   * store row) it reconstructs, combined. A project with more outstanding
   * work than this reports `truncated: true`; the caller schedules a
   * further call to make progress on the remainder — reconciliation is
   * idempotent, so repeating an already-checked version is harmless.
   */
  readonly maxVersions: number
}

/** One version's reconciliation outcome, for diagnostics and tests. */
export interface ReconcileOutcome {
  readonly versionId: VersionId
  readonly kind: ReconcileVersionKind
}

/** Result of one `reconcileProject` call. Never thrown for a single bad item — see `errors`. */
export interface ReconcileResult {
  /** Existing store version rows this call classified. */
  readonly checkedVersions: number
  readonly outcomes: readonly ReconcileOutcome[]
  /** Dangling events this call successfully reconstructed into new store rows. */
  readonly reconstructed: readonly VersionId[]
  /**
   * `true` when this project had more outstanding work (existing versions
   * plus dangling events) than `options.maxVersions` admitted this call;
   * only a bounded prefix was processed.
   */
  readonly truncated: boolean
  /**
   * One diagnostic per item this call could not fully reconcile (a content
   * conflict, a health-write failure, or a reconstruction failure) — never
   * thrown, so one bad item never stops the rest of the batch.
   */
  readonly errors: readonly string[]
}

/**
 * Reconcile one project's store against its already-read, already-folded
 * session-log events: mark orphan/content-conflict rows, reconstruct
 * dangling events into new store rows, and refresh every checked row's
 * `missingContent` flag against the blob directory. Writes only through the
 * store's own public methods (`setVersionHealth`, `reconstructVersion`) —
 * this function never touches SQLite directly and never writes a session
 * log. Idempotent: running it again over an unchanged store and event set
 * produces the same `version_health` state, since every write recomputes
 * from the current comparison rather than accumulating.
 * @param engine - the project artifact store engine to read and repair.
 * @param projectId - the project to reconcile.
 * @param events - every `science/artifact-saved` event the caller read from
 * this project's session logs, folded per `versionId` (last write wins), keyed by `versionId`.
 * @param options - validated work bounds.
 * @returns what this call checked, reconstructed, and could not fully reconcile.
 */
export async function reconcileProject(
  engine: ProjectArtifactStoreEngine,
  projectId: ProjectId,
  events: ReadonlyMap<VersionId, ReconcileArtifactSavedEvent>,
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const artifacts = await engine.listArtifacts(projectId)
  const versionLists = await Promise.all(artifacts.map(artifact => engine.listVersions(projectId, artifact.artifactId)))
  const versions = versionLists.flat()
  const knownVersionIds = new Set(versions.map(version => version.versionId))

  const versionsTruncated = versions.length > options.maxVersions
  const batch = versions.slice(0, options.maxVersions)
  const remainingBudget = Math.max(0, options.maxVersions - batch.length)

  const danglingEvents = [...events.values()].filter(event => !knownVersionIds.has(event.versionId))
  const danglingTruncated = danglingEvents.length > remainingBudget
  const danglingBatch = danglingEvents.slice(0, remainingBudget)

  const outcomes: ReconcileOutcome[] = []
  const errors: string[] = []

  for (const version of batch) {
    const event = events.get(version.versionId)
    const kind = classifyVersion(version, event)
    outcomes.push({ versionId: version.versionId, kind })
    if (kind === 'content-conflict') {
      // classifyVersion returns 'content-conflict' only on its own
      // `event.sha256 !== version.sha256` branch, which requires `event` defined.
      /* v8 ignore next */
      const eventSha256 = event?.sha256 ?? ''
      errors.push(
        `version "${version.versionId}": store sha256 ${version.sha256} does not match its session-log event's `
        + `sha256 ${eventSha256} for the same versionId`,
      )
    }
    const orphan = kind === 'orphan' || kind === 'content-conflict'
    let byteCount: number | undefined
    try {
      byteCount = await engine.blobByteCount(projectId, version.sha256)
    } catch (error) {
      errors.push(`version "${version.versionId}": blob existence check failed: ${String(error)}`)
      continue
    }
    try {
      await engine.setVersionHealth(projectId, version.versionId, { orphan, missingContent: byteCount === undefined })
    } catch (error) {
      errors.push(`version "${version.versionId}": failed to record reconciliation health: ${String(error)}`)
    }
  }

  const reconstructed: VersionId[] = []
  for (const event of danglingBatch) {
    try {
      const mediaType = inferMediaTypeFromLogicalName(event.logicalName)
      const byteCount = await engine.blobByteCount(projectId, event.sha256)
      await engine.reconstructVersion(projectId, {
        versionId: event.versionId,
        artifactId: event.artifactId,
        logicalName: event.logicalName,
        kind: inferArtifactKind(mediaType),
        ordinal: event.ordinal,
        sha256: event.sha256,
        mediaType,
        byteCount: byteCount ?? 0,
        producerSessionId: event.producerSessionId,
        createdAt: event.seenAt,
        title: event.title,
        caption: event.caption,
      })
      await engine.setVersionHealth(projectId, event.versionId, { reconstructed: true, missingContent: byteCount === undefined })
      reconstructed.push(event.versionId)
    } catch (error) {
      errors.push(`dangling event for version "${event.versionId}": reconstruction failed: ${String(error)}`)
    }
  }

  return {
    checkedVersions: batch.length,
    outcomes,
    reconstructed,
    truncated: versionsTruncated || danglingTruncated,
    errors,
  }
}
