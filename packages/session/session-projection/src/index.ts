/**
 * Service Definition and drive registry for the session-projection capability seam: the merge-extensible state and client-view type
 * tables, the `ProjectionDefinition` state-driven computation unit contract,
 * and the `ctx.sessionProjections` registry that DRIVES every registered unit
 * forward eagerly over committed session events. Domain host plugins
 * contribute pure folds and optional client views; the framework owns the
 * subscription, the per-session watermark cache, and change notification;
 * carriers consume the snapshot read face and the change feed. Neither side
 * knows the other
 * (capability-seam three-way split). Design authority: the session-projection
 * RFC (.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md).
 *
 * Whole-value event rule (load-bearing): a state-carrying log event MUST
 * carry the complete post-change state, never a bare delta — it keeps every
 * unit's transition trivially cheap and every served value self-describing.
 *
 * @module @deepseek-ai/dsh-session-projection
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { isDeepStrictEqual } from 'node:util'
import type { ZodType } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionProjections: SessionProjectionRegistry
  }
}

import type { SessionProjectionMap, SessionProjectionStateMap } from './types.ts'

export type { SessionProjectionMap, SessionProjectionStateMap } from './types.ts'

/**
 * One domain's state-driven computation unit: a pure synchronous fold plus
 * declarations and an optional client view — never an opaque getter. The framework drives
 * `apply` on every committed session event; the domain holds no
 * subscriptions and owns only the computation. All functions MUST be
 * synchronous (an async unit would tear the carriers' consistency cut), and
 * `state` MUST be plain JSON (the persisted-cache precondition).
 */
export interface ProjectionDefinition<
  K extends keyof SessionProjectionStateMap,
  S extends SessionProjectionStateMap[K] = SessionProjectionStateMap[K],
> {
  /** The projection key this unit owns (its `SessionProjectionStateMap` entry). */
  key: K
  /**
   * Validates persisted state before it seeds a fold. Also the default
   * admission schema for a checkpoint row's private state when
   * `checkpointStateSchema` is omitted.
   */
  stateSchema: ZodType<S>
  /**
   * Admits persisted private state read back from a checkpoint row, in place
   * of `stateSchema`, for a unit whose checkpoint representation needs
   * different validation. Omitted for a unit whose checkpoint state needs no
   * admission beyond `stateSchema` itself. Parsing is validation-only: a
   * transform whose output is not deeply equal to its input rejects the row
   * rather than silently migrating it.
   */
  checkpointStateSchema?: ZodType<S>
  /**
   * Extracts the committed-event watermark encoded inside private state, for
   * a unit whose state carries its own provenance-derived watermark. When
   * supplied, the registry requires every state it writes to or admits from
   * a checkpoint row to report exactly that row's outer `seq`, so a
   * valid-but-older state can never be spliced under a newer watermark.
   * @param state - private state to extract the watermark from.
   * @returns the committed-event seq this state was folded through.
   */
  checkpointStateSeq?(state: S): number
  /**
   * State for the empty log.
   * @returns the initial state.
   */
  init(): NoInfer<S>
  /**
   * Pure transition: previous state + one committed event → next state. A
   * unit uninterested in an event MUST return the same state reference — an
   * unchanged reference (`Object.is`) produces zero downstream work.
   * @param state - the state covering all prior events.
   * @param event - the next committed session event.
   * @returns the next state (same reference when the event is not the unit's).
   */
  apply(state: NoInfer<S>, event: SessionEvent): NoInfer<S>
  /** Client view. Omit for host-only units. */
  wire?: K extends keyof SessionProjectionMap ? {
    /** Validates the wire payload before it leaves the host. */
    viewSchema: ZodType<SessionProjectionMap[K]>
    /**
     * State → wire payload (the read-side projection).
     * @param state - the current state.
     * @returns the whole current value for this unit's key.
     */
    view(state: NoInfer<S>): SessionProjectionMap[K]
  } : never
  /**
   * Narrows public-change notification after `apply` already returned a
   * different reference. It cannot turn a same-reference no-op into a
   * change; omitted, every reference change notifies.
   * @param previous - state before the committed event.
   * @param next - state after the committed event (a different reference).
   * @returns whether the change feed should notify for this transition.
   */
  viewChanged?(previous: S, next: S): boolean
  /**
   * Persisted-cache invalidation version: bump whenever the serialized state fields or the
   * fold semantics change, so persisted `(sessionId, key, ver, seq, val)`
   * rows from an older unit are discarded instead of being forward-applied
   * into garbage. Non-negative integer.
   */
  stateVersion: number
}

