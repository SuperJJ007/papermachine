/**
 * Store ↔ session reconciliation trigger: collect one project's
 * `science/artifact-saved` events from its own session logs — the only
 * place in this Runtime that reads a durable session log outside its own
 * live Session — and fold them per `versionId` (last write wins) for
 * `dsh-science-artifact-store`'s `reconcileProject`. This package never
 * touches SQLite or the blob directory directly; it only reads session logs
 * and hands the result to the store's own algorithm.
 * @module @deepseek-ai/dsh-science-runtime/reconcile-trigger
 */

import { resolve } from 'node:path'
import { ArtifactId, VersionId, type ReconcileArtifactSavedEvent } from '@deepseek-ai/dsh-science-artifact-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionPersistence, SessionPersistenceRevision, SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-science-session'

/** Inputs for one project's `collectProjectArtifactEvents` walk. */
export interface CollectProjectArtifactEventsRequest {
  /**
   * Backend-agnostic durable session store — reads raw, undecoded events
   * (bypassing `dsh-science-session`'s codec) so a retired field the
   * store's fallback fields need is not silently stripped.
   */
  readonly sessionPersistence: SessionPersistence
  /**
   * The project's canonical workspace path, from `OpenedProject.workspacePath`
   * — session headers are matched against this by `resolve()`d equality.
   */
  readonly workspacePath: string
  /** Validated `reconcileMaxSessions` Config bound: at most this many matching session logs are read in one call. */
  readonly maxSessions: number
  /** Prior bounded-walk progress for this project, when a later attempt continues it. */
  readonly cursor?: CollectProjectArtifactEventsCursor
  /** Diagnostic sink for a skipped unreadable session log or malformed event — never fails the walk. */
  readonly onWarning?: (message: string) => void
}

/** Result of one `collectProjectArtifactEvents` walk. */
export interface CollectProjectArtifactEventsResult {
  /**
   * Every `science/artifact-saved` event found, folded per `versionId`
   * (last write wins across every scanned session, in the order
   * `SessionPersistence.listSnapshots()` returned them).
   */
  readonly events: ReadonlyMap<VersionId, ReconcileArtifactSavedEvent>
  /** `true` only when listing, every admitted session read, and every relevant event parse succeeded without truncation. */
  readonly complete: boolean
  /** `true` when more unvisited sessions remain after this call's bounded batch. */
  readonly truncated: boolean
  /** Updated progress, retained by the Runtime until reconciliation settles. */
  readonly cursor?: CollectProjectArtifactEventsCursor
  /** Whether the accumulated event set changed during this call. */
  readonly changed: boolean
}

/** Restart-local progress for one project's bounded session-log walk. */
export interface CollectProjectArtifactEventsCursor {
  /** Current matching-session order from `SessionPersistence.listSnapshots()`. */
  readonly sessionOrder: readonly SessionId[]
  /** Unread, previously unreadable, or grown-since-cached sessions, in next-attempt order. */
  readonly pendingSessionIds: readonly SessionId[]
  /** Fully parsed events retained per session so retries preserve list order. */
  readonly eventsBySession: ReadonlyMap<SessionId, readonly ReconcileArtifactSavedEvent[]>
  /**
   * Per-session `SessionPersistenceSnapshot.revision` recorded when that
   * session's `eventsBySession` entry was read. A session whose live
   * revision no longer matches is dropped from the cache and re-queued
   * instead of trusted stale, so an append to an already-inspected session
   * between attempts is not missed by a later complete pass.
   */
  readonly revisionsBySession: ReadonlyMap<SessionId, SessionPersistenceRevision>
}

/** The subset of a raw, undecoded `science/artifact-saved` event's `artifact` value this extractor needs. */
interface RawArtifactValue {
  readonly artifactId?: unknown
  readonly versionId?: unknown
  readonly version?: unknown
  readonly logicalName?: unknown
  readonly sha256?: unknown
  readonly title?: unknown
  readonly caption?: unknown
  readonly seenAt?: unknown
  /** Legacy content-commit timestamp; a read-compatibility fallback for `seenAt` only, mirroring `dsh-science-session`'s own codec. */
  readonly createdAt?: unknown
}

