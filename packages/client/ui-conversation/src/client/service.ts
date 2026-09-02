/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubmitImageAttachment, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ComposerAttachment } from './contract/slots.ts'
import type { QueueAction, QueueItemId } from './contract/queue.ts'
import type { ComposerBlocks } from './contract/input.ts'
import type { SessionInputResolver } from './contract/input.ts'
import type { DraftAttachmentId } from './contract/input.ts'
import type { InputSubmitMode } from './contract/composer-submission.ts'

// Type-only imports: a plugin-to-plugin value import is a bundle purity
// error, so scope resolution goes through the sessions service (scopeOf
// method) instead of the standalone helper.

/** One composer submission before the default prompt transport claims it. */
export interface ComposerSubmission {
  readonly sessionId: SessionId
  readonly text: string
  readonly imageIds: readonly DraftAttachmentId[]
  readonly mode: InputSubmitMode
  readonly signal: AbortSignal | undefined
}

/** A domain handler claims a submission by returning its settlement promise. */
export type ComposerSubmissionHandler = (submission: ComposerSubmission) => Promise<SubmitOutcome> | undefined

/**
 * A main-view Session predicate with its own invalidation signal. `visible`
 * is read fresh on every `viewVisible` query (never cached), and `subscribe`
 * fires whenever a FUTURE `visible` call could answer differently for any
 * Session — the source's own state changed, not necessarily the addressed
 * one — so the tab strip re-lists rather than staying stuck on a stale
 * answer. A registrant whose predicate depends only on immutable Session
 * facts already fixed at registration time may return a no-op disposer.
 */
export interface ViewVisibilitySource {
  /** Whether the view is currently available to this Session. */
  visible(sessionId: SessionId): boolean
  /**
   * Subscribe to a change in what `visible` might answer.
   * @param callback - invoked with no arguments; the caller re-reads `visible` itself.
   * @returns disposer removing this subscription.
   */
  subscribe(callback: () => void): () => void
}

/**
 * A transcript process-detail Session predicate with its own invalidation
 * signal, the same shape as {@link ViewVisibilitySource}. A registrant with
 * its own denser transcript presentation (e.g. Science's folded tool cells
 * and Turn-end artifact groups) reports `false` for a matching Session to
 * hide context-injection rows and turn-timing stats from the chat flow; that
 * detail remains reconstructable from the durable log and, for Session
 * kinds that render one, the Trajectory detailed subview.
 */
export interface TranscriptDetailVisibilitySource {
  /** Whether transcript process-detail chrome currently shows for this Session. */
  visible(sessionId: SessionId): boolean
  /**
   * Subscribe to a change in what `visible` might answer.
   * @param callback - invoked with no arguments; the caller re-reads `visible` itself.
   * @returns disposer removing this subscription.
   */
  subscribe(callback: () => void): () => void
}

/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /**
   * The per-session composer-block registry: how a plugin the composer
   * cannot import makes a session's input inert with its own reason.
   */
  readonly blocks: ComposerBlocks
  /** Register a domain submission handler ahead of the ordinary prompt sink. */
  registerSubmissionHandler(handler: ComposerSubmissionHandler): () => void
  /** Select and reveal one Details entry for an already-mounted Session. */
  openDetailsView(sessionId: SessionId, id: string): void
  /** Toggle the selected Details entry, or select and reveal a different one. */
  toggleDetailsView(sessionId: SessionId, id: string): void
  /** Select one main conversation view for an already-mounted Session. */
  openView(sessionId: SessionId, id: string): void
  /** Select Chat and center one rendered semantic anchor in its scrollport. */
  openChatAt(sessionId: SessionId, anchorKey: string): void
  /** Register a predicate that limits one main view to matching Sessions. */
  registerViewVisibility(id: string, source: ViewVisibilitySource): () => void
  /**
   * Register a predicate that hides transcript process-detail chrome
   * (context-injection rows, turn-timing stats) for matching Sessions.
   * Every registered source must answer `visible` for a Session to keep the
   * chrome shown there; no registrant means it stays shown everywhere.
   */
  registerTranscriptDetailVisibility(source: TranscriptDetailVisibilitySource): () => void
  /**
   * Send a prompt into the caller scope's session (queued turn).
   * @param text - prompt text, sent verbatim as one text block.
   * @returns completion; business failures reject (and land in promptError).
   */
  send(text: string): Promise<void>
  /**
   * Apply one edit, remove, or strict steer operation to a pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns completion; converged strict-steer races resolve, while other failures reject.
   */
  updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void>
  /**
   * Cancel the scoped session's in-flight turn while preserving its pending Queue.
   * @returns completion; failures reject as in send.
   */
  cancel(): Promise<void>
  /**
   * Pull one older history page for the scoped session.
   * @returns completion of the page pull.
   */
  loadOlder(): Promise<void>
}

