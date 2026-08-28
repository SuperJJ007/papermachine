/** Host admission for artifact-viewer edit gestures. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { assertNever, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-science-artifact-store'
import { applyScienceArtifactNotes, foldScience, MAX_SCIENCE_ARTIFACT_NOTE_LENGTH } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactNotesProjection, ScienceArtifactVersion } from '@deepseek-ai/dsh-science-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ScienceEditErrorCode,
  ScienceArtifactNoteAddRequest,
  ScienceArtifactNoteReceipt,
  ScienceArtifactNoteRemoveRequest,
  ScienceEditMessageSource,
  ScienceEditReceipt,
  ScienceEditRequest,
  ScienceEditSelection,
  ScienceEditTarget,
  ScienceStyleEditReceipt,
  ScienceStyleEditRequest,
} from './types.ts'

const SPEC_PATH = /^(?:[A-Za-z_$][A-Za-z0-9_$-]*|[0-9]+)(?:\.(?:[A-Za-z_$][A-Za-z0-9_$-]*|[0-9]+))*$/

/** Admission error with a stable Science edit classification. */
export class ScienceEditError extends HarnessError {
  /** @param message - safe rejection explanation. @param code - stable rejection class. */
  // oxlint-disable-next-line typescript/no-useless-constructor -- narrows the inherited code type
  constructor(message: string, code: ScienceEditErrorCode) {
    super(message, code)
  }
}

function invalid(message: string): never {
  throw new ScienceEditError(message, 'SCIENCE_EDIT_INVALID_REQUEST')
}

/** Validate and detach one viewer-supplied target. */
function resolveTarget(target: ScienceEditTarget): ScienceEditTarget {
  switch (target.kind) {
    case 'spec-path': {
      const path = target.path.trim()
      if (!SPEC_PATH.test(path)) invalid('Science edit spec path must be a non-empty dot-separated structural path')
      return { kind: 'spec-path', path }
    }
    case 'normalized-region': {
      const values = [target.x, target.y, target.width, target.height]
      if (!values.every(Number.isFinite)
        || target.x < 0 || target.y < 0 || target.width <= 0 || target.height <= 0
        || target.x + target.width > 1 || target.y + target.height > 1) {
        invalid('Science edit region must be a positive rectangle within normalized coordinates 0 through 1')
      }
      return { ...target }
    }
    /* v8 ignore next 2 -- closed target union; wire validation and compilation reject another tag */
    default: assertNever(target, 'science edit target')
  }
}

/**
 * Validate one free-text field shared by the top-level instruction and a
 * per-target comment. `subject` names which field failed, so a rejected
 * empty comment does not read as a rejected empty instruction.
 * @param value - raw text from the viewer.
 * @param subject - the field name to quote in the rejection.
 * @returns the trimmed, validated text.
 */
function resolveFreeText(value: string, subject: string): string {
  const text = value.trim()
  if (text.length === 0 || text.includes('\u0000') || !text.isWellFormed()) {
    invalid(`Science edit ${subject} must be non-empty, well-formed Unicode without U+0000`)
  }
  return text
}

/** Validated material needed to construct one Science edit message. */
export interface ResolvedScienceEdit {
  readonly targets: readonly {
    readonly artifact: ScienceArtifactVersion
    readonly target: ScienceEditTarget
    readonly comment?: string
  }[]
  readonly instruction: string
}

function resolveSelection(
  artifacts: readonly ScienceArtifactVersion[], request: ScienceEditSelection,
): ResolvedScienceEdit['targets'][number] {
  const versions = artifacts.filter(artifact => artifact.artifactId === request.artifactId)
  const latest = versions.at(-1)
  if (latest === undefined) {
    throw new ScienceEditError(
      `Science edit target ${JSON.stringify(request.artifactId)}@${String(request.version)} does not identify a committed artifact`,
      'SCIENCE_EDIT_TARGET_NOT_FOUND',
    )
  }
  if (request.version !== latest.version) {
    throw new ScienceEditError(
      `Science edit target ${JSON.stringify(request.artifactId)}@${String(request.version)} does not match the current committed version ${String(latest.version)}`,
      'SCIENCE_EDIT_STALE_VERSION',
    )
  }
  const target = resolveTarget(request.target)
  const comment = request.comment === undefined ? undefined : resolveFreeText(request.comment, 'target comment')
  assertTargetMatches(latest, target)
  return { artifact: latest, target, ...comment === undefined ? {} : { comment } }
}

