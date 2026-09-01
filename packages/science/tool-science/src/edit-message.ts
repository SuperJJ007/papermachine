/** Host admission for artifact-viewer edit gestures. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-science-artifact-store'
import { ScienceRuntimeError } from '@deepseek-ai/dsh-science-runtime/types'
import { applyScienceArtifactNotes, decodeScienceChartState, foldScience, MAX_SCIENCE_ARTIFACT_NOTE_LENGTH } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactNotesProjection, ScienceArtifactVersion } from '@deepseek-ai/dsh-science-session'
import type { ScienceChartElement, ScienceChartState } from '@deepseek-ai/dsh-science-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { scienceElementCurrentSummary } from './element-summary.ts'
import type {
  ScienceChartEditReceipt,
  ScienceChartEditRequest,
  ScienceEditErrorCode,
  ScienceArtifactNoteAddRequest,
  ScienceArtifactNoteReceipt,
  ScienceArtifactNoteRemoveRequest,
  ScienceElementTarget,
  ScienceEditMessageSource,
  ScienceEditReceipt,
  ScienceEditRequest,
  ScienceEditSelection,
  ScienceEditTarget,
  ScienceNormalizedRegionTarget,
} from './types.ts'

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

/** Closed-union exhaustiveness fence (package-local copy; see ScienceChartEditPanel.tsx). */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

/**
 * Translate a Runtime chart-edit failure into the matching Science edit
 * rejection, or rethrow it unchanged when it carries a Runtime code neither
 * `applyChartOps` nor `previewChartOps` recognizes. Both Remotes call the
 * same Runtime chart-edit codes and must reject identically.
 * @param error - value caught from a Runtime `applyChartEdit`/`previewChartEdit` call.
 * @returns never; always throws.
 */
function translateChartRuntimeError(error: unknown): never {
  if (!(error instanceof ScienceRuntimeError)) throw error
  switch (error.code) {
    case 'CHART_STALE_VERSION': throw new ScienceEditError(error.message, 'CHART_STALE')
    case 'CHART_NOT_ADDRESSABLE': throw new ScienceEditError(error.message, 'CHART_NOT_ADDRESSABLE')
    case 'CHART_ELEMENT_NOT_FOUND':
    case 'CHART_OP_INVALID': throw new ScienceEditError(error.message, 'CHART_OP_INVALID')
    default: throw error
  }
}

/** Validate and detach one viewer-supplied normalized-region target. */
function resolveRegionTarget(target: ScienceNormalizedRegionTarget): ScienceNormalizedRegionTarget {
  const values = [target.x, target.y, target.width, target.height]
  if (!values.every(Number.isFinite)
    || target.x < 0 || target.y < 0 || target.width <= 0 || target.height <= 0
    || target.x + target.width > 1 || target.y + target.height > 1) {
    invalid('Science edit region must be a positive rectangle within normalized coordinates 0 through 1')
  }
  return { ...target }
}

const ELEMENT_KINDS = new Set<ScienceChartElement['kind']>([
  'title', 'subtitle', 'x_label', 'y_label', 'tick_labels', 'legend', 'series', 'grid',
  'axis_range', 'axis_scale', 'figure_size', 'font', 'annotation',
])

function validTargetText(value: string): boolean {
  return value.trim() !== '' && !value.includes('\u0000') && value.isWellFormed()
}

/** Validate and detach one viewer-supplied chart-element target. */
function resolveElementTarget(target: ScienceElementTarget): ScienceElementTarget {
  if (!validTargetText(target.elementId) || !ELEMENT_KINDS.has(target.elementKind)) {
    invalid('Science edit element target must name a valid element id and kind')
  }
  if (target.axes !== null && (!Number.isSafeInteger(target.axes) || target.axes < 0)) {
    invalid('Science edit element target axes must be null or a non-negative safe integer')
  }
  if (target.label !== null && !validTargetText(target.label)) {
    invalid('Science edit element target label must be null or non-empty well-formed Unicode without U+0000')
  }
  if (!validTargetText(target.current)) {
    invalid('Science edit element target current value must be non-empty well-formed Unicode without U+0000')
  }
  return { ...target }
}

