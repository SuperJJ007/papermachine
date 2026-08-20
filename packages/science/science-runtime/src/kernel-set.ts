/**
 * Owns every live persistent Science kernel across sessions: at most one
 * kernel per (session, language), epoch allocation, idle expiry, and the
 * closed set of end reasons a kernel's own subprocess lifetime can settle
 * into (D3). Emits no session events itself — the typed callbacks supplied
 * at construction receive exactly the facts a durable `science/kernel-state`
 * event needs (D4); appending that event is the caller's job.
 *
 * Registry discipline mirrors `LeaseRegistry` (`lifecycle.ts`): one exact
 * Session's kernel state lives in a `WeakMap` for as long as the Session
 * object itself is reachable, and a session id additionally occupies a
 * `Map` entry for as long as it owns any live or still-tearing-down kernel.
 * A same-id successor Session object that tries to acquire a kernel while
 * that entry still exists is refused with {@link KernelSetQuarantinedError}
 * until the predecessor's kernel tree is proven quiescent — the same
 * same-id quarantine semantics `LeaseRegistry` enforces for run operations,
 * reimplemented here because a kernel-owning session and a run-leasing
 * session are different resources (D3: holding a kernel never makes the
 * runtime BUSY, so the two registries must not share membership).
 *
 * `acquire` calls for the same (session, language) pair are not
 * internally serialized against each other: every production caller (K3.1)
 * reaches `acquire` from within the session's existing per-operation lease,
 * so at most one call is ever in flight per session at a time. Calling
 * `acquire` concurrently for the same (session, language) outside that
 * discipline is a programming error with unspecified interleaving.
 *
 * @module @deepseek-ai/dsh-science-runtime/kernel-set
 */

import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ScienceEnvironmentBinding, ScienceKernelEndReason, ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { selectBinding } from './execution.ts'
import { resolveKernelDriverPath } from './kernel-assets.ts'
import { KernelProcess } from './kernel-process.ts'
import type { KernelExitFact } from './kernel-process.ts'
import type { ScienceSessionScratch } from './scratch.ts'

/**
 * One live, ready kernel process and its own session-local epoch — the
 * provenance backbone a caller needs to fix a run's `kernelEpoch` (D4).
 */
export interface AcquiredKernel {
  /** The live, ready kernel process. */
  readonly process: KernelProcess
  /** This kernel instance's own session-local epoch. */
  readonly epoch: number
}

/** Whole-value fact for one kernel spawn — the fields D4's `science/kernel-state` (`state: 'started'`) event needs. */
export interface ScienceKernelStartedFact {
  /** The started kernel's language. */
  readonly language: ScienceLanguage
  /** Session-local, strictly monotonic identity for this kernel instance. */
  readonly kernelEpoch: number
  /** Applied environment revision this kernel serves. */
  readonly environmentRevision: number
  /** Fingerprint of the language's available binding this kernel spawned against. */
  readonly environmentFingerprint: string
  /** Epoch milliseconds when the kernel's READY handshake completed. */
  readonly startedAt: number
}

/** Whole-value fact for one kernel end — the fields D4's `science/kernel-state` (`state: 'exited'`) event needs. */
export interface ScienceKernelEndedFact {
  /** The ended kernel's language. */
  readonly language: ScienceLanguage
  /** The ended kernel's own session-local epoch. */
  readonly kernelEpoch: number
  /** Applied environment revision the ended kernel served. */
  readonly environmentRevision: number
  /** Fingerprint of the language's available binding the ended kernel spawned against. */
  readonly environmentFingerprint: string
  /** Epoch milliseconds when the kernel's READY handshake completed. */
  readonly startedAt: number
  /** Epoch milliseconds when this end path observed the kernel as gone. */
  readonly endedAt: number
  /** Closed reason the kernel's own subprocess lifetime ended. */
  readonly reason: ScienceKernelEndReason
}

/** Notified once a fresh kernel's READY handshake completes. */
export type KernelStartedCallback = (session: Session, fact: ScienceKernelStartedFact) => void

/** Notified once a kernel's end path (commanded or uncommanded) settles. */
export type KernelEndedCallback = (session: Session, fact: ScienceKernelEndedFact) => void