/**
 * Resolve one multi-target request against the authoritative committed artifact history.
 * @param artifacts - strictly folded committed versions for the addressed session.
 * @param request - exact version, selected target, and instruction from the viewer.
 * @returns detached targets and instruction beside the authoritative artifact versions.
 */
export function resolveScienceEdit(
  artifacts: readonly ScienceArtifactVersion[], request: ScienceEditRequest,
): ResolvedScienceEdit {
  const instruction = resolveFreeText(request.instruction, 'instruction')
  if (request.targets.length === 0) invalid('Science edit request must select at least one target')
  const selections = new Map<string, { version: number; targets: Set<string> }>()
  for (const [index, selection] of request.targets.entries()) {
    const existing = selections.get(selection.artifactId)
    if (existing !== undefined && existing.version !== selection.version) {
      invalid(`Science edit target ${String(index + 1)} selects a second version of artifact ${JSON.stringify(selection.artifactId)}`)
    }
    const targetKey = JSON.stringify(selection.target)
    if (existing?.targets.has(targetKey) === true) {
      invalid(`Science edit target ${String(index + 1)} duplicates an earlier target`)
    }
    if (existing === undefined) {
      selections.set(selection.artifactId, { version: selection.version, targets: new Set([targetKey]) })
    } else {
      existing.targets.add(targetKey)
    }
  }
  const targets = request.targets.map((selection, index) => {
    try {
      return resolveSelection(artifacts, selection)
    } catch (error: unknown) {
      if (!(error instanceof ScienceEditError)) throw error
      throw new ScienceEditError(`Science edit target ${String(index + 1)}: ${error.message}`, error.code as ScienceEditErrorCode)
    }
  })
  return { targets, instruction }
}

function resolveCurrentArtifact(
  artifacts: readonly ScienceArtifactVersion[], artifactId: ScienceStyleEditRequest['artifactId'], version: number,
): ScienceArtifactVersion {
  const versions = artifacts.filter(artifact => artifact.artifactId === artifactId)
  const latest = versions.at(-1)
  if (latest === undefined) {
    throw new ScienceEditError(
      `Science edit target ${JSON.stringify(artifactId)}@${String(version)} does not identify a committed artifact`,
      'SCIENCE_EDIT_TARGET_NOT_FOUND',
    )
  }
  if (version !== latest.version) {
    throw new ScienceEditError(
      `Science edit target ${JSON.stringify(artifactId)}@${String(version)} does not match the current committed version ${String(latest.version)}`,
      'SCIENCE_EDIT_STALE_VERSION',
    )
  }
  if (latest.mediaType !== 'image/png') {
    throw new ScienceEditError('Science style edits require a Vega-Lite artifact', 'SCIENCE_EDIT_TARGET_MISMATCH')
  }
  return latest
}

function parseStyleSpec(spec: string): Record<string, unknown> {
  if (!spec.isWellFormed() || spec.includes('\u0000')) {
    throw new ScienceEditError('Science style edit spec must be well-formed JSON text without U+0000', 'SCIENCE_EDIT_SPEC_INVALID')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(spec)
  } catch {
    throw new ScienceEditError('Science style edit spec must be valid JSON', 'SCIENCE_EDIT_SPEC_INVALID')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ScienceEditError('Science style edit spec must be a JSON object', 'SCIENCE_EDIT_SPEC_INVALID')
  }
  return parsed as Record<string, unknown>
}

function assertTargetMatches(artifact: ScienceArtifactVersion, target: ScienceEditTarget): void {
  if (target.kind === 'spec-path' && artifact.mediaType !== 'image/png') {
    throw new ScienceEditError('Science spec-path edits require a Vega-Lite artifact', 'SCIENCE_EDIT_TARGET_MISMATCH')
  }
  if (target.kind === 'normalized-region' && artifact.mediaType !== 'image/png') {
    throw new ScienceEditError('Science region edits require a raster image artifact', 'SCIENCE_EDIT_TARGET_MISMATCH')
  }
}

/**
 * Render the exact-version edit instruction sent to the model.
 * @param targets - authoritative immutable versions and validated selections.
 * @param instruction - validated user instruction.
 * @returns model-visible exact-version edit text.
 */