/** Create one browser-only draft descriptor; only its id enters input state. */
function browserDraftAttachment(file: File): ComposerAttachment {
  return {
    kind: 'image',
    id: crypto.randomUUID() as DraftAttachmentId,
    previewUrl: URL.createObjectURL(file),
    file,
  }
}

interface ImageUrlEntry {
  readonly sessionId: SessionId
  readonly generation: number
  readonly pending: Promise<string>
}

/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported image media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedImageMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service implements IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /** The per-session composer-block registry. */
  readonly blocks: ComposerBlocks
  private readonly draftAttachments = new Map<DraftAttachmentId, ComposerAttachment>()
  private readonly imageUrls = new Map<string, ImageUrlEntry>()
  private readonly imageGenerations = new Map<SessionId, number>()
  private readonly createdImageUrls = new Set<string>()
  private readonly submissionHandlers: ComposerSubmissionHandler[] = []
  private readonly detailsOpeners = new Map<SessionId, (id: string) => void>()
  private readonly detailsTogglers = new Map<SessionId, (id: string) => void>()
  private readonly viewOpeners = new Map<SessionId, (id: string) => void>()
  private readonly chatAnchorOpeners = new Map<SessionId, (anchorKey: string) => void>()
  private readonly pendingChatAnchors = new Map<SessionId, string>()
  private readonly viewVisibility = new Map<string, ViewVisibilitySource>()
  private readonly viewVisibilityDisposers = new Map<string, () => void>()
  /** Bumped whenever any registered {@link ViewVisibilitySource} invalidates; the `views` snapshot in apply.ts. */
  private viewVisibilityVersionCounter = 0
  private readonly viewVisibilitySubscribers = new Set<() => void>()
  private readonly detailVisibilitySources: TranscriptDetailVisibilitySource[] = []
  private readonly detailVisibilityDisposers = new Map<TranscriptDetailVisibilitySource, () => void>()
  private readonly detailVisibilitySubscribers = new Set<() => void>()
  private disposed = false

  /**
   * @param ctx - owning root context (the plugin apply context; the service
   * registers itself and follows that fiber's lifetime).
   * @param config - carries the SessionInputResolver and composer-block registry
   * constructed by the plugin apply (the same instances the slot inject
   * factories close over).
   */
  constructor(ctx: Context, config: { input: SessionInputResolver; blocks: ComposerBlocks }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    ctx.effect(() => () => {
      this.disposed = true
      for (const url of this.createdImageUrls) revokePreview(url)
      this.createdImageUrls.clear()
      this.draftAttachments.clear()
      this.imageUrls.clear()
      this.imageGenerations.clear()
      this.detailsOpeners.clear()
      this.detailsTogglers.clear()
      this.viewOpeners.clear()
      this.chatAnchorOpeners.clear()
      this.pendingChatAnchors.clear()
      this.viewVisibility.clear()
      for (const dispose of this.viewVisibilityDisposers.values()) dispose()
      this.viewVisibilityDisposers.clear()
      this.viewVisibilitySubscribers.clear()
      this.detailVisibilitySources.length = 0
      for (const dispose of this.detailVisibilityDisposers.values()) dispose()
      this.detailVisibilityDisposers.clear()
      this.detailVisibilitySubscribers.clear()
    }, 'conversation attachment URL cache')
  }

  /**
   * Send a prompt into the scoped session. Business failures also land in the
   * session snapshot's promptError (object-layer state); the rejection here
   * exists for caller choreography (the composer restores the draft on it).
   * @param text - prompt text, sent verbatim as one text block.
   */
  async send(text: string): Promise<void> {
    const session = this.scopedSession('send')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Submit ordered draft images with text through one host admission.
   * @param sessionId - target Session id.
   * @param session - target session.
   * @param text - serialized prompt text.
   * @param imageIds - ordered draft-local attachment ids.
   * @param mode - queue or steer delivery selected by composer policy.
   * @param signal - optional cancellation for the complete Host admission.
   * @returns the Host admission outcome; local attachment preparation failures reject.
   */
  async sendSession(
    sessionId: SessionId,
    session: SessionFace,
    text: string,
    imageIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal?: AbortSignal,
  ): Promise<SubmitOutcome> {
    for (const handler of this.submissionHandlers) {
      const claimed = handler({ sessionId, text, imageIds, mode, signal })
      if (claimed !== undefined) return claimed
    }
    if (text === '' && imageIds.length === 0) return { kind: 'success' }
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.sendSession: one or more draft images are no longer available')
    }
    const uploaded = await this.serializeImages(attachments.map(attachment => attachment.file))
    const content = [...uploaded, ...(text === '' ? [] : [{ type: 'text' as const, text }])]
    const result = await session.prompt(content, mode, signal)
    if (!result.ok) return { kind: 'error' }
    this.releaseDraftImages(attachments)
    return { kind: 'success' }
  }

  /** Register one ordered composer submission claimant. */
  registerSubmissionHandler(handler: ComposerSubmissionHandler): () => void {
    this.submissionHandlers.push(handler)
    return () => {
      const index = this.submissionHandlers.indexOf(handler)
      if (index >= 0) this.submissionHandlers.splice(index, 1)
    }
  }

  /**
   * Bind the current Details router actions for one mounted Session.
   * @param sessionId - mounted Session.
   * @param opener - current Details route action.
   * @returns disposer that removes this exact binding.
   */
  bindDetailsOpener(sessionId: SessionId, opener: (id: string) => void): () => void {
    this.detailsOpeners.set(sessionId, opener)
    return () => {
      if (this.detailsOpeners.get(sessionId) === opener) this.detailsOpeners.delete(sessionId)
    }
  }

  /** Select one Details route and reveal the column. */
  openDetailsView(sessionId: SessionId, id: string): void {
    const open = this.detailsOpeners.get(sessionId)
    open?.(id)
  }

  /** Toggle one Details route through its mounted Session header. */
  toggleDetailsView(sessionId: SessionId, id: string): void {
    this.detailsTogglers.get(sessionId)?.(id)
  }

  /**
   * Bind the current Details toggle semantics for one mounted Session.
   * @param sessionId - mounted Session.
   * @param toggle - current Details route toggle action.
   * @returns disposer that removes this exact binding.
   */
  bindDetailsToggler(sessionId: SessionId, toggle: (id: string) => void): () => void {
    this.detailsTogglers.set(sessionId, toggle)
    return () => {
      if (this.detailsTogglers.get(sessionId) === toggle) this.detailsTogglers.delete(sessionId)
    }
  }

  /**
   * Bind the current main-view router action for one mounted Session.
   * @param sessionId - mounted Session.
   * @param opener - current main-view route action.
   * @returns disposer that removes this exact binding.
   */
  bindViewOpener(sessionId: SessionId, opener: (id: string) => void): () => void {
    this.viewOpeners.set(sessionId, opener)
    return () => {
      if (this.viewOpeners.get(sessionId) === opener) this.viewOpeners.delete(sessionId)
    }
  }

  /** Select one main conversation view. */
  openView(sessionId: SessionId, id: string): void {
    this.viewOpeners.get(sessionId)?.(id)
  }

  /** Select Chat and hand one semantic anchor to its mounted scroll owner. */
  openChatAt(sessionId: SessionId, anchorKey: string): void {
    this.pendingChatAnchors.set(sessionId, anchorKey)
    this.openView(sessionId, 'chat')
    const open = this.chatAnchorOpeners.get(sessionId)
    if (open === undefined) return
    this.pendingChatAnchors.delete(sessionId)
    open(anchorKey)
  }

  /**
   * Bind the mounted Chat view's semantic-anchor action.
   * @param sessionId - mounted Session.
   * @param opener - Chat-owned scroll action.
   * @returns disposer that removes this exact binding.
   */
  bindChatAnchorOpener(sessionId: SessionId, opener: (anchorKey: string) => void): () => void {
    this.chatAnchorOpeners.set(sessionId, opener)
    const pending = this.pendingChatAnchors.get(sessionId)
    if (pending !== undefined) {
      this.pendingChatAnchors.delete(sessionId)
      opener(pending)
    }
    return () => {
      if (this.chatAnchorOpeners.get(sessionId) === opener) this.chatAnchorOpeners.delete(sessionId)
    }
  }

  /** Register one main-view Session predicate. */
  registerViewVisibility(id: string, source: ViewVisibilitySource): () => void {
    if (this.viewVisibility.has(id)) throw new Error(`conversation view visibility already registered: ${id}`)
    this.viewVisibility.set(id, source)
    this.viewVisibilityDisposers.set(id, source.subscribe(() => {
      this.viewVisibilityVersionCounter += 1
      for (const callback of this.viewVisibilitySubscribers) callback()
    }))
    return () => {
      if (this.viewVisibility.get(id) !== source) return
      this.viewVisibility.delete(id)
      this.viewVisibilityDisposers.get(id)?.()
      this.viewVisibilityDisposers.delete(id)
    }
  }

  /**
   * Resolve whether one registered main view is available to an addressed Session.
   * @param sessionId - addressed Session.
   * @param id - main-view id.
   * @returns `true` when no predicate rejects the view for this Session.
   */
  viewVisible(sessionId: SessionId, id: string): boolean {
    return this.viewVisibility.get(id)?.visible(sessionId) ?? true
  }

  /**
   * Subscribe to every registered {@link ViewVisibilitySource}'s invalidation,
   * present and future — apply.ts's `views.subscribe` folds this in beside the
   * `conversation.view` slot ledger, so a tab strip re-lists when a source's
   * answer changes for reasons the slot ledger itself never sees (a session
   * list update, a projection update).
   * @param callback - invoked with no arguments on any source's invalidation.
   * @returns disposer removing this subscription.
   */
  subscribeViewVisibility(callback: () => void): () => void {
    this.viewVisibilitySubscribers.add(callback)
    return () => { this.viewVisibilitySubscribers.delete(callback) }
  }

  /**
   * Monotonic counter bumped on every registered source's invalidation; part of the `views` snapshot.
   * @returns the current counter value.
   */
  viewVisibilityVersion(): number {
    return this.viewVisibilityVersionCounter
  }

  /** Register one transcript process-detail Session predicate. */
  registerTranscriptDetailVisibility(source: TranscriptDetailVisibilitySource): () => void {
    this.detailVisibilitySources.push(source)
    this.detailVisibilityDisposers.set(source, source.subscribe(() => {
      for (const callback of this.detailVisibilitySubscribers) callback()
    }))
    return () => {
      const index = this.detailVisibilitySources.indexOf(source)
      if (index < 0) return
      this.detailVisibilitySources.splice(index, 1)
      this.detailVisibilityDisposers.get(source)?.()
      this.detailVisibilityDisposers.delete(source)
    }
  }

  /**
   * Resolve whether transcript process-detail chrome shows for an addressed Session.
   * @param sessionId - addressed Session.
   * @returns `true` when every registered source answers `visible` (including none registered).
   */
  transcriptDetailVisible(sessionId: SessionId): boolean {
    return this.detailVisibilitySources.every(source => source.visible(sessionId))
  }

  /**
   * Subscribe to every registered {@link TranscriptDetailVisibilitySource}'s
   * invalidation, present and future.
   * @param callback - invoked with no arguments on any source's invalidation.
   * @returns disposer removing this subscription.
   */
  subscribeTranscriptDetailVisibility(callback: () => void): () => void {
    this.detailVisibilitySubscribers.add(callback)
    return () => { this.detailVisibilitySubscribers.delete(callback) }
  }

  /**
   * Create runtime-only draft images and their object URLs.
   * @param files - browser files to register after MIME validation.
   * @returns ordered draft descriptors.
   */
  createDraftImages(files: readonly File[]): readonly ComposerAttachment[] {
    for (const file of files) imageMediaType(file.type)
    return files.map((file) => {
      const attachment = browserDraftAttachment(file)
      this.draftAttachments.set(attachment.id, attachment)
      this.createdImageUrls.add(attachment.previewUrl)
      return attachment
    })
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft images.
   * @param ids - draft attachment ids.
   * @returns descriptors that remain live, in requested order.
   */
  draftImages(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[] {
    const attachments: ComposerAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment !== undefined) attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Serialize ordered draft images to command-submit wire payloads without
   * sending or releasing them (the composer releases only after the command
   * settles successfully).
   * @param imageIds - ordered draft-local attachment ids.
   * @returns base64 payloads in id order.
   */
  async serializeDraftImages(imageIds: readonly DraftAttachmentId[]): Promise<readonly SubmitImageAttachment[]> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.serializeDraftImages: one or more draft images are no longer available')
    }
    return Promise.all(attachments.map(attachment => this.encodeImage(attachment.file)))
  }

  /**
   * Release one browser-owned draft image and preview URL.
   * @param id - draft attachment id.
   */
  releaseDraftImage(id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment === undefined) return
    this.draftAttachments.delete(id)
    this.createdImageUrls.delete(attachment.previewUrl)
    revokePreview(attachment.previewUrl)
  }

  /**
   * Release a set of browser-owned draft images.
   * @param attachments - descriptors to release.
   */
  releaseDraftImages(attachments: readonly ComposerAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftImage(attachment.id)
  }

  /**
   * Resolve and cache one session-authorized historical image URL.
   * @param sessionId - owning session authorization scope.
   * @param attachment - durable image reference.
   * @returns browser URL valid until its rendered session is released.
   */
  resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('conversation.resolveImage: service is disposed'))
    const key = `${sessionId}:${attachment.attachmentId}`
    const cached = this.imageUrls.get(key)
    if (cached !== undefined) return cached.pending
    const generation = this.imageGenerations.get(sessionId) ?? 0
    const session = this.requireSessions().binding(sessionId)?.session
    if (session === undefined) {
      return Promise.reject(new Error(`conversation.resolveImage: unknown session "${sessionId}"`))
    }
    const pending = session.readAttachment(attachment.attachmentId)
      .then((result) => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (this.disposed) throw new Error('conversation.resolveImage: service was disposed before loading completed')
        if ((this.imageGenerations.get(sessionId) ?? 0) !== generation) {
          throw new Error('historical image scope was released before loading completed')
        }
        if (typeof URL.createObjectURL !== 'function') {
          return `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`
        }
        const bytes = Uint8Array.from(result.value.data)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
        this.createdImageUrls.add(url)
        return url
      })
      .catch((error: unknown) => {
        if (this.imageUrls.get(key)?.generation === generation) this.imageUrls.delete(key)
        throw error
      })
    this.imageUrls.set(key, { sessionId, generation, pending })
    return pending
  }

  /**
   * Release every historical image URL owned by one rendered session.
   * @param sessionId - rendered session scope.
   */
  releaseSessionImages(sessionId: SessionId): void {
    this.imageGenerations.set(sessionId, (this.imageGenerations.get(sessionId) ?? 0) + 1)
    for (const [key, entry] of this.imageUrls) {
      if (entry.sessionId !== sessionId) continue
      this.imageUrls.delete(key)
      void entry.pending.then((url) => {
        if (!this.createdImageUrls.delete(url)) return
        revokePreview(url)
      }, () => {
        // A failed or invalidated load owns no object URL.
      })
    }
  }

  /** Apply one operation to a pending queue occurrence. */
  async updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void> {
    const session = this.scopedSession('updateQueue')
    const result = await session.updateQueue(itemId, action)
    if (!result.ok) {
      if (
        action.kind === 'steer'
        && (result.error.code === 'steer-unavailable' || result.error.code === 'queue-item-not-found')
      ) return
      throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
  async cancel(): Promise<void> {
    const session = this.scopedSession('cancel')
    const result = await session.cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Pull one older history page for the scoped Session. */
  async loadOlder(): Promise<void> {
    await this.scopedSession('loadOlder').loadOlder()
  }

  /** Resolve the caller scope's session face or throw on root contexts. */
  private scopedSession(op: string): SessionFace {
    const id = this.scopeId(op)
    const binding = this.requireSessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.${op}: session "${id}" resolved no binding`)
    return binding.session
  }

  /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
  private scopeId(op: string): SessionId {
    const id = this.requireSessions().scopeOf(this.ctx)
    if (id === undefined) {
      throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`)
    }
    return id
  }

  private requireSessions(): ISessions {
    // Strict ctx.get, not the injection proxy: the scope-addressed pattern
    // reads the service off whatever context the tracker rebound.
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('conversation: sessions service unavailable')
    return sessions
  }

  /** Convert browser files to canonical base64 prompt parts. */
  private serializeImages(images: readonly File[]): Promise<Parameters<SessionFace['prompt']>[0]> {
    return Promise.all(images.map(async file => ({ type: 'image' as const, ...await this.encodeImage(file) })))
  }

  /** Canonical base64 wire form of one browser image file. */
  private async encodeImage(file: File): Promise<SubmitImageAttachment> {
    return {
      mediaType: imageMediaType(file.type),
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(file.name === '' ? {} : { name: file.name }),
    }
  }
}

function imageMediaType(value: string): ImageMediaType {
  switch (value) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return value
    default:
      throw new UnsupportedImageMediaTypeError(value)
  }
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