/** Validate and detach one viewer-supplied target, dispatched by its closed `kind`. */
function resolveTarget(target: ScienceEditTarget): ScienceEditTarget {
  switch (target.kind) {
    case 'normalized-region': return resolveRegionTarget(target)
    case 'element': return resolveElementTarget(target)
    /* v8 ignore next -- closed ScienceEditTarget union */
    default: return assertNever(target)
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

/**
 * Store-derived facts one target-match check needs: `mediaType` and, for a
 * PNG version, its live-figure-object state. `mediaType`/`chart` left the
 * session-level `ScienceArtifactVersion` with the T1/T2 artifact-authority
 * migration (they live in the store's `versions`/`figure_state` rows now),
 * so a caller resolves them per addressed version through
 * {@link ReadArtifactTargetFacts} before this check can run.
 */
export interface TargetMatchFacts {
  readonly mediaType: string
  readonly chart: ScienceChartState | undefined
}

/** Resolve one addressed artifact version's store-owned target-match facts. */
export type ReadArtifactTargetFacts = (artifact: ScienceArtifactVersion) => Promise<TargetMatchFacts>

async function resolveSelection(
  artifacts: readonly ScienceArtifactVersion[], request: ScienceEditSelection, readFacts: ReadArtifactTargetFacts,
): Promise<ResolvedScienceEdit['targets'][number]> {
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
  if (request.logicalName !== latest.logicalName) {
    throw new ScienceEditError(
      `Science edit target ${JSON.stringify(request.artifactId)}@${String(request.version)} does not match logical name ${JSON.stringify(latest.logicalName)}`,
      'SCIENCE_EDIT_TARGET_MISMATCH',
    )
  }
  const target = resolveTarget(request.target)
  const comment = request.comment === undefined ? undefined : resolveFreeText(request.comment, 'target comment')
  assertTargetMatches(target, await readFacts(latest))
  return { artifact: latest, target, ...comment === undefined ? {} : { comment } }
}

/**
 * Resolve one multi-target request against the authoritative committed artifact history.
 * @param artifacts - strictly folded committed versions for the addressed session.
 * @param request - exact version, selected target, and instruction from the viewer.
 * @param readFacts - resolves each addressed version's store-owned target-match facts.
 * @returns detached targets and instruction beside the authoritative artifact versions.
 */
export async function resolveScienceEdit(
  artifacts: readonly ScienceArtifactVersion[], request: ScienceEditRequest, readFacts: ReadArtifactTargetFacts,
): Promise<ResolvedScienceEdit> {
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
  const targets = await Promise.all(request.targets.map(async (selection, index) => {
    try {
      return await resolveSelection(artifacts, selection, readFacts)
    } catch (error: unknown) {
      // Decoded selections and authoritative folded artifacts only reach
      // ScienceEditError paths inside resolveSelection.
      const cause = error as ScienceEditError
      throw new ScienceEditError(`Science edit target ${String(index + 1)}: ${cause.message}`, cause.code as ScienceEditErrorCode)
    }
  }))
  return { targets, instruction }
}

/**
 * Enforce the media-type constraint a resolved target's kind carries. A
 * region target requires a raster image (it rides the message as a minted
 * image attachment); an element target names an already-addressable chart
 * element and carries no independent media constraint of its own.
 */
function assertTargetMatches(target: ScienceEditTarget, facts: TargetMatchFacts): void {
  switch (target.kind) {
    case 'normalized-region':
      if (facts.mediaType !== 'image/png') {
        throw new ScienceEditError('Science region edits require a raster image artifact', 'SCIENCE_EDIT_TARGET_MISMATCH')
      }
      return
    case 'element': {
      if (facts.chart === undefined) {
        throw new ScienceEditError('Science element edits require an addressable chart artifact', 'SCIENCE_EDIT_TARGET_MISMATCH')
      }
      const element = facts.chart.elements.find(candidate => candidate.id === target.elementId)
      if (element === undefined
        || element.kind !== target.elementKind
        || element.axes !== target.axes
        || element.label !== target.label
        || scienceElementCurrentSummary(element.current) !== target.current) {
        throw new ScienceEditError('Science element target does not match the addressed chart element', 'SCIENCE_EDIT_TARGET_MISMATCH')
      }
      return
    }
    /* v8 ignore next -- closed ScienceEditTarget union */
    default: assertNever(target)
  }
}

/** Render one target's model-visible descriptor, dispatched by its closed `kind`. */
function targetDescriptor(target: ScienceEditTarget): string {
  switch (target.kind) {
    case 'normalized-region':
      return `region(${String(target.x)},${String(target.y)},${String(target.width)},${String(target.height)})`
    case 'element': {
      return `element(${JSON.stringify(target.elementId)}, kind=${target.elementKind}, axes=${target.axes === null ? 'null' : String(target.axes)}, label=${JSON.stringify(target.label)}, current=${JSON.stringify(target.current)})`
    }
    /* v8 ignore next -- closed ScienceEditTarget union */
    default: return assertNever(target)
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
    const note = comment === undefined ? '' : `:${JSON.stringify(comment)}`
    return `- ${artifact.logicalName} v${String(artifact.version)} · ${targetDescriptor(target)}${note}`
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
 * bytes and keyed here by the target version's store `versionId`. An element
 * target names an already-addressable chart element by id and contributes no
 * image attachment.
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
      logicalName: artifact.logicalName,
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
   * message. Media type and live-figure-object state — the store's, since
   * the T1/T2 artifact-authority migration — gate each target: a region
   * target's raster is read back from the project artifact store and
   * admitted as an ordinary session message attachment, so the model-visible
   * image stays reconstructable from the session log alone; an element
   * target must match one addressable chart entry's id, kind, axes, label,
   * and current-value summary, read from the store's `figure_state` row and
   * never minting an attachment.
   * @param agent - exact live agent resolved by the Remote lookup policy.
   * @param request - selected versions, targets, and shared user instruction.
   * @returns durable-inbox admission receipt.
   */
  @Remote('submit')
  async submit(agent: Agent, request: ScienceEditRequest): Promise<ScienceEditReceipt> {
    const state = foldScience(agent.session.events)
    const resolved = await resolveScienceEdit(state.artifacts, request, async (artifact) => {
      const store = await this.ctx.scienceArtifactStore.getVersion(artifact.projectId, artifact.versionId)
      if (store === undefined) {
        throw new ScienceEditError('Science edit target no longer identifies a committed store version', 'SCIENCE_EDIT_TARGET_NOT_FOUND')
      }
      const figureState = store.mediaType !== 'image/png'
        ? undefined
        : await this.ctx.scienceArtifactStore.getFigureState(artifact.projectId, artifact.versionId)
      return {
        mediaType: store.mediaType,
        chart: figureState === undefined ? undefined : decodeScienceChartState(JSON.parse(figureState.stateJson)),
      }
    })
    const regionImages = new Map<string, ImageAttachmentRef>()
    for (const { artifact, target } of resolved.targets) {
      if (target.kind !== 'normalized-region') continue
      const key = String(artifact.versionId)
      if (regionImages.has(key)) continue
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
   * Apply deterministic operations to one exact current addressable chart.
   * @param agent - Agent whose session owns the chart.
   * @param request - Exact chart version and ordered operations.
   * @param signal - Client-owned cancellation for the Runtime operation.
   * @returns the committed direct-edit version and unresolved operation targets.
   */
  @Remote('applyChartOps')
  async applyChartOps(
    agent: Agent,
    request: ScienceChartEditRequest,
    signal: AbortSignal,
  ): Promise<ScienceChartEditReceipt> {
    try {
      const result = await this.ctx.scienceRuntime.applyChartEdit({
        session: agent.session,
        artifactId: request.artifactId,
        version: request.version,
        ops: request.ops,
        signal,
      })
      return {
        artifactId: result.artifact.artifactId,
        version: result.artifact.version,
        origin: 'human-edit',
        failedOps: result.failedOps,
      }
    } catch (error: unknown) {
      translateChartRuntimeError(error)
    }
  }

  /**
   * Render chart operations through the Runtime for live preview without
   * committing a new artifact version: the preview PNG rides back as base64
   * and no store or session state is published.
   * @param agent - exact live agent whose session owns the chart artifact.
   * @param request - exact target artifact/version and operations to preview.
   * @param signal - caller-owned cancellation for the kernel round-trip.
   * @returns the base64 preview PNG, its re-extracted chart state, and any operations whose targets could not be resolved.
   */
  @Remote('previewChartOps')
  async previewChartOps(
    agent: Agent,
    request: ScienceChartEditRequest,
    signal: AbortSignal,
  ): Promise<import('./types.ts').ScienceChartPreviewReceipt> {
    try {
      const result = await this.ctx.scienceRuntime.previewChartEdit({
        session: agent.session,
        artifactId: request.artifactId,
        version: request.version,
        ops: request.ops,
        signal,
      })
      return {
        pngBase64: Buffer.from(result.png).toString('base64'),
        chart: result.chart,
        failedOps: result.failedOps,
      }
    } catch (error: unknown) {
      translateChartRuntimeError(error)
    }
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