/**
 * Change-feed listener: one unit's value changed for one session. `value` is
 * the schema-validated `view` output; `seq` is the unit's watermark at
 * emission (the seq of the event that caused the change).
 */
export type ProjectionChangeListener = (
  session: Session,
  key: Extract<keyof SessionProjectionMap, string>,
  value: unknown,
  seq: number,
) => void

/**
 * One consistent read cut over every registered client-visible unit for one session.
 * `asOfSeq` is the shared watermark — the seq of the last event every value
 * reflects (`-1` for an empty log, mirroring `session/subscribed.lastSeq`).
 */
export interface ProjectionSnapshot {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: number
  /** Whole current client value per registered key. */
  values: Partial<SessionProjectionMap>
}

/**
 * One unit's checkpoint: its internal state (plain JSON by the unit
 * contract), the seq of the last event folded into it, and the unit
 * `stateVersion` that produced it — the persisted projection-cache row
 * `(sessionId, key, ver, seq, val)` minus the two outer keys. A row is
 * never authoritative, only a fold shortcut: `restore` discards it on a
 * version mismatch or when it claims events past the stored log end.
 */
export interface ProjectionCheckpointRow {
  /** The registering unit's `stateVersion` at fold time. */
  ver: number
  /** Seq of the last event folded into `val`; -1 for the empty log. */
  seq: number
  /** The unit's internal state — plain JSON per the unit contract. */
  val: unknown
}

/** Checkpoint rows keyed by projection key (one session's persisted cache value). */
export type ProjectionCheckpoint = Record<string, ProjectionCheckpointRow>

/** Type-erased unit view the drive machinery works with (the registration contract already proved the typed form). */
interface ErasedDefinition {
  key: string
  stateSchema: { safeParse(value: unknown): { success: true; data: unknown } | { success: false } }
  checkpointStateSchema?: { safeParse(value: unknown): { success: true; data: unknown } | { success: false } }
  checkpointStateSeq?(state: unknown): number
  init(): unknown
  apply(state: unknown, event: SessionEvent): unknown
  wire: { viewSchema: { parse(value: unknown): unknown }; view(state: unknown): unknown } | undefined
  viewChanged?(previous: unknown, next: unknown): boolean
  stateVersion: number
}

/** Result of admitting one persisted checkpoint row's private state. */
type CheckpointStateAdmission = { valid: true; state: unknown } | { valid: false }

/** Per-session per-unit watermark cache row. */
interface UnitCell {
  state: unknown
  /** Seq of the last event passed through `apply` (regardless of change). */
  observedSeq: number
}

/**
 * One live registration: the unit plus its per-session cells (dropped whole
 * once the last registrant releases it).
 *
 * `refs` exists because one unit definition already serves every session — the
 * cells are keyed by `Session` — while the registrants are now per-session:
 * an agent preset mounts the same tool package once per agent, so N sessions
 * on one preset register the same key N times. Without a count the first
 * registrant would own the disposer, and its session ending would strip the
 * projection from every other live session.
 */
interface Registration {
  readonly def: ErasedDefinition
  readonly cells: WeakMap<Session, UnitCell>
  /** Live registrants sharing this unit; the last one out removes the key. */
  refs: number
}

/**
 * `ctx.sessionProjections`: the projection unit table and its drive. The
 * service subscribes to `session/event` once; every committed event passes
 * every registered unit's `apply` (eager drive), and a changed state
 * reference in a client-visible unit notifies the change feed with the
 * schema-validated view.
 * Cells build lazily — a unit registered after events flowed, or a session
 * older than the registry, folds `init` over the in-memory log on first
 * touch (event or read). Registration is an effect (disposer rides the
 * calling fiber): an unloaded domain plugin's key disappears from snapshots
 * and clients read it as capability absence. Domain
 * plugins register under `ctx.inject(['sessionProjections'], …)` so headless
 * assemblies without the registry stay unaffected. Registrants sharing a key
 * share one unit and are counted: the same tool package mounted in N agent
 * presets registers N times, and the key survives until the last one
 * unloads.
 */
