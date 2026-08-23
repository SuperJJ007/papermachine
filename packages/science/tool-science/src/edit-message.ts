/** Host admission for artifact-viewer edit gestures. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import { assertNever, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { foldScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactVersion } from '@deepseek-ai/dsh-science-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ScienceEditErrorCode,
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

function resolveInstruction(value: string): string {
  const instruction = value.trim()
  if (instruction.length === 0 || instruction.includes('\u0000') || !instruction.isWellFormed()) {
    invalid('Science edit instruction must be non-empty, well-formed Unicode without U+0000')
  }
  return instruction
}

/** Validated material needed to construct one Science edit message. */
export interface ResolvedScienceEdit {
  readonly targets: readonly {
    readonly artifact: ScienceArtifactVersion
    readonly target: ScienceEditTarget
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
  assertTargetMatches(latest, target)
  return { artifact: latest, target }
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
  const instruction = resolveInstruction(request.instruction)
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
  if (latest.attachment.mediaType !== 'application/vnd.vega-lite+json') {
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
  const image = 'width' in artifact.attachment
  if (target.kind === 'spec-path' && artifact.attachment.mediaType !== 'application/vnd.vega-lite+json') {
    throw new ScienceEditError('Science spec-path edits require a Vega-Lite artifact', 'SCIENCE_EDIT_TARGET_MISMATCH')
  }
  if (target.kind === 'normalized-region' && !image) {
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
  }[],
  instruction: string,
): string {
  const selections = targets.map(({ artifact, target }, index) => {
    const selected = target.kind === 'spec-path'
      ? `Spec path ${target.path}`
      : `Normalized region x=${String(target.x)}, y=${String(target.y)}, width=${String(target.width)}, height=${String(target.height)}`
    return `${String(index + 1)}. ${JSON.stringify(artifact.logicalName)} (${artifact.artifactId} v${String(artifact.version)}): ${selected}`
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
 * Construct the durable structured user message for one admitted edit.
 * @param resolved - authoritative artifact and validated request fields.
 * @returns user message carrying both the readable instruction and structured source.
 */
export function createScienceEditMessage(resolved: ResolvedScienceEdit): UserMessage {
  const { targets, instruction } = resolved
  const source: ScienceEditMessageSource = {
    kind: 'science-edit',
    targets: targets.map(({ artifact, target }) => ({
      artifactId: artifact.artifactId,
      version: artifact.version,
      target,
    })),
    instruction,
  }
  return createUserMessage({
    source,
    content: [
      { type: 'text', text: renderScienceEditMessage(targets, instruction) },
      ...targets.flatMap(({ artifact, target }) => target.kind === 'normalized-region'
        ? [{ type: 'image' as const, attachment: artifact.attachment as Extract<ScienceArtifactVersion['attachment'], { width: number }> }]
        : []),
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
   * Validate exact current artifact selections and queue one structured edit message.
   * @param agent - exact live agent resolved by the Remote lookup policy.
   * @param request - selected versions, targets, and shared user instruction.
   * @returns durable-inbox admission receipt.
   */
  @Remote('submit')
  submit(agent: Agent, request: ScienceEditRequest): ScienceEditReceipt {
    const state = foldScience(agent.session.events)
    agent.followup(createScienceEditMessage(resolveScienceEdit(state.artifacts, request)))
    return { accepted: true }
  }

  /**
   * Validate and commit one complete Vega-Lite working copy as a direct human edit.
   * @param agent - exact live agent whose Session owns the artifact.
   * @param request - exact current parent and complete edited JSON text.
   * @returns identity and direct-edit provenance of the new contiguous version.
   */
  @Remote('commitStyleEdit')
  async commitStyleEdit(agent: Agent, request: ScienceStyleEditRequest): Promise<ScienceStyleEditReceipt> {
    const state = foldScience(agent.session.events)
    const parent = resolveCurrentArtifact(state.artifacts, request.artifactId, request.version)
    parseStyleSpec(request.spec)
    const attachment = await this.ctx.attachments.saveText({
      data: new TextEncoder().encode(request.spec),
      mediaType: 'application/vnd.vega-lite+json',
      ...parent.attachment.name === undefined ? {} : { name: parent.attachment.name },
    })
    const artifact: ScienceArtifactVersion = {
      artifactId: parent.artifactId,
      logicalName: parent.logicalName,
      version: parent.version + 1,
      parent: { artifactId: parent.artifactId, version: parent.version },
      title: parent.title,
      ...parent.caption === undefined ? {} : { caption: parent.caption },
      origin: 'human-edit',
      attachment: { ...attachment, mediaType: 'application/vnd.vega-lite+json' },
      environmentRevision: parent.environmentRevision,
      environmentFingerprint: parent.environmentFingerprint,
      createdAt: Date.now(),
    }
    agent.session.append('science/artifact-saved', { version: 1, artifact })
    return { artifactId: artifact.artifactId, version: artifact.version, origin: artifact.origin }
  }
}
