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
import type { ScienceEnvironmentBinding, ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { selectBinding } from './execution.ts'
import { resolveKernelDriverPath } from './kernel-assets.ts'
import { KernelProcess } from './kernel-process.ts'
import type { KernelExitFact } from './kernel-process.ts'
import type { ScienceSessionScratch } from './scratch.ts'
import type { ScienceKernelEndReason } from './types.ts'

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
  readonly onKernelStarted: KernelStartedCallback
  readonly onKernelEnded: KernelEndedCallback
}

/** A same-id successor Session tried to acquire a kernel while its predecessor's kernel tree was not yet proven quiescent. */
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
 * A caller-supplied epoch allocator returned a value that was not strictly
 * greater than one this `KernelSet` already committed for the same Session.
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

/** One Session's kernel-set membership: live kernels plus in-flight teardowns keyed by language. */
interface SessionEntry {
  readonly session: Session
  readonly kernels: Map<ScienceLanguage, LiveKernel>
  readonly ending: Map<ScienceLanguage, Promise<void>>
  /** Highest epoch this `KernelSet` has committed (i.e. actually spawned) for this Session. */
  epochSeen: number
}

/** Compile-time proof {@link ScienceKernelEndReason} stays closed; every member reaches the same end-and-notify path. */
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
    default:
      assertNeverEndReason(reason)
  }
}

/** Owner of every live persistent Science kernel across sessions; see this module's own doc for the full design. */
export class KernelSet {
  private readonly exact = new WeakMap<Session, SessionEntry>()
  private readonly byId = new Map<string, SessionEntry>()
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
   * @returns the live, ready kernel process.
   * @throws {@link KernelSetQuarantinedError} for a same-id successor Session
   *   while its predecessor's kernel tree is not yet proven quiescent.
   * @throws {@link KernelEpochRegressionError} when the injected epoch
   *   allocator returns a non-increasing value for a fresh spawn.
   * @throws whatever {@link KernelProcess.start} throws on spawn/handshake failure.
   */
  async acquire(
    session: Session,
    language: ScienceLanguage,
    environment: ScienceEnvironmentBinding,
    sessionScratch: ScienceSessionScratch,
  ): Promise<KernelProcess> {
    const entry = this.entryFor(session)
    await this.drain(entry, language)
    const live = entry.kernels.get(language)
    if (live !== undefined) {
      if (live.environmentRevision === environment.revision) return live.process
      await this.endKernel(live, 'environment-rebound')
    }
    return this.spawnKernel(entry, language, environment, sessionScratch)
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
   * End every live kernel this exact Session owns with reason
   * `session-end`. Fire-and-forget, mirroring `LeaseRegistry.detach`:
   * teardown proceeds asynchronously and the session id stays quarantined
   * until every ended kernel's teardown settles.
   * @param session - exact detached Session object; a same-id successor is unaffected until quiescence.
   */
  detach(session: Session): void {
    const entry = this.exact.get(session)
    if (entry === undefined) return
    for (const live of [...entry.kernels.values()]) void this.endKernel(live, 'session-end')
  }

  /**
   * End every live kernel across every session with reason
   * `service-disposed` and await every in-flight or freshly triggered
   * teardown, mirroring `LeaseRegistry.disposeAll`.
   * @returns settled results once every tracked teardown has resolved or rejected.
   */
  disposeAll(): Promise<PromiseSettledResult<unknown>[]> {
    const pending: Promise<unknown>[] = []
    for (const entry of this.byId.values()) {
      for (const settlement of entry.ending.values()) pending.push(settlement)
      for (const live of [...entry.kernels.values()]) pending.push(this.endKernel(live, 'service-disposed'))
    }
    return Promise.allSettled(pending)
  }

  /** Return this Session's registry entry, creating one only after passing the same-id quarantine check. */
  private entryFor(session: Session): SessionEntry {
    const existing = this.exact.get(session)
    if (existing !== undefined) return existing
    const id = String(session.id)
    if (this.byId.has(id)) throw new KernelSetQuarantinedError(id)
    const entry: SessionEntry = { session, kernels: new Map(), ending: new Map(), epochSeen: 0 }
    this.exact.set(session, entry)
    return entry
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

  /** Select the binding, allocate and validate a fresh epoch, spawn, register, and notify. */
  private async spawnKernel(
    entry: SessionEntry,
    language: ScienceLanguage,
    environment: ScienceEnvironmentBinding,
    sessionScratch: ScienceSessionScratch,
  ): Promise<KernelProcess> {
    const binding = selectBinding(environment, language)
    const kernelEpoch = this.nextEpoch(entry.session)
    if (kernelEpoch <= entry.epochSeen) {
      throw new KernelEpochRegressionError(String(entry.session.id), kernelEpoch, entry.epochSeen)
    }
    const startedAt = Date.now()
    const process = await KernelProcess.start({
      services: { subprocess: this.subprocess, sandbox: this.sandbox, session: entry.session, sessionScratch },
      binding,
      driverPath: resolveKernelDriverPath(this.assetsRoot, language),
      // The epoch disambiguates this kernel's scratch directory even from a
      // same-language predecessor whose teardown has not yet completed.
      index: kernelEpoch,
      kernelStartTimeoutMs: this.kernelStartTimeoutMs,
    })
    // Committed only after the spawn actually succeeds: a failed attempt
    // must not advance the watermark, or a retry through the same
    // durable-projection-backed allocator (which never recorded the failed
    // attempt) would be misclassified as a regression.
    entry.epochSeen = kernelEpoch
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
    entry.kernels.set(language, live)
    this.syncBusyRegistration(entry)
    this.armIdleTimer(live)
    void process.exited.then((fact) => { this.onProcessExited(live, fact) })
    this.onKernelStarted(entry.session, {
      language,
      kernelEpoch,
      environmentRevision: environment.revision,
      environmentFingerprint: binding.bindingFingerprint,
      startedAt,
    })
    return process
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
   * still-possibly-alive tree never gets treated as gone.
   */
  private async teardown(entry: SessionEntry, kernel: LiveKernel, reason: ScienceKernelEndReason): Promise<void> {
    assertClosedEndReason(reason)
    const quiescence = await kernel.process.end(reason)
    if (!quiescence.quiescent) await quiescence.eventualQuiescence
    this.onKernelEnded(entry.session, {
      language: kernel.language,
      kernelEpoch: kernel.kernelEpoch,
      environmentRevision: kernel.environmentRevision,
      environmentFingerprint: kernel.environmentFingerprint,
      startedAt: kernel.startedAt,
      endedAt: Date.now(),
      reason,
    })
  }

  /** Remove a settled teardown from `ending` and drop quarantine once the Session owns no live or ending kernel. */
  private finishEnding(entry: SessionEntry, language: ScienceLanguage, settlement: Promise<void>): void {
    if (entry.ending.get(language) === settlement) entry.ending.delete(language)
    this.syncBusyRegistration(entry)
  }

  /** Keep `byId` membership exactly tracking whether this session id currently owns any live or ending kernel. */
  private syncBusyRegistration(entry: SessionEntry): void {
    const id = String(entry.session.id)
    if (entry.kernels.size > 0 || entry.ending.size > 0) {
      this.byId.set(id, entry)
    } else if (this.byId.get(id) === entry) {
      this.byId.delete(id)
    }
  }
}