export class SessionProjectionRegistry extends Service {
  private readonly registrations = new Map<string, Registration>()
  private readonly listeners = new Set<ProjectionChangeListener>()

  /**
   * Create and install the registry as `ctx.sessionProjections`.
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionProjections')
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.drive(session, event)
    })
  }

  /**
   * Register one domain's unit. The registration is an effect on the calling
   * context's fiber: disposing the fiber (or calling the returned disposer)
   * removes the key — and the unit's cached cells — from subsequent drives
   * and snapshots.
   * @param definition - key, state schema, pure unit functions, and stateVersion.
   * @returns the exact disposer that unregisters this unit.
   */
  register<
    K extends keyof SessionProjectionMap,
    S extends SessionProjectionStateMap[K],
  >(
    definition: Omit<ProjectionDefinition<K, S>, 'wire'> & {
      wire: NonNullable<ProjectionDefinition<K, S>['wire']>
    },
  ): () => void
  /**
   * Register one host-only unit. Its state is omitted from client snapshots
   * and always checkpointed like every other unit.
   * @param definition - key, state schema, pure unit functions, and stateVersion.
   * @returns the exact disposer that unregisters this unit.
   */
  register<
    K extends Exclude<keyof SessionProjectionStateMap, keyof SessionProjectionMap>,
    S extends SessionProjectionStateMap[K],
  >(
    definition: Omit<ProjectionDefinition<K, S>, 'wire'>,
  ): () => void
  register<K extends keyof SessionProjectionStateMap, S extends SessionProjectionStateMap[K]>(
    definition: ProjectionDefinition<K, S>,
  ): () => void {
    const wire = definition.wire as {
      viewSchema: ZodType
      view(state: S): unknown
    } | undefined
    const checkpointStateSchema = definition.checkpointStateSchema
    const erased: ErasedDefinition = {
      key: definition.key,
      stateSchema: definition.stateSchema,
      // `checkpointStateSchema`/`checkpointStateSeq`/`viewChanged` are optional
      // (`foo?: T`) on `ErasedDefinition`, not `foo: T | undefined`; under
      // `exactOptionalPropertyTypes` an explicit `undefined` value is rejected
      // for an optional property, so an absent source omits the key entirely
      // instead of assigning `undefined` through it. Each optional is called
      // through `definition.foo(...)` rather than extracted to a local first —
      // a bare method-shorthand reference trips the unbound-method lint rule.
      ...(checkpointStateSchema === undefined ? {} : { checkpointStateSchema }),
      ...(definition.checkpointStateSeq === undefined ? {} : {
        checkpointStateSeq: (state: unknown) =>
          (definition.checkpointStateSeq as (state: S) => number)(state as S),
      }),
      init: () => definition.init(),
      apply: (state, event) => definition.apply(state as S, event),
      wire: wire === undefined
        ? undefined
        : { viewSchema: wire.viewSchema, view: state => wire.view(state as S) },
      ...(definition.viewChanged === undefined ? {} : {
        viewChanged: (previous: unknown, next: unknown) =>
          (definition.viewChanged as (previous: S, next: S) => boolean)(previous as S, next as S),
      }),
      stateVersion: definition.stateVersion,
    }
    if (!Number.isSafeInteger(definition.stateVersion) || definition.stateVersion < 0) {
      throw new Error(`session projection ${JSON.stringify(definition.key)} stateVersion must be a non-negative integer, got ${String(definition.stateVersion)}`)
    }
    const dispose = this.ctx.effect(function* (this: SessionProjectionRegistry) {
      const key = erased.key
      const existing = this.registrations.get(key)
      if (existing === undefined) {
        this.registrations.set(key, { def: erased, cells: new WeakMap(), refs: 1 })
      } else {
        if (existing.def.stateVersion !== erased.stateVersion) {
          throw new Error(`session projection key ${JSON.stringify(key)} is already registered at stateVersion ${String(existing.def.stateVersion)}; refusing to share it with stateVersion ${String(erased.stateVersion)}`)
        }
        existing.refs += 1
      }
      yield () => {
        const live = this.registrations.get(key)
        /* v8 ignore next -- the disposer runs once per successful registration, so the entry it counted is still here */
        if (live === undefined) return
        live.refs -= 1
        if (live.refs === 0) this.registrations.delete(key)
      }
    }.bind(this), 'sessionProjections.register()')
    return () => void dispose()
  }