/** Construction inputs for one `KernelSet`. */
export interface KernelSetOptions {
  /** Shared subprocess runtime every spawned kernel confines through. */
  readonly subprocess: SubprocessRuntime
  /** Shared sandbox provider every spawned kernel confines through. */
  readonly sandbox: SandboxProvider
  /** Directory a spawn resolves `kernel_python.py` / `kernel_r.R` under (production: `KERNEL_ASSETS_ROOT`; tests: a fixture root). */
  readonly assetsRoot: string
  /** Idle deadline armed on spawn and reset by {@link KernelSet.resetIdleTimer}. */
  readonly kernelIdleTimeoutMs: number
  /** Spawn-to-READY deadline forwarded to {@link KernelProcess.start}. */
  readonly kernelStartTimeoutMs: number
  /**
   * Allocate the next session-local kernel epoch. `KernelSet` never reads
   * durable state itself; it only asserts the returned value is strictly
   * greater than the last epoch it committed for the same Session.
   */
  readonly nextEpoch: (session: Session) => number
  /**
   * Notified synchronously, BEFORE the fresh kernel becomes acquirable,
   * once its READY handshake completes (D4 amendment, A1 finding 4):
   * typically appends the durable `started` fact. A throw here ends the
   * fresh kernel without ever registering it and fails the
   * {@link KernelSet.acquire} call that spawned it — no `started` fact
   * exists for it, so it never requires a matching `exited` one either.
   */
  readonly onKernelStarted: KernelStartedCallback
  /**
   * Notified once a kernel's end path (commanded or uncommanded) reaches
   * quiescence, after registry bookkeeping already removed the kernel from
   * live membership: typically appends the durable `exited` fact.
   * Containment-wrapped (D4 amendment, A1 finding 4): a throw here is
   * swallowed and never rejects teardown or skips quarantine bookkeeping —
   * a legitimately dead Session's missing `exited` fact is recovered by the
   * end-seed `ScienceKernelInterrupted` derivation.
   */
  readonly onKernelEnded: KernelEndedCallback
}

/**
 * A same-id successor Session tried to acquire a kernel while its
 * predecessor's kernel tree was not yet proven quiescent. K3.1 maps this
 * onto the Runtime's existing `RUNTIME_BUSY` rejection — the same user
 * semantics as `LeaseRegistry`'s same-id quarantine (D10).
 */
export class KernelSetQuarantinedError extends Error {
  override name = 'KernelSetQuarantinedError'

  constructor(sessionId: string) {
    super(
      `science-runtime: kernel set quarantines session id ${JSON.stringify(sessionId)} `
      + 'until the predecessor kernel tree is proven quiescent',
    )
  }
}

/**
 * `acquire` was called on an exact Session object this `KernelSet` already
 * ran {@link KernelSet.detach} against: a detached Session can never become
 * a fresh kernel's owner again, since `detach` already committed to ending
 * every kernel it owned.
 */
export class KernelSetDetachedError extends Error {
  override name = 'KernelSetDetachedError'

  constructor(sessionId: string) {
    super(`science-runtime: kernel set already detached session id ${JSON.stringify(sessionId)}; it cannot acquire a fresh kernel`)
  }
}

/**
 * Two different registry entries for the same session id both tried to
 * hold `byId` membership at once — a same-id quarantine gap (A1 finding 5):
 * a successor Session's entry registered a live kernel while its
 * predecessor's entry, spawning concurrently, had not yet registered its
 * own. Fails loud rather than letting the second registration silently
 * clobber the first and drop quarantine over the first entry's kernel.
 */
export class KernelSetConflictError extends Error {
  override name = 'KernelSetConflictError'

  constructor(sessionId: string) {
    super(`science-runtime: kernel set already tracks a different registry entry for session id ${JSON.stringify(sessionId)}`)
  }
}

/**
 * A caller-supplied epoch allocator returned a value that was not strictly
 * greater than one this `KernelSet` already committed for the same Session.
 * K3.1 maps this onto `INFRASTRUCTURE_FAILURE` when it reaches a caller (D10).
 */
export class KernelEpochRegressionError extends Error {
  override name = 'KernelEpochRegressionError'

  constructor(sessionId: string, returned: number, previous: number) {
    super(
      `science-runtime: kernel epoch allocator returned ${String(returned)}, not strictly greater `
      + `than the previously committed ${String(previous)}, for session ${JSON.stringify(sessionId)}`,
    )
  }
}

