/** Composer data, public actions, and session input facade declarations. */
import type { ClientContext, SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ArbitrateKey, ArbitrateOutcome, CommandClaim, ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { QueueRow } from './queue.ts'
import type { InputSubmitMode } from './composer-submission.ts'

/** Why one session's composer is inert. */
export interface ComposerBlock {
  /**
   * Localized placeholder replacing the composer's own, owned by the plugin
   * that raised the block.
   */
  readonly reason: string
}

/** The registry face other plugins reach through `ctx.conversation.blocks`. */
export interface ComposerBlocks {
  /**
   * Raise or clear this session's block. Idempotent: setting a block equal to
   * the current one, or clearing an absent one, notifies nobody.
   * @param sessionId - the session whose composer is affected.
   * @param block - the block to raise, or undefined to clear it.
   */
  set(sessionId: SessionId, block: ComposerBlock | undefined): void
  /**
   * The store the composer subscribes to for one session. Created on first
   * read from either side, so a blocker may raise a block before the session's
   * composer mounts and the composer still sees it.
   * @param sessionId - the session to observe.
   * @returns that session's block store (undefined value = not blocked).
   */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerBlock | undefined>
  /**
   * Drop one session's store. The session scope's disposer calls this; a
   * blocker never needs to.
   * @param sessionId - the session being torn down.
   */
  forget(sessionId: SessionId): void
}

/** Browser-runtime identity of one unsent image draft. */
export type DraftAttachmentId = Branded<'DraftAttachmentId'>

/**
 * The public input action face provided to every session-scope slot
 * component: two stable-identity void callbacks, mirroring the
 * useStore+actions convention. Command-style handles (track/arbitrate/space/
 * undo/paste/…) stay InputBar-private and never ride this face.
 */
export interface InputActions {
  /** Single public draft write path (full next draft; occurrence math via diff scan). */
  setDraft(text: string): void
  /** Append ordered browser-owned image ids; busy admission phases refuse. */
  addImages(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned image id; busy admission phases refuse. */
  removeImage(id: DraftAttachmentId): void
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneImages(ids: readonly DraftAttachmentId[]): void
  /** Enter submission (adjudication / claim transaction / default sink inside). */
  submit(): void
}

/** One surfaced notice (command results, adjudication failures). seq keys re-render of repeats. */
export interface InputNotice {
  readonly level: 'info' | 'error'
  readonly text: string
  readonly seq: number
}

/**
 * The InputBar-exclusive keyboard/DOM command face: synchronous
 * returns and event-handler semantics that must not enter the public provide
 * channel. Handed to the composer-bar entry through its own inject —
 * package-internal, never across a plugin boundary. The session shell
 * satisfies it structurally.
 */
export interface ComposerKeyboard {
  /** Live machine state for event-handler reads (render reads go through useInput). */
  readonly snapshot: InputState
  /** Draft write with the DOM-observed edit shape (narrows occurrence math). */
  setDraft(text: string, editRange?: EditRange): void
  /** Submit with an explicit delivery mode resolved by the keyboard policy. */
  submit(mode: InputSubmitMode): void
  /**
   * Steer every still-pending queued message into the running turn (the
   * empty-draft accelerated-Enter gesture; the queue dock's per-row steer
   * button is the same operation applied to the whole queue).
   */
  steerQueue(): void
  undo(): void
  redo(): void
  /** Paste over the selection (sync components ride the same transaction). */
  pasteBegin(text: string, selection: EditSelection, components?: readonly PasteComponent[], generation?: number): void
  /** Caret/selection gestures the machine cannot observe end the paste attempt. */
  invalidatePaste(): void
  /** Feed a draft/caret change through trigger detection (guard derived from phase). */
  track(draft: string, caret: number): void
  /** Keyboard arbitration while the menu is open ('pass' when no pipeline). */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome
  /** Space adjudication; true = the input applied a claim — caller preventDefaults. */
  space(): boolean
  /** Dismiss the popupSelect shell (any interaction outside the box). */
  dismissPopup(): void
}

/** One independently addressable row projected from the transient queue snapshot. */
export type QueuedMessage = QueueRow

/** Half-open [start, end) range/selection in draft character coordinates. */
export interface EditSelection {
  readonly start: number
  readonly end: number
}

/**
 * One edit applied to the previous draft: [start, end) in the PREVIOUS
 * draft's coordinates was replaced by insertedLength characters. Supplied by
 * the wiring layer when the DOM event exposes the edit shape; absent, the
 * machine recovers it with a prefix/suffix common-scan diff.
 */
export interface EditRange extends EditSelection {
  readonly insertedLength: number
}

/**
 * One reference occurrence backed by its complete inline display text in the
 * draft. Identity is occurrenceId — same-named
 * references stay independently addressable. label/appearance/clipboardText are the
 * owner's insert-time projections, cached so the chip survives owner loss
 * (invalid flips instead of dropping the occurrence).
 */
export interface Occurrence {
  /** Machine-minted stable identity (monotonic per machine). */
  readonly occurrenceId: number
  /** Owning source name (serializer routing key). */
  readonly source: string
  /** Owner-scoped reference id. */
  readonly ref: string
  /** Display-text offset in the draft. */
  readonly offset: number
  /** Display-text length; the occurrence occupies exactly [offset, offset+length). */
  readonly length: number
  /** Inline display label (insert-time cache). */
  readonly label: string
  /** Optional domain glyph (insert-time cache). */
  readonly appearance?: ReferenceInsert['appearance']
  /** Clipboard / persistence projection, e.g. `/name` (insert-time cache, never the model form). */
  readonly clipboardText: string
  /** Owner-resolution failure flag: chip renders invalid; serialization must fail. */
  readonly invalid?: boolean
}

/** One sync-matched paste component; start/end are relative to the pasted text. */
export interface PasteComponent extends EditSelection {
  readonly reference: ReferenceInsert
}

/**
 * Live paste-match attempt published while async matching may still upgrade
 * pasted tokens (the clipboard round-trip). Any non-paste transaction,
 * submit start, invalidate-paste, or release ends it; a paste-upgrade keeps
 * it current (later tokens re-CAS against the advanced draftRev).
 */
export interface PasteAttemptState {
  /** Machine-minted attempt identity (paste-upgrade must match it). */
  readonly attemptId: number
  /** Pasted range in the draft as of the paste transaction. */
  readonly insertedRange: EditSelection
  /** Caller-supplied projection generation echoed back (the controller drops cross-generation results). */
  readonly generation: number
}

/** Published input state (the currency; per-session). */
export interface InputState {
  readonly draft: string
  /** Ordered runtime-only image ids; bytes and URLs stay in ConversationController. */
  readonly imageIds: readonly DraftAttachmentId[]
  /** Monotonic draft revision (span CAS compares against this). */
  readonly draftRev: number
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  /** Present exactly while claimed/submitting (claim snapshot during flight; submit closure withheld). */
  readonly claim?: { readonly token: string; readonly hint?: string; readonly images?: boolean }
  /** Reference occurrence table, sorted by offset. */
  readonly occurrences: readonly Occurrence[]
  /** Live paste-match attempt (absent when no paste is matchable). */
  readonly paste?: PasteAttemptState
  /** Read-only transient inbox projection (`session/queue`, including pending steering). */
  readonly queue: readonly QueuedMessage[]
}

/**
 * The scoped-event application verbs: the hub's bail listeners call these,
 * and the boolean answer IS the event's bail value (true ⟺ the machine
 * accepted after phase and span/bare-token guards).
 */
export interface InputTarget {
  /** Replace the trigger span with claim.token and enter claimed (span-CAS'd). */
  beginCommand(claim: CommandClaim, span: TokenSpan): boolean
  /** Replace the trigger span with one reference occurrence (span-CAS'd). */
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean
}

/** Per-session input facade owned by the conversation wiring layer. */
export interface SessionInput extends InputTarget {
  /** Single write path for draft text (all mutation rides machine events). */
  setDraft(text: string): void
  /** Append ordered browser-owned image ids; busy admission phases refuse. */
  addImages(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned image id; busy admission phases refuse. */
  removeImage(id: DraftAttachmentId): void
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneImages(ids: readonly DraftAttachmentId[]): void
  /**
   * THE complexity sink: enter adjudication, submit transaction, and the default sink live inside.
   * @param mode - delivery intent retained through asynchronous adjudication and serialization.
   */
  submit(mode?: InputSubmitMode): void
  /**
   * Surface a notice outside the machine's own effect stream: detached
   * command results and business notifications render through here.
   * Session-routed — resolving the facade via SessionInputResolver.for(actx) lands
   * the notice on that session's composer, so a result arriving after a
   * session switch still reaches its own session.
   * @param level - severity tier.
   * @param text - notice body.
   */
  notify(level: 'info' | 'error', text: string): void
  /** Input state store (InputZone currency + decorations read here). */
  readonly state: SnapshotStore<InputState>
}

/** Session-addressed access to the per-session input facade. */
export interface SessionInputResolver {
  /** Resolve the facade for one session-scope ctx. */
  for(actx: ClientContext): SessionInput
}