  /**
   * Subscribe to the change feed. The registration is an effect on the
   * calling context's fiber.
   * @param listener - called once per client-visible unit whose state reference changed, per committed event.
   * @returns the exact disposer that unsubscribes.
   */
  onChanged(listener: ProjectionChangeListener): () => void {
    const dispose = this.ctx.effect(() => {
      this.listeners.add(listener)
      return () => {
        this.listeners.delete(listener)
      }
    }, 'sessionProjections.onChanged()')
    return () => void dispose()
  }

  /**
   * Read one unit's current host state without computing unrelated views.
   * The returned value is live; callers must not mutate it.
   * @param session - the session whose state is read.
   * @param key - the registered unit key.
   * @returns current state, or `undefined` when the key is not registered.
   */
  stateOf<K extends keyof SessionProjectionStateMap>(
    session: Session,
    key: K,
  ): SessionProjectionStateMap[K] | undefined {
    const registration = this.registrations.get(key)
    if (registration === undefined) return undefined
    return this.cellFor(registration, session).state as SessionProjectionStateMap[K]
  }

  /**
   * One consistent cut over every registered client-visible unit for one session, read from
   * the watermark cache (missing cells fold lazily over the in-memory log).
   * Fully synchronous — every value and `asOfSeq` reflect the same log
   * position. Each value passes its unit's `viewSchema` before leaving.
   * @param session - the session whose projection values are read.
   * @returns the snapshot; `values` is empty when no client-visible unit is registered.
   */
  snapshot(session: Session): ProjectionSnapshot {
    const values: Record<string, unknown> = {}
    for (const registration of this.registrations.values()) {
      if (registration.def.wire === undefined) continue
      const cell = this.cellFor(registration, session)
      values[registration.def.key] = registration.def.wire.viewSchema.parse(registration.def.wire.view(cell.state))
    }
    return { asOfSeq: session.seq - 1, values }
  }

  /**
   * State-level checkpoint of every persisted unit for one session, read
   * from the watermark cache (missing cells fold lazily over the in-memory
   * log). This is the write side of the persisted projection cache: the
   * returned rows are the `(key → {ver, seq, val})` part of the durable
   * `(sessionId, key, ver, seq, val)`
   * rows. Every `val` is a DETACHED structured clone — never the live
   * cell reference: the watermark cache is this registry's authoritative
   * mutable state, and a caller reaching the live reference could corrupt
   * every subsequent snapshot and frame through it (plain JSON by the unit
   * contract, so the clone is total).
   * @param session - the session whose unit states are checkpointed.
   * @returns one row per registered key.
   */
  checkpoint(session: Session): ProjectionCheckpoint {
    const rows: ProjectionCheckpoint = {}
    for (const registration of this.registrations.values()) {
      const def = registration.def
      const cell = this.cellFor(registration, session)
      const val = structuredClone(cell.state)
      if (!this.checkpointStateMatchesSeq(def, val, cell.observedSeq)) {
        throw new Error(
          `session projection ${JSON.stringify(def.key)} private checkpoint watermark does not match seq ${String(cell.observedSeq)}`,
        )
      }
      rows[def.key] = { ver: def.stateVersion, seq: cell.observedSeq, val }
    }
    return rows
  }

  /**
   * The stored seq a {@link restore} tail read over `checkpoint` must start
   * at: one event BELOW the lowest usable watermark. A row is usable when
   * its `ver` matches the live unit's `stateVersion` and its private state
   * passes the unit's optional schema and embedded-watermark admission; an
   * absent, mismatched, or rejected row pulls the floor to `0` — that key
   * must refold the full log. The
   * one-below anchor is load-bearing: the tail then proves how far the
   * stored log still extends, so {@link restore} can detect a log that
   * shrank below a row's watermark (crash-repair truncation) instead of
   * serving the stale row as current — an empty tail read from the anchor
   * yields an end below every watermark and the restore rejects for a full
   * re-read.
   * @param checkpoint - persisted rows for one session (possibly stale or empty).
   * @returns the seq to hand the persistence `readFrom`, or `undefined`
   *   when no unit is registered (no read needed — {@link restore} would
   *   serve empty values regardless).
   */
  restoreFloor(checkpoint: ProjectionCheckpoint): number | undefined {
    let floor: number | undefined
    for (const registration of this.registrations.values()) {
      const def = registration.def
      const row = checkpoint[def.key]
      const versionMatches = row !== undefined && row.ver === def.stateVersion
      const admitted = versionMatches ? this.admitCheckpointState(def, row) : { valid: false as const }
      const need = versionMatches && admitted.valid ? Math.max(row.seq + 1, 0) : 0
      floor = floor === undefined ? need : Math.min(floor, need)
    }
    return floor === undefined ? undefined : Math.max(floor - 1, 0)
  }