/** One live kernel process and the whole-value facts its eventual end notification needs. */
interface LiveKernel {
  readonly session: Session
  readonly language: ScienceLanguage
  readonly process: KernelProcess
  readonly kernelEpoch: number
  readonly environmentRevision: number
  readonly environmentFingerprint: string
  readonly startedAt: number
  /** Cleared and replaced on every {@link KernelSet.resetIdleTimer} call; cleared (not replaced) once the kernel starts ending. */
  idleTimer: ReturnType<typeof setTimeout> | undefined
}

/** One Session's kernel-set membership: live kernels, in-flight spawns, and in-flight teardowns keyed by language. */
interface SessionEntry {
  readonly session: Session
  readonly kernels: Map<ScienceLanguage, LiveKernel>
  readonly ending: Map<ScienceLanguage, Promise<void>>
  /**
   * In-flight {@link KernelSet.spawnKernel} calls, settled regardless of
   * outcome. Read only by {@link KernelSet.syncBusyRegistration} (same-id
   * quarantine/conflict timing, A1 finding 5) — disposal awareness for a
   * call still inside {@link KernelSet.acquire}'s own drain/reuse/rebind
   * steps, before a literal spawn even begins, is `KernelSet.pending`'s job,
   * not this map's (K1.3-flagged spawn-vs-teardown race).
   */
  readonly spawning: Map<ScienceLanguage, Promise<void>>
  /** Highest epoch this `KernelSet` has committed (i.e. actually spawned) for this Session. */
  epochSeen: number
  /** Set once by {@link KernelSet.detach}; a detached entry never acquires a fresh kernel again (A1 finding 5). */
  detached: boolean
}

/**
 * One whole {@link KernelSet.acquire} call still in flight, from its own
 * synchronous call frame until it settles — a superset of `entry.spawning`'s
 * narrower post-drain window. `KernelSet.pending` exists solely so
 * {@link KernelSet.detach}/{@link KernelSet.disposeAll} can await and retire
 * a call issued with no intervening await before them (closes the
 * K1.3-flagged spawn-vs-teardown race); it is never read by
 * {@link KernelSet.assertAcquirable}/{@link KernelSet.syncBusyRegistration},
 * so it has no effect on same-id conflict timing.
 */
interface PendingAcquisition {
  readonly entry: SessionEntry
  readonly language: ScienceLanguage
  readonly settlement: Promise<void>
}

/** Compile-time proof {@link ScienceKernelEndReason} stays closed; every member reaches the same end-and-notify path. */
// Every ScienceKernelEndReason member is listed in assertClosedEndReason's
// switch; reaching this requires a value TypeScript already refuses to accept.
/* v8 ignore next 3 -- see above */
function assertNeverEndReason(reason: never): never {
  throw new Error(`science-runtime: unreachable ScienceKernelEndReason ${JSON.stringify(reason)}`)
}

/** Assert `reason` is a member of the closed {@link ScienceKernelEndReason} union; throws via {@link assertNeverEndReason} otherwise. */
function assertClosedEndReason(reason: ScienceKernelEndReason): void {
  switch (reason) {
    case 'idle':
    case 'session-end':
    case 'environment-rebound':
    case 'run-escalation':
    case 'protocol':
    case 'crash':
    case 'service-disposed':
      return
    /* v8 ignore next 2 -- ScienceKernelEndReason is closed and every member is handled above. */
    default:
      assertNeverEndReason(reason)
  }
}

/** Owner of every live persistent Science kernel across sessions; see this module's own doc for the full design. */
export class KernelSet {
  private readonly exact = new WeakMap<Session, SessionEntry>()
  private readonly byId = new Map<string, SessionEntry>()
  /** Every {@link acquire} call still in flight; see {@link PendingAcquisition}'s own doc. */
  private readonly pending = new Set<PendingAcquisition>()
  private readonly subprocess: SubprocessRuntime
  private readonly sandbox: SandboxProvider
  private readonly assetsRoot: string
  private readonly kernelIdleTimeoutMs: number
  private readonly kernelStartTimeoutMs: number
  private readonly nextEpoch: (session: Session) => number
  private readonly onKernelStarted: KernelStartedCallback
  private readonly onKernelEnded: KernelEndedCallback