/**
 * Extract a `ReconcileArtifactSavedEvent` from one raw, undecoded
 * `science/artifact-saved` event value — a durable/file boundary, so every
 * field is checked rather than trusted from the static `SessionEventMap`
 * type (which reflects this build's current codec, not what an
 * undecoded read of an arbitrary on-disk log actually contains).
 * @param rawData - the event's raw `data` field, as `SessionPersistence.inspect()` returned it.
 * @param producerSessionId - the id of the session whose log this event was read from.
 * @returns the extracted event, or `undefined` when the value is not a well-formed `science/artifact-saved` payload.
 */
function extractReconcileEvent(rawData: unknown, producerSessionId: SessionId): ReconcileArtifactSavedEvent | undefined {
  if (typeof rawData !== 'object' || rawData === null) return undefined
  const artifact = (rawData as Record<string, unknown>)['artifact']
  if (typeof artifact !== 'object' || artifact === null) return undefined
  const value = artifact as RawArtifactValue
  if (
    typeof value.artifactId !== 'string' || typeof value.versionId !== 'string' || typeof value.version !== 'number'
    || typeof value.logicalName !== 'string' || typeof value.sha256 !== 'string'
  ) return undefined
  const seenAt = typeof value.seenAt === 'number' ? value.seenAt : typeof value.createdAt === 'number' ? value.createdAt : undefined
  if (seenAt === undefined) return undefined
  return {
    artifactId: ArtifactId(value.artifactId),
    versionId: VersionId(value.versionId),
    ordinal: value.version,
    logicalName: value.logicalName,
    sha256: value.sha256,
    title: typeof value.title === 'string' ? value.title : null,
    caption: typeof value.caption === 'string' ? value.caption : null,
    seenAt,
    producerSessionId,
  }
}

/** Whether a session header's `cwd` names the same workspace this project was opened against. */
function headerNamesWorkspace(header: SessionHeader, workspacePath: string): boolean {
  return header.cwd !== undefined && resolve(header.cwd) === workspacePath
}

/** Fold fully parsed per-session events in the persistence listing order. */
function foldSessionEvents(cursor: CollectProjectArtifactEventsCursor | undefined): ReadonlyMap<VersionId, ReconcileArtifactSavedEvent> {
  const events = new Map<VersionId, ReconcileArtifactSavedEvent>()
  if (cursor === undefined) return events
  for (const sessionId of cursor.sessionOrder) {
    for (const event of cursor.eventsBySession.get(sessionId) ?? []) events.set(event.versionId, event)
  }
  return events
}

