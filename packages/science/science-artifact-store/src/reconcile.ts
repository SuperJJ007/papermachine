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
 * — see the package README's Reconciliation section for the full seven-case
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
 * event. `'orphan'` and `'content-conflict'` both mean "no complete session
 * event set currently affirms these exact bytes"; `'unverified'` means the
 * event set is incomplete and therefore cannot prove an absent event;
 * `'metadata-diverged'` means the bytes agree but the event's presentation
 * snapshot is stale, which is expected and requires no repair (the store's
 * latest annotation already is the current fact). A dangling event (an event
 * with no matching store row at all) is not a `ReconcileVersionKind` — it
 * never reaches `classifyVersion`, since there is no `VersionRecord` to
 * classify; see `reconcileProject`'s own dangling-event pass.
 */
export type ReconcileVersionKind = 'consistent' | 'unverified' | 'orphan' | 'content-conflict' | 'metadata-diverged'

/**
 * Classify one store version row against its (possibly absent) session-log
 * event. Pure and side-effect-free — `reconcileProject` is the only caller
 * that turns a classification into a store write.
 * @param version - the store's own row for this version.
 * @param event - the folded session-log event for the same `versionId`, when one exists.
 * @param eventSetComplete - whether the caller read every relevant session log and event.
 * @returns the classification.
 */
export function classifyVersion(
  version: VersionRecord,
  event: ReconcileArtifactSavedEvent | undefined,
  eventSetComplete: boolean,
): ReconcileVersionKind {
  if (event === undefined) return eventSetComplete ? 'orphan' : 'unverified'
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
  /** Whether the caller read every relevant session log and event. */
  readonly eventSetComplete: boolean
  /**
   * Upper bound on how many of the project's existing version rows this
   * call checks, and how many dangling events (events with no matching
   * store row) it reconstructs, combined. A project with more outstanding
   * work than this reports `truncated: true`; the caller schedules a
   * further call to make progress on the remainder — reconciliation is
   * idempotent, so repeating an already-checked version is harmless.
   */
  readonly maxVersions: number
  /** Prior bounded-walk progress for this project and stable event set. */
  readonly cursor?: ReconcileCursor
}

/** One pending unit in a bounded reconciliation walk. */
export type ReconcileWorkItem =
  | { readonly kind: 'version'; readonly versionId: VersionId }
  | { readonly kind: 'dangling'; readonly versionId: VersionId }

/** Restart-local progress across bounded calls over one stable event set. */
export interface ReconcileCursor {
  /** Work still to attempt; failed items rotate behind untouched items. */
  readonly pending: readonly ReconcileWorkItem[]
  /** Store versions whose health write completed in this walk. */
  readonly completedVersionIds: readonly VersionId[]
  /** Dangling events reconstructed and health-marked in this walk. */
  readonly completedDanglingEventIds: readonly VersionId[]
}

/** Reject a newly added classification until its health-write semantics are explicit. */
/* v8 ignore next 3 -- the closed ReconcileVersionKind union makes this runtime arm unreachable */
function assertNeverClassification(kind: never): never {
  throw new Error(`science-artifact-store: unsupported reconciliation classification ${JSON.stringify(kind)}`)
}

/** Reject a newly added work-item kind until its processing semantics are explicit. */
/* v8 ignore next 3 -- the closed ReconcileWorkItem union makes this runtime arm unreachable */
function assertNeverWorkItem(item: never): never {
  throw new Error(`science-artifact-store: unsupported reconciliation work item ${JSON.stringify(item)}`)
}

/** The orphan patch for one classification; `undefined` preserves the existing flag. */
function orphanForClassification(kind: ReconcileVersionKind): boolean | undefined {
  switch (kind) {
    case 'consistent':
    case 'metadata-diverged':
      return false
    case 'orphan':
    case 'content-conflict':
      return true
    case 'unverified':
      return undefined
    /* v8 ignore next -- the closed ReconcileVersionKind union makes this arm unreachable */
    default:
      return assertNeverClassification(kind)
  }
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
   * `true` while the returned cursor retains version or dangling-event work
   * for a later bounded call.
   */
  readonly truncated: boolean
  /**
   * One diagnostic per item this call could not fully reconcile (a content
   * conflict, a health-write failure, or a reconstruction failure) — never
   * thrown, so one bad item never stops the rest of the batch.
   */
  readonly errors: readonly string[]
  /** Progress for the next bounded call; omitted when no work remains. */
  readonly cursor?: ReconcileCursor
}

/** Read the current store rows in the public deterministic artifact/version order. */
async function listProjectVersions(
  engine: ProjectArtifactStoreEngine,
  projectId: ProjectId,
): Promise<readonly VersionRecord[]> {
  const artifacts = await engine.listArtifacts(projectId)
  const versionLists = await Promise.all(artifacts.map(artifact => engine.listVersions(projectId, artifact.artifactId)))
  return versionLists.flat()
}

