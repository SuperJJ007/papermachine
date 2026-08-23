/** Host admission for artifact-viewer edit gestures. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
  ScienceEditTarget,
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
  readonly artifact: ScienceArtifactVersion
  readonly target: ScienceEditTarget
  readonly instruction: string
}

/**
 * Resolve one request against the authoritative committed artifact history.
 * @param artifacts - strictly folded committed versions for the addressed session.
 * @param request - exact version, selected target, and instruction from the viewer.
 * @returns detached target and instruction beside the authoritative artifact version.
 */
export function resolveScienceEdit(
  artifacts: readonly ScienceArtifactVersion[], request: ScienceEditRequest,
): ResolvedScienceEdit {
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
  const instruction = resolveInstruction(request.instruction)
  assertTargetMatches(latest, target)
  return { artifact: latest, target, instruction }
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
 * @param artifact - authoritative immutable version and display name.
 * @param target - validated selection within that version.
 * @param instruction - validated user instruction.
 * @returns model-visible exact-version edit text.
 */
export function renderScienceEditMessage(
  artifact: Pick<ScienceArtifactVersion, 'artifactId' | 'version' | 'logicalName'>,
  target: ScienceEditTarget,
  instruction: string,
): string {
  const selected = target.kind === 'spec-path'
    ? `Spec path: ${target.path}`
    : `Normalized region: x=${String(target.x)}, y=${String(target.y)}, width=${String(target.width)}, height=${String(target.height)}`
  return [
    `Edit Science artifact ${JSON.stringify(artifact.logicalName)} (${artifact.artifactId} v${String(artifact.version)}).`,
    selected,
    `Instruction: ${instruction}`,
    `Use exactly ${artifact.artifactId} v${String(artifact.version)} as an artifact_inputs source and as the edit_of parent for the edited output. Do not substitute a newer version.`,
  ].join('\n')
}

/**
 * Construct the durable structured user message for one admitted edit.
 * @param resolved - authoritative artifact and validated request fields.
 * @returns user message carrying both the readable instruction and structured source.
 */
export function createScienceEditMessage(resolved: ResolvedScienceEdit): UserMessage {
  const { artifact, target, instruction } = resolved
  const source: ScienceEditMessageSource = {
    kind: 'science-edit',
    artifactId: artifact.artifactId,
    version: artifact.version,
    target,
    instruction,
  }
  return createUserMessage({
    source,
    content: [
      { type: 'text', text: renderScienceEditMessage(artifact, target, instruction) },
      ...(target.kind === 'normalized-region'
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
   * Validate one exact current artifact selection and queue its structured edit message.
   * @param agent - exact live agent resolved by the Remote lookup policy.
   * @param request - selected version, target, and user instruction.
   * @returns durable-inbox admission receipt.
   */
  @Remote('submit')
  submit(agent: Agent, request: ScienceEditRequest): ScienceEditReceipt {
    const state = foldScience(agent.session.events)
    agent.followup(createScienceEditMessage(resolveScienceEdit(state.artifacts, request)))
    return { accepted: true }
  }
}