/** Compare two ordered Session-id lists without hiding a persistence reorder. */
function sameSessionOrder(left: readonly SessionId[], right: readonly SessionId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** Compare retained event values so an unchanged malformed retry does not reset store progress. */
function sameSessionEvents(
  left: readonly ReconcileArtifactSavedEvent[] | undefined,
  right: readonly ReconcileArtifactSavedEvent[],
): boolean {
  return left !== undefined && left.length === right.length && left.every((event, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && event.artifactId === candidate.artifactId
      && event.versionId === candidate.versionId
      && event.ordinal === candidate.ordinal
      && event.logicalName === candidate.logicalName
      && event.sha256 === candidate.sha256
      && event.title === candidate.title
      && event.caption === candidate.caption
      && event.seenAt === candidate.seenAt
      && event.producerSessionId === candidate.producerSessionId
  })
}

/**
 * Collect every `science/artifact-saved` event from this project's own
 * session logs (every session whose header `cwd` resolves to the project's
 * canonical workspace path), folded per `versionId` (last write wins).
 * Never throws: a session log that fails to list or read is skipped with a
 * warning, and a malformed event within an otherwise-readable log is
 * skipped the same way — one bad log or event never stops the walk. A
 * session already cached from an earlier attempt is trusted only while its
 * `SessionPersistence.listSnapshots()` revision is unchanged; a session
 * whose log grew or was rewritten since it was cached is re-queued instead,
 * so `complete: true` always reflects the live state of every matching
 * session, not a stale earlier read of one still-active session.
 * @param request - the persistence backend, project workspace, and validated work bound.
 * @returns the folded events, their completeness, and whether more matching sessions existed than `maxSessions` admitted.
 */
export async function collectProjectArtifactEvents(
  request: CollectProjectArtifactEventsRequest,
): Promise<CollectProjectArtifactEventsResult> {
  let snapshots: readonly SessionPersistenceSnapshot[]
  try {
    snapshots = await request.sessionPersistence.listSnapshots()
  } catch (error) {
    request.onWarning?.(`science-runtime: reconciliation could not list session logs: ${String(error)}`)
    return {
      events: foldSessionEvents(request.cursor), complete: false, truncated: false,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }), changed: false,
    }
  }

  const matching = snapshots.filter(snapshot => headerNamesWorkspace(snapshot.header, request.workspacePath))
  const sessionOrder = matching.map(snapshot => snapshot.header.id)
  const matchingIds = new Set(sessionOrder)
  const liveRevisionBySessionId = new Map(matching.map(snapshot => [snapshot.header.id, snapshot.revision]))

  const eventsBySession = new Map<SessionId, readonly ReconcileArtifactSavedEvent[]>()
  for (const [sessionId, cachedEvents] of request.cursor?.eventsBySession ?? []) {
    if (!matchingIds.has(sessionId)) continue
    const cachedRevision = request.cursor?.revisionsBySession.get(sessionId)
    const liveRevision = liveRevisionBySessionId.get(sessionId)
    if (cachedRevision !== undefined && liveRevision !== undefined && cachedRevision === liveRevision) {
      eventsBySession.set(sessionId, cachedEvents)
    }
  }
  const revisionsBySession = new Map(
    [...(request.cursor?.revisionsBySession ?? [])].filter(([sessionId]) => eventsBySession.has(sessionId)),
  )
  const retainedPending = (request.cursor?.pendingSessionIds ?? []).filter(sessionId => matchingIds.has(sessionId))
  const queued = new Set(retainedPending)
  const pending = [...retainedPending]
  for (const sessionId of sessionOrder) {
    if (queued.has(sessionId)) continue
    queued.add(sessionId)
    if (!eventsBySession.has(sessionId)) pending.push(sessionId)
  }
  const batchIds = pending.slice(0, request.maxSessions)
  const remaining = pending.slice(request.maxSessions)
  const failed: SessionId[] = []
  let changed = !sameSessionOrder(request.cursor?.sessionOrder ?? [], sessionOrder)
    || eventsBySession.size !== (request.cursor?.eventsBySession.size ?? 0)

  for (const sessionId of batchIds) {
    let inspection: Awaited<ReturnType<SessionPersistence['inspect']>>
    try {
      inspection = await request.sessionPersistence.inspect(sessionId)
    } catch (error) {
      request.onWarning?.(`science-runtime: reconciliation skipped an unreadable session log "${sessionId}": ${String(error)}`)
      failed.push(sessionId)
      continue
    }
    const sessionEvents: ReconcileArtifactSavedEvent[] = []
    let valid = true
    for (const event of inspection.events) {
      if (event.type !== 'science/artifact-saved') continue
      const extracted = extractReconcileEvent(event.data, sessionId)
      if (extracted === undefined) {
        request.onWarning?.(`science-runtime: reconciliation skipped a malformed science/artifact-saved event in session "${sessionId}"`)
        valid = false
        continue
      }
      sessionEvents.push(extracted)
    }
    // batchIds is drawn from pending, itself a subset of sessionOrder / matchingIds, so a
    // revision snapshot for this session was always collected into liveRevisionBySessionId above.
    // oxlint-disable-next-line typescript/no-non-null-assertion -- see the invariant above
    const liveRevision = liveRevisionBySessionId.get(sessionId)!
    changed ||= !sameSessionEvents(eventsBySession.get(sessionId), sessionEvents)
    eventsBySession.set(sessionId, sessionEvents)
    revisionsBySession.set(sessionId, liveRevision)
    if (!valid) failed.push(sessionId)
  }
  const pendingSessionIds = [...remaining, ...failed]
  const cursor: CollectProjectArtifactEventsCursor = { sessionOrder, pendingSessionIds, eventsBySession, revisionsBySession }
  return {
    events: foldSessionEvents(cursor), complete: pendingSessionIds.length === 0,
    truncated: remaining.length > 0, cursor, changed,
  }
}