/** Refresh pending work against the current store and stable event set. */
function refreshPendingWork(
  pending: readonly ReconcileWorkItem[],
  versions: ReadonlyMap<VersionId, VersionRecord>,
  events: ReadonlyMap<VersionId, ReconcileArtifactSavedEvent>,
  completedVersionIds: ReadonlySet<VersionId>,
  completedDanglingEventIds: ReadonlySet<VersionId>,
): ReconcileWorkItem[] {
  const danglingIds = new Set([...events.keys()].filter(versionId => !versions.has(versionId)))
  const refreshed = pending.filter((item) => {
    switch (item.kind) {
      case 'version': return versions.has(item.versionId) && !completedVersionIds.has(item.versionId)
      case 'dangling': return danglingIds.has(item.versionId) && !completedDanglingEventIds.has(item.versionId)
      /* v8 ignore next -- the closed ReconcileWorkItem union makes this arm unreachable */
      default:
        return assertNeverWorkItem(item)
    }
  })
  const queued = new Set(refreshed.map(item => `${item.kind}:${String(item.versionId)}`))
  for (const versionId of versions.keys()) {
    const key = `version:${String(versionId)}`
    if (!completedVersionIds.has(versionId) && !queued.has(key)) {
      refreshed.push({ kind: 'version', versionId })
      queued.add(key)
    }
  }
  for (const versionId of danglingIds) {
    const key = `dangling:${String(versionId)}`
    if (!completedDanglingEventIds.has(versionId) && !queued.has(key)) refreshed.push({ kind: 'dangling', versionId })
  }
  return refreshed
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
 * @param options - event-set completeness and validated work bounds.
 * @returns what this call checked, reconstructed, and could not fully reconcile.
 */
export async function reconcileProject(
  engine: ProjectArtifactStoreEngine,
  projectId: ProjectId,
  events: ReadonlyMap<VersionId, ReconcileArtifactSavedEvent>,
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const versions = await listProjectVersions(engine, projectId)
  const versionsById = new Map(versions.map(version => [version.versionId, version]))
  const completedVersionIds = new Set(options.cursor?.completedVersionIds ?? [])
  const completedDanglingEventIds = new Set(options.cursor?.completedDanglingEventIds ?? [])
  const pending = refreshPendingWork(
    options.cursor?.pending ?? [], versionsById, events, completedVersionIds, completedDanglingEventIds,
  )
  const batch = pending.slice(0, options.maxVersions)
  const remaining = pending.slice(options.maxVersions)
  const failed: ReconcileWorkItem[] = []
  const outcomes: ReconcileOutcome[] = []
  const errors: string[] = []
  const reconstructed: VersionId[] = []
  for (const item of batch) {
    switch (item.kind) {
      case 'version': {
        const version = versionsById.get(item.versionId)
        /* v8 ignore next 4 -- refreshPendingWork admits only current version ids */
        if (version === undefined) {
          completedVersionIds.add(item.versionId)
          break
        }
        const event = events.get(version.versionId)
        const kind = classifyVersion(version, event, options.eventSetComplete)
        outcomes.push({ versionId: version.versionId, kind })
        if (kind === 'content-conflict') {
          // classifyVersion requires an event before returning content-conflict.
          /* v8 ignore next */
          const eventSha256 = event?.sha256 ?? ''
          errors.push(
            `version "${version.versionId}": store sha256 ${version.sha256} does not match its session-log event's `
            + `sha256 ${eventSha256} for the same versionId`,
          )
        }
        const orphan = orphanForClassification(kind)
        let byteCount: number | undefined
        try {
          byteCount = await engine.blobByteCount(projectId, version.sha256)
        } catch (error) {
          errors.push(`version "${version.versionId}": blob existence check failed: ${String(error)}`)
          failed.push(item)
          break
        }
        try {
          await engine.setVersionHealth(projectId, version.versionId, {
            ...(orphan === undefined ? {} : { orphan }),
            missingContent: byteCount === undefined,
          })
          completedVersionIds.add(version.versionId)
        } catch (error) {
          errors.push(`version "${version.versionId}": failed to record reconciliation health: ${String(error)}`)
          failed.push(item)
        }
        break
      }
      case 'dangling': {
        const event = events.get(item.versionId)
        /* v8 ignore next 4 -- refreshPendingWork admits only current dangling event ids */
        if (event === undefined) {
          completedDanglingEventIds.add(item.versionId)
          break
        }
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
          completedDanglingEventIds.add(event.versionId)
          completedVersionIds.add(event.versionId)
        } catch (error) {
          errors.push(`dangling event for version "${event.versionId}": reconstruction failed: ${String(error)}`)
          failed.push(item)
        }
        break
      }
      /* v8 ignore next -- the closed ReconcileWorkItem union makes this arm unreachable */
      default:
        assertNeverWorkItem(item)
    }
  }

  let nextPending = [...remaining, ...failed]
  if (nextPending.length === 0) {
    const refreshedVersions = await listProjectVersions(engine, projectId)
    nextPending = refreshPendingWork(
      [], new Map(refreshedVersions.map(version => [version.versionId, version])), events,
      completedVersionIds, completedDanglingEventIds,
    )
  }
  const cursor: ReconcileCursor | undefined = nextPending.length === 0
    ? undefined
    : {
      pending: nextPending,
      completedVersionIds: [...completedVersionIds],
      completedDanglingEventIds: [...completedDanglingEventIds],
    }

  return {
    checkedVersions: outcomes.length,
    outcomes,
    reconstructed,
    truncated: cursor !== undefined,
    errors,
    ...(cursor === undefined ? {} : { cursor }),
  }
}