export function renderScienceEditMessage(
  targets: readonly {
    readonly artifact: Pick<ScienceArtifactVersion, 'artifactId' | 'version' | 'logicalName'>
    readonly target: ScienceEditTarget
    readonly comment?: string
  }[],
  instruction: string,
): string {
  const selections = targets.map(({ artifact, target, comment }) => {
    const selected = target.kind === 'spec-path'
      ? target.path
      : `region(${String(target.x)},${String(target.y)},${String(target.width)},${String(target.height)})`
    const note = comment === undefined ? '' : `:${JSON.stringify(comment)}`
    return `- ${artifact.logicalName} v${String(artifact.version)} · ${selected}${note}`
  })
  const versions = [...new Map(targets.map(({ artifact }) => [artifact.artifactId, artifact])).values()]
    .map(artifact => `- ${artifact.artifactId} v${String(artifact.version)}`)
  return [
    'Edit these Science artifact targets:',
    ...selections,
    `Instruction: ${instruction}`,
    'Use exactly these artifact versions as artifact_inputs sources and as edit_of parents for the corresponding edited outputs; do not substitute newer versions:',
    ...versions,
  ].join('\n')
}

/**
 * Construct the durable structured user message for one admitted edit. A
 * region target's selected raster rides the message as an ordinary image
 * attachment (model-visible ⟺ logged), minted by the caller from the store's
 * bytes and keyed here by the target version's store `versionId`.
 * @param resolved - authoritative artifact and validated request fields.
 * @param regionImages - message image attachment per region-targeted store version id.
 * @returns user message carrying both the readable instruction and structured source.
 */