  /**
   * @param options - shared services, spawn tuning, and the epoch allocator
   *   and lifecycle callbacks this instance uses for every kernel.
   */
  constructor(options: KernelSetOptions) {
    this.subprocess = options.subprocess
    this.sandbox = options.sandbox
    this.assetsRoot = options.assetsRoot
    this.kernelIdleTimeoutMs = options.kernelIdleTimeoutMs
    this.kernelStartTimeoutMs = options.kernelStartTimeoutMs
    this.nextEpoch = options.nextEpoch
    this.onKernelStarted = options.onKernelStarted
    this.onKernelEnded = options.onKernelEnded
  }

  /**
   * Return the exact Session's live kernel for `language` when its
   * environment revision still matches `environment.revision`; otherwise end
   * the stale kernel (`environment-rebound`) and spawn a fresh one (D6). With
   * no live kernel, spawn one. `sessionScratch` must already be materialized
   * (its `kernels/` directory created) — this method only plans and creates
   * the one kernel's own subdirectory under it.
   * @param session - exact live Session that will own the kernel.
   * @param language - requested interpreter language.
   * @param environment - applied durable environment revision the kernel must serve.
   * @param sessionScratch - the Session's already-materialized private scratch paths.
   * @param signal - the caller's own operation cancellation, fused with
   *   `kernelStartTimeoutMs` for a fresh spawn (A3 finding 11) so this call
   *   never outlives the caller's own operation deadline/cancellation by more
   *   than an already-live kernel's reuse/rebind step takes. Absent only for
   *   a caller with no operation-scoped signal of its own.
   * @returns the live, ready kernel process and its own session-local epoch.
   * @throws {@link KernelSetQuarantinedError} for a same-id successor Session
   *   while its predecessor's kernel tree is not yet proven quiescent.
   * @throws {@link KernelSetDetachedError} when this exact Session object
   *   already ran through {@link KernelSet.detach}.
   * @throws {@link KernelSetConflictError} when a same-id predecessor's
   *   registry entry still holds `byId` membership at the moment this
   *   entry tries to register its own fresh kernel.
   * @throws {@link KernelEpochRegressionError} when the injected epoch
   *   allocator returns a non-increasing value for a fresh spawn.
   * @throws whatever {@link KernelProcess.start} throws on spawn/handshake
   *   failure, including a `signal` abort during that spawn.
   */
  async acquire(
    session: Session,
    language: ScienceLanguage,
    environment: ScienceEnvironmentBinding,
    sessionScratch: ScienceSessionScratch,
    signal?: AbortSignal,
  ): Promise<AcquiredKernel> {
    const entry = this.entryFor(session)
    this.assertAcquirable(entry)
    const attempt = this.acquireKernel(entry, language, environment, sessionScratch, signal)
    this.trackPending(entry, language, attempt)
    return attempt
  }

  /** Drain a stale teardown, decide reuse vs. rebind vs. fresh spawn, and return the acquired kernel. */
  private async acquireKernel(
    entry: SessionEntry,
    language: ScienceLanguage,
    environment: ScienceEnvironmentBinding,
    sessionScratch: ScienceSessionScratch,
    signal: AbortSignal | undefined,
  ): Promise<AcquiredKernel> {
    await this.drain(entry, language)
    const live = entry.kernels.get(language)
    if (live !== undefined) {
      if (live.environmentRevision === environment.revision) return { process: live.process, epoch: live.kernelEpoch }
      await this.endKernel(live, 'environment-rebound')
    }
    return this.trackedSpawn(entry, language, environment, sessionScratch, signal)
  }

  /**
   * Register one whole {@link acquire} call (drain through reuse/rebind/spawn)
   * in `pending`, from this exact synchronous call frame — before any of its
   * internal awaits run — so a {@link detach}/{@link disposeAll} issued with
   * no intervening await still observes and awaits/retires it (closes the
   * K1.3-flagged spawn-vs-teardown race at its earliest possible point:
   * `entry.spawning`, populated only once the literal spawn begins post-drain,
   * leaves the drain/reuse window unobserved). Deliberately a registry
   * separate from `byId`/`syncBusyRegistration`: it must never affect
   * same-id conflict timing (A1 finding 5's `KernelSetConflictError` race
   * stays exactly as narrow as `entry.spawning` already made it).
   */
  private trackPending(entry: SessionEntry, language: ScienceLanguage, attempt: Promise<AcquiredKernel>): void {
    const settlement = attempt.then(() => {}, () => {})
    const record: PendingAcquisition = { entry, language, settlement }
    this.pending.add(record)
    void settlement.then(() => { this.pending.delete(record) })
  }

