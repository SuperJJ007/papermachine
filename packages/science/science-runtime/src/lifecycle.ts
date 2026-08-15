/** Exact-Session reservation, cancellation, and same-id quarantine helpers. */

import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { Session } from '@deepseek-ai/dsh-session'
import { ScienceRuntimeError } from './types.ts'

const TIMEOUT_CODE = 'SCIENCE_RUNTIME_TIMEOUT'

/** First operation cause that determines a terminal classification. */
export type OperationCause = 'timeout' | 'cancelled' | 'service-disposed' | 'session-detached'

/** One operation's fused abort signal and independent first-cause record. */
export class OperationControl {
  private readonly caller: AbortSignal
  private readonly cancellation = new AbortController()
  private readonly teardown = new AbortController()
  private readonly timer: ReturnType<typeof deadline>
  private readonly onCallerAbort: () => void
  private readonly onTimerAbort: () => void
  private causeValue: OperationCause | undefined
  /** Fused cancellation signal retained by every owned subprocess operation. */
  readonly signal: AbortSignal

  /**
   * @param caller - Required caller-owned cancellation signal.
   * @param timeoutMs - Configured finite operation deadline.
   */
  constructor(caller: AbortSignal, timeoutMs: number) {
    this.caller = caller
    this.timer = deadline(caller, timeoutMs, TIMEOUT_CODE)
    this.signal = AbortSignal.any([this.timer.signal, this.cancellation.signal, this.teardown.signal])
    this.onCallerAbort = (): void => { this.set('cancelled') }
    this.onTimerAbort = (): void => {
      if (timeoutOf(this.timer.signal, TIMEOUT_CODE) !== undefined) this.set('timeout')
    }
    caller.addEventListener('abort', this.onCallerAbort, { once: true })
    this.timer.signal.addEventListener('abort', this.onTimerAbort, { once: true })
    if (caller.aborted) this.onCallerAbort()
    if (this.timer.signal.aborted) this.onTimerAbort()
  }

  /** First cause latched for this operation. */
  get cause(): OperationCause | undefined {
    return this.causeValue
  }

  /** Request an ordinary cancellation. */
  cancel(): void {
    this.set('cancelled')
    this.cancellation.abort()
  }

  /** Request service-disposal cancellation. */
  disposeService(): void {
    this.set('service-disposed')
    this.teardown.abort()
  }

  /** Request cleanup after the exact Session detached. */
  detachSession(): void {
    this.set('session-detached')
    this.teardown.abort()
  }

  /** Release the linked deadline timer. */
  dispose(): void {
    this.caller.removeEventListener('abort', this.onCallerAbort)
    this.timer.signal.removeEventListener('abort', this.onTimerAbort)
    this.timer[Symbol.dispose]()
  }

  private set(cause: OperationCause): void {
    this.causeValue ??= cause
  }
}

/** Active exact-Session lease retained through all operation cleanup. */
export interface RuntimeLease {
  /** Exact Session object, never just its id. */
  readonly session: Session
  /** Fused cancellation and first-cause state. */
  readonly control: OperationControl
  /** Promise fulfilled only after the lease has left active/quarantine state. */
  readonly settlement: Promise<void>
  /** Internal single-settlement completion callback. */
  readonly finishSettlement: () => void
  /** Whether {@link LeaseRegistry.release} already closed this lease. */
  released: boolean
}

/** Non-queuing exact-Session reservation plus same-id replacement quarantine. */
export class LeaseRegistry {
  private readonly exact = new WeakMap<Session, RuntimeLease>()
  private readonly byId = new Map<string, RuntimeLease>()
  private readonly active = new Set<RuntimeLease>()

  /**
   * Reserve an exact Session before any external side effect.
   * @param session - Exact live Session object.
   * @param control - Operation control retained until release.
   * @returns the new lease.
   */
  reserve(session: Session, control: OperationControl): RuntimeLease {
    if (this.exact.has(session) || this.byId.has(String(session.id))) {
      throw new ScienceRuntimeError('RUNTIME_BUSY', 'science runtime already has work for this Session')
    }
    let finishSettlement!: () => void
    const settlement = new Promise<void>((resolve) => { finishSettlement = resolve })
    const lease: RuntimeLease = { session, control, settlement, finishSettlement, released: false }
    this.exact.set(session, lease)
    this.byId.set(String(session.id), lease)
    this.active.add(lease)
    return lease
  }

  /**
   * Release a lease only after its caller established quiescence.
   * @param lease - Exact active lease whose resources and quarantine are complete.
   */
  release(lease: RuntimeLease): void {
    if (lease.released) return
    lease.released = true
    this.exact.delete(lease.session)
    this.byId.delete(String(lease.session.id))
    this.active.delete(lease)
    lease.control.dispose()
    lease.finishSettlement()
  }

  /**
   * Cancel all active work and return every known settlement.
   * @returns Settled results after every active operation releases its lease.
   */
  disposeAll(): Promise<PromiseSettledResult<unknown>[]> {
    const leases = [...this.active]
    for (const lease of leases) lease.control.disposeService()
    return Promise.allSettled(leases.map(lease => lease.settlement))
  }

  /**
   * Cancel every active exact lifecycle whose Session has just detached.
   * @param session - Exact detached Session object; same-ID successors are not affected.
   */
  detach(session: Session): void {
    this.exact.get(session)?.control.detachSession()
  }
}