  /**
   * View a checkpoint's rows without any log read: for every registered
   * client-visible unit whose row's `ver` matches and whose private state
   * passes optional admission (schema-validated, and watermark-checked when
   * the unit supplies `checkpointStateSeq`), serve the schema-validated
   * `view`; mismatched, malformed, rejected, or absent rows leave their key
   * absent (a cold or listing consumer treats it as not-yet-available and a
   * fuller read path refolds it). The zero-I/O rung of the read ladder —
   * admitted values are as stale as their rows, never wrong.
   * @param checkpoint - persisted rows for one session (possibly stale or empty).
   * @returns whole values per key with a usable row; empty when none.
   */
  viewCheckpoint(checkpoint: ProjectionCheckpoint): Partial<SessionProjectionMap> {
    const values: Record<string, unknown> = {}
    for (const registration of this.registrations.values()) {
      const def = registration.def
      if (def.wire === undefined) continue
      const row = checkpoint[def.key]
      if (row === undefined || row.ver !== def.stateVersion) continue
      const admitted = this.admitCheckpointState(def, row)
      if (!admitted.valid) continue
      values[def.key] = def.wire.viewSchema.parse(def.wire.view(admitted.state))
    }
    return values
  }

  /**
   * Cold read: fold every persisted unit over a stored log suffix, seeding
   * each from its checkpoint row when usable — the one read recipe (cached
   * state + forward tail replay + `view`) applied without a live `Session`.
   * Call with the events returned by a persistence
   * `readFrom(id, restoreFloor(checkpoint))` and that same floor as
   * `baseSeq`; the floor's one-below anchor makes the supplied end honest,
   * so a shrunk log is detected here. A row is usable iff its
   * `ver` matches the live unit's `stateVersion`, its private state passes
   * optional admission, it does not predate `baseSeq` (`seq >= baseSeq - 1`),
   * and it does not claim events past the supplied end (`seq <= endSeq`);
   * an unusable row is discarded
   * and its key refolds from `init` — which is only sound over the full
   * log, so a discarded row with `baseSeq > 0` throws (the caller re-reads
   * from seq 0, e.g. after a crash-repair truncation shrank the log below
   * a row's watermark).
   * @param checkpoint - persisted rows for one session (possibly stale or empty).
   * @param events - the stored events with `seq >= baseSeq`, in seq order.
   * @param baseSeq - the seq `events` starts at (its first event's seq when non-empty).
   * @returns the snapshot cut at the supplied log end (`asOfSeq` is the last
   *   supplied event's seq, `baseSeq - 1` for an empty tail) plus the
   *   refreshed checkpoint rows at that cut, ready for a durable write-back.
   */
  restore(
    checkpoint: ProjectionCheckpoint,
    events: readonly SessionEvent[],
    baseSeq: number,
  ):
  { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint } {
    const endSeq = events.at(-1)?.seq ?? baseSeq - 1
    const values: Record<string, unknown> = {}
    const refreshed: ProjectionCheckpoint = {}
    for (const registration of this.registrations.values()) {
      const def = registration.def
      const row = checkpoint[def.key]
      const coordinatesUsable = row !== undefined
        && row.ver === def.stateVersion
        && row.seq >= baseSeq - 1
        && row.seq <= endSeq
      const admitted = coordinatesUsable ? this.admitCheckpointState(def, row) : { valid: false as const }
      const usable = coordinatesUsable && admitted.valid
      if (!usable && baseSeq > 0) {
        throw new Error(
          `session projection ${JSON.stringify(def.key)} cannot restore from seq ${baseSeq}: `
          + 'its checkpoint row is missing, version-mismatched, state-invalid, or beyond the supplied log end; re-read from seq 0',
        )
      }
      let state = usable ? admitted.state : def.init()
      const from = usable ? row.seq : baseSeq - 1
      for (const event of events) {
        if (event.seq > from) state = def.apply(state, event)
      }
      if (!this.checkpointStateMatchesSeq(def, state, endSeq)) {
        throw new Error(
          `session projection ${JSON.stringify(def.key)} private checkpoint watermark does not match seq ${String(endSeq)}`,
        )
      }
      if (def.wire !== undefined) values[def.key] = def.wire.viewSchema.parse(def.wire.view(state))
      refreshed[def.key] = { ver: def.stateVersion, seq: endSeq, val: state }
    }
    return {
      snapshot: { asOfSeq: endSeq, values: values },
      checkpoint: refreshed,
    }
  }

