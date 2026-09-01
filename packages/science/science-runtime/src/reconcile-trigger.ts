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
import type { SessionHeader, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
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
  /** Diagnostic sink for a skipped unreadable session log or malformed event — never fails the walk. */
  readonly onWarning?: (message: string) => void
}

/** Result of one `collectProjectArtifactEvents` walk. */
export interface CollectProjectArtifactEventsResult {
  /**
   * Every `science/artifact-saved` event found, folded per `versionId`
   * (last write wins across every scanned session, in the order
   * `SessionPersistence.list()` returned them).
   */
  readonly events: ReadonlyMap<VersionId, ReconcileArtifactSavedEvent>
  /** `true` when more sessions matched this project's workspace than `maxSessions` admitted; only a bounded prefix was read. */
  readonly truncated: boolean
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

/**
 * Collect every `science/artifact-saved` event from this project's own
 * session logs (every session whose header `cwd` resolves to the project's
 * canonical workspace path), folded per `versionId` (last write wins).
 * Never throws: a session log that fails to list or read is skipped with a
 * warning, and a malformed event within an otherwise-readable log is
 * skipped the same way — one bad log or event never stops the walk.
 * @param request - the persistence backend, project workspace, and validated work bound.
 * @returns the folded events and whether more matching sessions existed than `maxSessions` admitted.
 */
export async function collectProjectArtifactEvents(
  request: CollectProjectArtifactEventsRequest,
): Promise<CollectProjectArtifactEventsResult> {
  let headers: readonly SessionHeader[]
  try {
    headers = await request.sessionPersistence.list()
  } catch (error) {
    request.onWarning?.(`science-runtime: reconciliation could not list session logs: ${String(error)}`)
    return { events: new Map(), truncated: false }
  }

  const matching = headers.filter(header => headerNamesWorkspace(header, request.workspacePath))
  const truncated = matching.length > request.maxSessions
  const batch = matching.slice(0, request.maxSessions)

  const events = new Map<VersionId, ReconcileArtifactSavedEvent>()
  for (const header of batch) {
    let inspection: Awaited<ReturnType<SessionPersistence['inspect']>>
    try {
      inspection = await request.sessionPersistence.inspect(header.id)
    } catch (error) {
      request.onWarning?.(`science-runtime: reconciliation skipped an unreadable session log "${header.id}": ${String(error)}`)
      continue
    }
    for (const event of inspection.events) {
      if (event.type !== 'science/artifact-saved') continue
      const extracted = extractReconcileEvent(event.data, header.id)
      if (extracted === undefined) {
        request.onWarning?.(`science-runtime: reconciliation skipped a malformed science/artifact-saved event in session "${header.id}"`)
        continue
      }
      // Folded per versionId, last write wins: a curated re-record (same
      // versionId/sha256, updated title/caption) legitimately advances
      // over an earlier capture event for the same version.
      events.set(extracted.versionId, extracted)
    }
  }
  return { events, truncated }
}
