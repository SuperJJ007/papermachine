/** Session-local Science targets staged for the main composer. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'

function sameSelection(left: ScienceEditSelection, right: ScienceEditSelection): boolean {
  return left.artifactId === right.artifactId
    && left.version === right.version
    && JSON.stringify(left.target) === JSON.stringify(right.target)
}

/** Owns composer-bound target chips independently of the artifact viewer tabs. */
export class ScienceComposerSelections {
  private readonly stores = new Map<SessionId, SnapshotStore<readonly ScienceEditSelection[]>>()

  /**
   * Resolve the observable target list for one Session.
   * @param sessionId - addressed Session.
   * @returns stable observable target list.
   */
  store(sessionId: SessionId): SnapshotStore<readonly ScienceEditSelection[]> {
    let store = this.stores.get(sessionId)
    if (store === undefined) {
      store = createSnapshotStore<readonly ScienceEditSelection[]>([])
      this.stores.set(sessionId, store)
    }
    return store
  }

  /**
   * Append new unique targets in user selection order.
   * @param sessionId - addressed Session.
   * @param selections - selected exact-version targets.
   */
  add(sessionId: SessionId, selections: readonly ScienceEditSelection[]): void {
    const store = this.store(sessionId)
    const next = [...store.getSnapshot()]
    for (const selection of selections) {
      const index = next.findIndex(candidate => sameSelection(candidate, selection))
      if (index === -1) next.push(selection)
      else next[index] = selection
    }
    store.set(next)
  }

  /**
   * Remove one target by its current list position.
   * @param sessionId - addressed Session.
   * @param index - current target position.
   */
  remove(sessionId: SessionId, index: number): void {
    const store = this.store(sessionId)
    store.set(store.getSnapshot().filter((_, candidate) => candidate !== index))
  }

  /**
   * Remove one exact target regardless of its current list position.
   * @param sessionId - addressed Session.
   * @param selection - exact target to remove.
   */
  removeSelection(sessionId: SessionId, selection: ScienceEditSelection): void {
    const store = this.store(sessionId)
    store.set(store.getSnapshot().filter(candidate => !sameSelection(candidate, selection)))
  }

  /**
   * Clear every staged target for one Session.
   * @param sessionId - addressed Session.
   */
  clear(sessionId: SessionId): void {
    this.store(sessionId).set([])
  }
}