  /**
   * End the exact live kernel for `(session, language)` with reason
   * `run-escalation` (D5): the caller's own run terminal has already settled
   * (first-cause-governed, independent of this call); this only retires the
   * kernel itself, through the same registry bookkeeping and containment
   * every other end path uses. A no-op when no live kernel is registered —
   * a benign race against a concurrent end, never a caller error.
   * @param session - exact live Session that owns the kernel.
   * @param language - the kernel's language.
   */
  retireForEscalation(session: Session, language: ScienceLanguage): Promise<void> {
    const live = this.exact.get(session)?.kernels.get(language)
    if (live === undefined) return Promise.resolve()
    return this.endKernel(live, 'run-escalation')
  }

  /**
   * Reset one live kernel's idle deadline to a fresh full
   * `kernelIdleTimeoutMs` window measured from now. Callers invoke this
   * after a completed execution (D3) so idle time is counted from the
   * kernel's last real activity, not from when it was last acquired. A
   * no-op when no live kernel is registered for `(session, language)` — a
   * benign race against a concurrent end, never a caller error.
   * @param session - exact live Session that owns the kernel.
   * @param language - the kernel's language.
   */
  resetIdleTimer(session: Session, language: ScienceLanguage): void {
    const live = this.exact.get(session)?.kernels.get(language)
    if (live === undefined) return
    this.armIdleTimer(live)
  }

  /**
   * Disarm one live kernel's idle timer for the duration of an in-flight
   * run (D3 amendment, A1 finding 7): the idle timer must never fire while
   * a run is executing. Callers pair this with {@link resetIdleTimer} once
   * that run's DONE frame arrives, rearming a fresh full window. A no-op
   * when no live kernel is registered for `(session, language)` — a benign
   * race against a concurrent end, never a caller error.
   * @param session - exact live Session that owns the kernel.
   * @param language - the kernel's language.
   */
  disarmIdleTimer(session: Session, language: ScienceLanguage): void {
    const live = this.exact.get(session)?.kernels.get(language)
    if (live === undefined) return
    if (live.idleTimer !== undefined) clearTimeout(live.idleTimer)
    live.idleTimer = undefined
  }

  /**
   * End every live kernel this exact Session owns with reason
   * `session-end`, and mark the entry so it never acquires a fresh kernel
   * again (A1 finding 5). Fire-and-forget, mirroring `LeaseRegistry.detach`:
   * teardown proceeds asynchronously and the session id stays quarantined
   * until every ended kernel's teardown settles.
   * @param session - exact detached Session object; a same-id successor is unaffected until quiescence.
   */
  detach(session: Session): void {
    const entry = this.exact.get(session)
    if (entry === undefined) return
    entry.detached = true
    for (const live of [...entry.kernels.values()]) void this.endKernel(live, 'session-end')
    for (const record of [...this.pending]) {
      if (record.entry !== entry) continue
      void record.settlement.then(() => { void this.endIfStillLive(entry, record.language, 'session-end') })
    }
  }

  /**
   * End every live kernel across every session with reason
   * `service-disposed` and await every in-flight or freshly triggered
   * teardown, mirroring `LeaseRegistry.disposeAll`.
   * @returns settled results once every tracked teardown has resolved or rejected.
   */
  disposeAll(): Promise<PromiseSettledResult<unknown>[]> {
    const awaiting: Promise<unknown>[] = []
    for (const entry of this.byId.values()) {
      for (const settlement of entry.ending.values()) awaiting.push(settlement)
      for (const live of [...entry.kernels.values()]) awaiting.push(this.endKernel(live, 'service-disposed'))
    }
    for (const record of [...this.pending]) {
      awaiting.push(record.settlement.then(() => this.endIfStillLive(record.entry, record.language, 'service-disposed')))
    }
    return Promise.allSettled(awaiting)
  }