export function createScienceEditMessage(
  resolved: ResolvedScienceEdit,
  regionImages: ReadonlyMap<string, ImageAttachmentRef> = new Map(),
): UserMessage {
  const { targets, instruction } = resolved
  const source: ScienceEditMessageSource = {
    kind: 'science-edit',
    targets: targets.map(({ artifact, target, comment }) => ({
      artifactId: artifact.artifactId,
      version: artifact.version,
      target,
      ...comment === undefined ? {} : { comment },
    })),
    instruction,
  }
  const attachedVersionIds = new Set<string>()
  return createUserMessage({
    source,
    content: [
      { type: 'text', text: renderScienceEditMessage(targets, instruction) },
      ...targets.flatMap(({ artifact, target }) => {
        if (target.kind !== 'normalized-region') return []
        const key = String(artifact.versionId)
        if (attachedVersionIds.has(key)) return []
        attachedVersionIds.add(key)
        const attachment = regionImages.get(key)
        if (attachment === undefined) {
          throw new ScienceEditError(
            `Science edit region target ${JSON.stringify(artifact.artifactId)}@${String(artifact.version)} has no minted message image`,
            'SCIENCE_EDIT_INVALID_REQUEST',
          )
        }
        return [{ type: 'image' as const, attachment }]
      }),
    ],
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    scienceEdits: ScienceEditService
  }
}

/** Remote service admitting browser edit gestures into the addressed live agent. */
export class ScienceEditService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'scienceEdits')
  }

  /**
   * Validate exact current artifact selections and queue one structured edit
   * message. A region target's raster is read back from the project artifact
   * store and admitted as an ordinary session message attachment, so the
   * model-visible image stays reconstructable from the session log alone.
   * @param agent - exact live agent resolved by the Remote lookup policy.
   * @param request - selected versions, targets, and shared user instruction.
   * @returns durable-inbox admission receipt.
   */
  @Remote('submit')
  async submit(agent: Agent, request: ScienceEditRequest): Promise<ScienceEditReceipt> {
    const state = foldScience(agent.session.events)
    const resolved = resolveScienceEdit(state.artifacts, request)
    const regionImages = new Map<string, ImageAttachmentRef>()
    for (const { artifact, target } of resolved.targets) {
      const key = String(artifact.versionId)
      if (target.kind !== 'normalized-region' || regionImages.has(key)) continue
      const data = await this.ctx.scienceArtifactStore.readBlob(artifact.projectId, artifact.sha256)
      // Verbatim: the message must show the model the exact committed raster,
      // not a normalized re-encode of it.
      regionImages.set(key, await this.ctx.attachments.saveImage({
        data,
        mediaType: 'image/png',
        name: artifact.logicalName.slice(artifact.logicalName.lastIndexOf('/') + 1),
        normalization: 'verbatim',
      }))
    }
    agent.followup(createScienceEditMessage(resolved, regionImages))
    return { accepted: true }
  }

  /**
   * Validate and commit one complete Vega-Lite working copy as a direct human
   * edit: bytes into the owning project's artifact store, then the
   * store-reference event.
   * @param agent - exact live agent whose Session owns the artifact.
   * @param request - exact current parent and complete edited JSON text.
   * @returns identity and direct-edit provenance of the new contiguous version.
   */
  @Remote('commitStyleEdit')
  async commitStyleEdit(agent: Agent, request: ScienceStyleEditRequest): Promise<ScienceStyleEditReceipt> {
    const state = foldScience(agent.session.events)
    const parent = resolveCurrentArtifact(state.artifacts, request.artifactId, request.version)
    parseStyleSpec(request.spec)
    const stored = await this.ctx.scienceArtifactStore.appendVersion(parent.projectId, parent.artifactId, {
      producerSessionId: agent.session.id,
      data: new TextEncoder().encode(request.spec),
      mediaType: 'image/png',
      origin: 'human-edit',
      title: parent.title,
      ...parent.caption === undefined ? {} : { caption: parent.caption },
      editBaselines: parent.versionId,
      environmentRevision: String(parent.environmentRevision),
      environmentFingerprintPreview: parent.environmentFingerprint.slice(0, 12),
    })
    const artifact = {
      artifactId: parent.artifactId,
      producerSessionId: stored.producerSessionId,
      logicalName: parent.logicalName,
      version: stored.ordinal,
      parent: { artifactId: parent.artifactId, version: parent.version },
      title: parent.title,
      ...parent.caption === undefined ? {} : { caption: parent.caption },
      origin: 'human-edit',
      projectId: parent.projectId,
      versionId: stored.versionId,
      sha256: stored.sha256,
      mediaType: 'image/png',
      byteCount: stored.byteCount,
      environmentRevision: parent.environmentRevision,
      environmentFingerprint: parent.environmentFingerprint,
      createdAt: stored.createdAt,
    } satisfies ScienceArtifactVersion
    agent.session.append('science/artifact-saved', { version: 1, artifact })
    return { artifactId: artifact.artifactId, version: artifact.version, origin: artifact.origin }
  }

  /**
   * Add one user-only note after validating its exact visible artifact version.
   * @param agent - Agent whose session owns the artifact.
   * @param request - Exact artifact version and plain note text.
   * @returns acceptance receipt after the note event commits.
   */
  @Remote('addArtifactNote')
  addArtifactNote(agent: Agent, request: ScienceArtifactNoteAddRequest): ScienceArtifactNoteReceipt {
    const state = foldScience(agent.session.events)
    const artifact = state.artifacts.find(candidate =>
      candidate.artifactId === request.artifactId && candidate.version === request.version)
    if (artifact === undefined) {
      throw new ScienceEditError('Science artifact note target does not identify a committed version', 'SCIENCE_EDIT_TARGET_NOT_FOUND')
    }
    const text = resolveFreeText(request.text, 'artifact note')
    if (text.length > MAX_SCIENCE_ARTIFACT_NOTE_LENGTH) {
      invalid(`Science edit artifact note must be at most ${String(MAX_SCIENCE_ARTIFACT_NOTE_LENGTH)} characters`)
    }
    agent.session.append('science/artifact-note-added', {
      version: 1,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
      text,
      createdAt: Date.now(),
    }, { ignorable: true })
    return { accepted: true }
  }

  /**
   * Remove one active user-only note owned by the named logical artifact.
   * @param agent - Agent whose session owns the note.
   * @param request - Logical artifact and add-event sequence identifying the note.
   * @returns acceptance receipt after the removal event commits.
   */
  @Remote('removeArtifactNote')
  removeArtifactNote(agent: Agent, request: ScienceArtifactNoteRemoveRequest): ScienceArtifactNoteReceipt {
    const activeNotes = agent.session.events.reduce<ScienceArtifactNotesProjection>(applyScienceArtifactNotes, [])
    const active = activeNotes.some(note => note.seq === request.noteSeq && note.artifactId === request.artifactId)
    if (!active) {
      throw new ScienceEditError('Science artifact note does not identify an active note', 'SCIENCE_EDIT_TARGET_NOT_FOUND')
    }
    agent.session.append('science/artifact-note-removed', {
      version: 1,
      artifactId: request.artifactId,
      noteSeq: request.noteSeq,
      removedAt: Date.now(),
    }, { ignorable: true })
    return { accepted: true }
  }
}
