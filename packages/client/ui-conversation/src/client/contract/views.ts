/** Shared conversation view, selection, and store-state contracts. */

/** Tool call identity as carried on the wire (branded upstream in connection). */
export type CallId = string

/** Selection target for the details linkage channel (toolcall is the step special case). */
export interface SelectionTarget { turnSeq: number; stepSeq?: number; callId?: CallId; toolName?: string }

/**
 * One conversation view tab, projected from a 'conversation.view' slot
 * entry's registration options (label falls back to the entry id).
 */
export interface ViewTab { id: string; label: string }

/**
 * One routed Details entry, projected from a 'conversation.details.view'
 * slot entry's registration options (label falls back to the entry id).
 */
export interface DetailsViewEntry {
  id: string
  label: string
  /**
   * Whether this entry declared itself the slot's default (`primary: true`
   * at registration — at most one entry ever carries it, see
   * {@link SlotCore.register} in ui-slots). `resolveActiveDetailsView`
   * (DetailsPanel.tsx) selects it when the session has no explicit
   * `detailsView` selection; the built-in `tool` entry remains the final
   * fallback when no entry declares primary.
   */
  primary: boolean
}

/**
 * Per-session state shared by conversation, chat-view, and details slots.
 * Unknown persisted view ids fall back to the stable Chat view.
 */
export interface ChatStoreState {
  /** Details-linkage channel (conversation writes, details reads). */
  selection: SelectionTarget | null
  /** Composer draft (persisted; survives session switches and reloads). */
  draft: string
  /** Active conversation view id ('conversation.view' entry id); null falls back to Chat. */
  view: string | null
  /**
   * One-shot inspect handoff: chat writes the call to reveal, the trajectory
   * view consumes it and acknowledges by clearing. Read with `?? null` —
   * persisted snapshots from before this field rehydrate without it.
   */
  inspect: { callId: CallId } | null
  /**
   * Active Details entry id ('conversation.details.view' entry id); null
   * falls back to the registered `primary` entry, or the built-in `tool`
   * entry when none is primary.
   */
  detailsView: string | null
}