  /** Return this Session's registry entry, creating one on first use. */
  private entryFor(session: Session): SessionEntry {
    const existing = this.exact.get(session)
    if (existing !== undefined) return existing
    const entry: SessionEntry = { session, kernels: new Map(), ending: new Map(), spawning: new Map(), epochSeen: 0, detached: false }
    this.exact.set(session, entry)
    return entry
  }

  /**
   * Run {@link spawnKernel} while registering its in-flight settlement in
   * `entry.spawning`, so a same-id successor entry's {@link assertAcquirable}
   * check (via {@link syncBusyRegistration}) sees this session as busy for
   * the whole spawn window (A1 finding 5's conflict/quarantine timing).
   * Disposal awareness for the caller's own drain/reuse/rebind steps, and
   * for this spawn once it starts, is `pending`'s job (see
   * {@link trackPending}), not this map's.
   */
  private trackedSpawn(
    entry: SessionEntry,
    language: ScienceLanguage,
    environment: ScienceEnvironmentBinding,
    sessionScratch: ScienceSessionScratch,
    signal: AbortSignal | undefined,
  ): Promise<AcquiredKernel> {
    const attempt = this.spawnKernel(entry, language, environment, sessionScratch, signal)
    const settlement = attempt.then(() => {}, () => {})
    entry.spawning.set(language, settlement)
    this.syncBusyRegistration(entry)
    void settlement.then(() => {
      if (entry.spawning.get(language) === settlement) entry.spawning.delete(language)
      this.syncBusyRegistration(entry)
    })
    return attempt
  }

  /** End a kernel that finished spawning after `detach`/`disposeAll` already fired, if it is still the live one for its language. */
  private endIfStillLive(entry: SessionEntry, language: ScienceLanguage, reason: ScienceKernelEndReason): Promise<void> {
    const live = entry.kernels.get(language)
    return live === undefined ? Promise.resolve() : this.endKernel(live, reason)
  }

  /**
   * Refuse an entry a same-id predecessor's registry entry still holds
   * `byId` membership for (quarantine), or that already ran through
   * {@link detach}. Checked on every {@link acquire} call, not only once at
   * entry creation (A1 finding 5): a successor entry created while its
   * predecessor's spawn was still in flight (so `byId` had not yet been
   * claimed) must still be refused once the predecessor's own registration
   * lands, and a detached entry must stay refused on every later retry.
   */
  private assertAcquirable(entry: SessionEntry): void {
    const id = String(entry.session.id)
    const holder = this.byId.get(id)
    if (holder !== undefined && holder !== entry) throw new KernelSetQuarantinedError(id)
    if (entry.detached) throw new KernelSetDetachedError(id)
  }

  /** Await this language's in-flight teardown, if any, before the caller inspects or replaces its live kernel. */
  private async drain(entry: SessionEntry, language: ScienceLanguage): Promise<void> {
    const pending = entry.ending.get(language)
    if (pending !== undefined) await pending
  }

  private armIdleTimer(live: LiveKernel): void {
    if (live.idleTimer !== undefined) clearTimeout(live.idleTimer)
    live.idleTimer = setTimeout(() => { void this.endKernel(live, 'idle') }, this.kernelIdleTimeoutMs)
  }