  /**
   * Admit one persisted checkpoint row's private state against its unit's
   * `checkpointStateSchema` when supplied, or its baseline `stateSchema`
   * otherwise, plus the optional `checkpointStateSeq`. Every row's state is
   * validated against one of the two schemas — an unvalidated row would
   * reach `wire.view` with whatever shape a stale or corrupted persisted
   * value carries. Parsing is validation-only: a parse whose output is not
   * deeply equal to its input rejects the row rather than silently migrating
   * it. A unit that also supplies `checkpointStateSeq` additionally requires
   * the admitted state's own encoded watermark to equal the row's outer
   * `seq`, so a valid-but-differently-watermarked state can never be served
   * under this row's seq.
   * @param def - active type-erased unit definition.
   * @param row - persisted checkpoint row for this unit's key.
   * @returns the admitted state, or rejection.
   */
  private admitCheckpointState(def: ErasedDefinition, row: ProjectionCheckpointRow): CheckpointStateAdmission {
    const schema = def.checkpointStateSchema ?? def.stateSchema
    const result = schema.safeParse(row.val)
    if (!result.success || !isDeepStrictEqual(result.data, row.val)) return { valid: false }
    if (!this.checkpointStateMatchesSeq(def, result.data, row.seq)) return { valid: false }
    return { valid: true, state: result.data }
  }

  /**
   * Check a domain-encoded watermark against its row seq, for a unit that
   * supplies `checkpointStateSeq`. A unit without the extractor always
   * matches.
   * @param def - active type-erased unit definition.
   * @param state - private state to check.
   * @param seq - the seq this state is claimed to be folded through.
   * @returns whether the extracted watermark equals `seq`.
   */
  private checkpointStateMatchesSeq(def: ErasedDefinition, state: unknown, seq: number): boolean {
    return def.checkpointStateSeq === undefined || def.checkpointStateSeq(state) === seq
  }

  /** Fold one unit from init over `events`, producing a cell watermarked at the last folded event. */
  private buildCell(def: ErasedDefinition, events: readonly SessionEvent[]): UnitCell {
    let state = def.init()
    for (const event of events) state = def.apply(state, event)
    return { state, observedSeq: (events.at(-1)?.seq ?? -1) }
  }

  /** Read (or lazily build, folding the full in-memory log) one unit's cell. */
  private cellFor(registration: Registration, session: Session): UnitCell {
    let cell = registration.cells.get(session)
    if (cell === undefined) {
      cell = this.buildCell(registration.def, session.events)
      registration.cells.set(session, cell)
    }
    return cell
  }

  /** Eager drive: pass one committed event through every registered unit; notify on changed references. */
  private drive(session: Session, event: SessionEvent): void {
    for (const registration of this.registrations.values()) {
      let cell = registration.cells.get(session)
      if (cell === undefined) {
        // Late build mid-stream: fold history before this event (seq = log
        // index, so the prefix slice is exact), then take the normal gate.
        cell = this.buildCell(registration.def, session.events.slice(0, event.seq))
        registration.cells.set(session, cell)
      }
      const previous = cell.state
      const next = registration.def.apply(previous, event)
      const changed = !Object.is(next, previous)
      cell.state = next
      cell.observedSeq = event.seq
      if (changed && registration.def.wire !== undefined && this.listeners.size > 0) {
        const publicChanged = registration.def.viewChanged?.(previous, next) ?? true
        if (!publicChanged) continue
        const value = registration.def.wire.viewSchema.parse(registration.def.wire.view(next))
        for (const listener of this.listeners) {
          listener(session, registration.def.key as Extract<keyof SessionProjectionMap, string>, value, event.seq)
        }
      }
    }
  }
}

export default SessionProjectionRegistry
