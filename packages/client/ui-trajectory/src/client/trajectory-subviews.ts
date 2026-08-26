/** Trajectory subview registration contracts and per-session visibility. */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One selectable implementation inside the Trajectory conversation tab. */
    'trajectory.view': { kind: 'list'; scope: 'session'; owner: ConvViewOwnerProps }
  }
}

/** A subview predicate with the invalidation signal needed by the tab strip. */
export interface TrajectoryViewVisibilitySource {
  /** Whether the subview is available to one Session. */
  visible(sessionId: SessionId): boolean
  /** Subscribe to changes that can alter a later {@link visible} result. */
  subscribe(callback: () => void): () => void
}

/** Directory entry projected from the `trajectory.view` slot ledger. */
export interface TrajectorySubviewEntry {
  readonly id: string
  readonly label: string
  readonly order: number
}

/** Visibility registry shared with plugins contributing Trajectory subviews. */
export class TrajectorySubviewRegistry {
  private readonly sources = new Map<string, TrajectoryViewVisibilitySource>()
  private readonly listeners = new Set<() => void>()
  private readonly selections = new Map<SessionId, string>()
  private revision = 0

  /**
   * Register the sole visibility owner for one subview id.
   * @param id Stable subview identifier.
   * @param source Session visibility predicate and invalidation signal.
   * @returns Disposer for the registration.
   */
  registerVisibility(id: string, source: TrajectoryViewVisibilitySource): () => void {
    if (this.sources.has(id)) throw new Error(`ui-trajectory: visibility for "${id}" is already registered`)
    this.sources.set(id, source)
    const unsubscribe = source.subscribe(() => { this.changed() })
    this.changed()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      this.sources.delete(id)
      this.changed()
    }
  }

  /**
   * Test whether a subview is available; entries without a predicate are universal.
   * @param sessionId Addressed Session.
   * @param id Stable subview identifier.
   * @returns Whether the subview is available.
   */
  visible(sessionId: SessionId, id: string): boolean {
    return this.sources.get(id)?.visible(sessionId) ?? true
  }

  /**
   * Select one subview for the addressed Session.
   * @param sessionId Addressed Session.
   * @param id Stable subview identifier.
   */
  select(sessionId: SessionId, id: string): void {
    if (this.selections.get(sessionId) === id) return
    this.selections.set(sessionId, id)
    this.changed()
  }

  /**
   * Read the selected subview id, or null for the ordered default.
   * @param sessionId Addressed Session.
   * @returns Selected subview id or null.
   */
  selection(sessionId: SessionId): string | null {
    return this.selections.get(sessionId) ?? null
  }

  /**
   * Subscribe to registry or predicate invalidations.
   * @param callback Listener invoked after a registry revision.
   * @returns Subscription disposer.
   */
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }

  /**
   * Read the monotonic snapshot used by React external-store consumers.
   * @returns Current registry revision.
   */
  version(): number { return this.revision }

  private changed(): void {
    this.revision++
    for (const listener of this.listeners) listener()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Directory controlling availability of contributed Trajectory subviews. */
    trajectorySubviews: TrajectorySubviewRegistry
  }
}