  /**
   * Select the binding, allocate and validate a fresh epoch, spawn, notify,
   * then register. `onKernelStarted` runs BEFORE the kernel is registered
   * acquirable (D4 amendment, A1 finding 4): a throw there — the durable
   * `started` fact never committed — discards the fresh kernel through
   * {@link discardUnregisteredKernel} instead of leaving it live and
   * untracked. The same discard path covers a `byId` conflict
   * {@link syncBusyRegistration} detects immediately after registration
   * (A1 finding 5): either way, no `started` fact means this kernel must
   * never become acquirable and never needs a matching `exited` one. The
   * epoch watermark (`entry.epochSeen`) commits in that same window, only
   * once `onKernelStarted` returns (A3 finding 1): a throw there must leave
   * the watermark exactly where a retry's allocator will also find it, so
   * the retry's freshly-derived epoch is never misclassified as a
   * regression against an epoch no fact ever recorded.
   */
  private async spawnKernel(
    entry: SessionEntry,
    language: ScienceLanguage,
    environment: ScienceEnvironmentBinding,
    sessionScratch: ScienceSessionScratch,
    signal: AbortSignal | undefined,
  ): Promise<AcquiredKernel> {
    const binding = selectBinding(environment, language)
    const kernelEpoch = this.nextEpoch(entry.session)
    if (kernelEpoch <= entry.epochSeen) {
      throw new KernelEpochRegressionError(String(entry.session.id), kernelEpoch, entry.epochSeen)
    }
    const process = await KernelProcess.start({
      services: { subprocess: this.subprocess, sandbox: this.sandbox, session: entry.session, sessionScratch },
      binding,
      driverPath: resolveKernelDriverPath(this.assetsRoot, language),
      // The epoch disambiguates this kernel's scratch directory even from a
      // same-language predecessor whose teardown has not yet completed.
      index: kernelEpoch,
      kernelStartTimeoutMs: this.kernelStartTimeoutMs,
      signal,
    })
    // Captured only after the READY handshake resolves (A3 finding 7): the
    // ScienceKernelStartedFact/ScienceKernelEndedFact `startedAt` JSDoc
    // promises the handshake-completion instant, which can be up to
    // `kernelStartTimeoutMs` later than the spawn request.
    const startedAt = Date.now()
    const live: LiveKernel = {
      session: entry.session,
      language,
      process,
      kernelEpoch,
      environmentRevision: environment.revision,
      environmentFingerprint: binding.bindingFingerprint,
      startedAt,
      idleTimer: undefined,
    }
    try {
      this.onKernelStarted(entry.session, {
        language,
        kernelEpoch,
        environmentRevision: environment.revision,
        environmentFingerprint: binding.bindingFingerprint,
        startedAt,
      })
      // Committed only after `onKernelStarted`'s durable append actually
      // succeeds (A3 finding 1): the production allocator
      // (`nextKernelEpoch`, index.ts) re-derives the next epoch from the
      // durable projection alone, so a watermark advanced ahead of a fact
      // that never committed would make every later spawn attempt for this
      // Session misclassified as a regression against an epoch no fact
      // ever recorded.
      entry.epochSeen = kernelEpoch
      entry.kernels.set(language, live)
      this.syncBusyRegistration(entry)
    } catch (error) {
      entry.kernels.delete(language)
      this.syncBusyRegistration(entry)
      return this.discardUnregisteredKernel(process, error)
    }
    this.armIdleTimer(live)
    void process.exited.then((fact) => { this.onProcessExited(live, fact) })
    return { process, epoch: kernelEpoch }
  }

  /**
   * End a freshly spawned kernel that must never become acquirable: its
   * `started` fact never committed (D4 amendment, A1 findings 4/5) —
   * either `onKernelStarted` itself rejected, or a same-id `byId` conflict
   * surfaced immediately after registration. Never routes through
   * {@link teardown}/`onKernelEnded`: no `started` fact exists for an
   * `exited` one to pair against.
   * @param process - the fresh kernel process to discard.
   * @param cause - the original failure that requires discarding it.
   * @throws always: `cause`, or an `AggregateError` combining it with a teardown failure.
   */
  private async discardUnregisteredKernel(process: KernelProcess, cause: unknown): Promise<never> {
    try {
      await process.end('kernel-set: discarding a kernel that never became acquirable')
    } catch (endError) {
      throw new AggregateError([cause, endError], 'science-runtime: tearing down an unregistered kernel also failed')
    }
    throw cause
  }

  /**
   * React to `KernelProcess.exited` for a still-registered kernel: only an
   * uncommanded death (`crash`/`protocol`) needs an owner-initiated end.
   */
  private onProcessExited(live: LiveKernel, fact: KernelExitFact): void {
    if (fact.cause !== 'crash' && fact.cause !== 'protocol') return
    void this.endKernel(live, fact.cause)
  }

  /**
   * End one live kernel: idempotent against a kernel already ended or
   * already ending (returns the same in-flight settlement). Removes the
   * kernel from the registry synchronously before any await, so a
   * concurrent {@link acquire} or {@link detach} never observes a kernel
   * that is both "live" and "ending".
   */
  private endKernel(kernel: LiveKernel, reason: ScienceKernelEndReason): Promise<void> {
    const entry = this.exact.get(kernel.session)
    if (entry === undefined || entry.kernels.get(kernel.language) !== kernel) {
      return entry?.ending.get(kernel.language) ?? Promise.resolve()
    }
    entry.kernels.delete(kernel.language)
    if (kernel.idleTimer !== undefined) clearTimeout(kernel.idleTimer)
    const settlement = this.teardown(entry, kernel, reason)
    entry.ending.set(kernel.language, settlement)
    this.syncBusyRegistration(entry)
    settlement.then(
      () => { this.finishEnding(entry, kernel.language, settlement) },
      () => { this.finishEnding(entry, kernel.language, settlement) },
    )
    return settlement
  }

  /**
   * Send EXIT (best-effort), quiesce, and notify — the one path every closed
   * `ScienceKernelEndReason` member reaches. Keeps quarantine active until
   * quiescence is actually proven (A1 finding 1): when `end()`'s bounded
   * escalation could not immediately prove the tree dead, this awaits its
   * `eventualQuiescence` before notifying — this method's own returned
   * promise is what `finishEnding` waits on to drop `byId` membership, so a
   * still-possibly-alive tree never gets treated as gone. `onKernelEnded`
   * is containment-wrapped (D4 amendment, A1 finding 4): a throw there
   * (typically a durable append against a Session that already detached)
   * never rejects this method, so quarantine bookkeeping always completes.
   */
  private async teardown(entry: SessionEntry, kernel: LiveKernel, reason: ScienceKernelEndReason): Promise<void> {
    assertClosedEndReason(reason)
    const quiescence = await kernel.process.end(reason)
    if (!quiescence.quiescent) await quiescence.eventualQuiescence
    try {
      this.onKernelEnded(entry.session, {
        language: kernel.language,
        kernelEpoch: kernel.kernelEpoch,
        environmentRevision: kernel.environmentRevision,
        environmentFingerprint: kernel.environmentFingerprint,
        startedAt: kernel.startedAt,
        endedAt: Date.now(),
        reason,
      })
    } catch {
      // Containment (D4): the kernel's own teardown already completed and
      // registry bookkeeping must proceed regardless of whether the
      // caller's durable append succeeded; a legitimately dead Session's
      // missing `exited` fact is recovered by the end-seed
      // ScienceKernelInterrupted derivation the caller owns.
    }
  }

  /**
   * Remove a settled teardown from `ending` and drop quarantine once the
   * Session owns no live or ending kernel. The stale-settlement mismatch
   * {@link trackedSpawn}'s analogous guard reaches is structurally
   * unreachable here: `endKernel` only ever registers a fresh `ending` entry
   * for a language after removing that language's live kernel, and
   * {@link acquireKernel}'s `drain` always awaits any existing `ending`
   * entry before a fresh spawn can register a new live kernel to later end —
   * so this method's own `settlement` can never be replaced before it runs.
   */
  private finishEnding(entry: SessionEntry, language: ScienceLanguage, settlement: Promise<void>): void {
    /* v8 ignore next -- unreachable: see this method's own doc above. */
    if (entry.ending.get(language) === settlement) entry.ending.delete(language)
    this.syncBusyRegistration(entry)
  }

  /**
   * Keep `byId` membership exactly tracking whether this session id
   * currently owns any live, ending, or still-spawning kernel. Refuses to overwrite a
   * DIFFERENT entry already holding this id (A1 finding 5): a same-id
   * successor entry that started spawning while its predecessor's own
   * spawn was still in flight (and so found `byId` not yet claimed) must
   * not silently clobber the predecessor's registration once both land —
   * that would drop quarantine over whichever entry lost the race.
   * @throws {@link KernelSetConflictError} when a different entry already holds this session id.
   */
  private syncBusyRegistration(entry: SessionEntry): void {
    const id = String(entry.session.id)
    const busy = entry.kernels.size > 0 || entry.ending.size > 0 || entry.spawning.size > 0
    if (!busy) {
      if (this.byId.get(id) === entry) this.byId.delete(id)
      return
    }
    const holder = this.byId.get(id)
    if (holder !== undefined && holder !== entry) throw new KernelSetConflictError(id)
    this.byId.set(id, entry)
  }
}
