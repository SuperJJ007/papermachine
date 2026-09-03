/**
 * `annotate_artifact`: metadata-only curation over an artifact auto-capture
 * already durably saved, through `ctx.scienceRuntime.annotateArtifact`. The
 * curated version reuses the exact content-addressed store reference of the
 * version it annotates; no bytes move.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-science-runtime'
import type {} from '@deepseek-ai/dsh-science-artifact-store'
import { replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactMediaType, ScienceArtifactVersion, ScienceLanguage, ScienceProjection } from '@deepseek-ai/dsh-science-session'
import { latestRequestHeaderSeq, requireScienceSession, resolveArtifactStoreFacts } from './run.ts'
import { requireDirectDispatch } from './guard.ts'
import { scienceArtifactPresentation } from './presentation.ts'
import { formatScienceArtifactEdits, scienceArtifactSchemaProperties, scienceArtifactValueFields } from './artifact-schema.ts'
import type { ScienceArtifactStoreFacts } from './artifact-schema.ts'

const artifactReceiptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...scienceArtifactSchemaProperties,
    producer: {
      type: 'object', additionalProperties: false,
      properties: {
        tool: { type: 'string', enum: ['run_python', 'run_r'], required: true },
        turn: { type: 'integer', required: true },
      },
    },
    // Store version reference for the canonical result; `render` deliberately
    // omits versionId from the model-visible text (it is an internal
    // storage coordinate, not a fact the model reasons about), while it
    // remains available here for `presentationMeta` to carry into the Client row.
    versionId: { type: 'string', required: true },
  },
} as const

/** Bounded structured value for a durably curated artifact version. */
export type ScienceArtifactReceiptValue = InferValue<typeof artifactReceiptSchema>

/**
 * Flatten a durable artifact version into the tool's canonical value.
 * @param artifact - the durable artifact version `ctx.scienceRuntime.annotateArtifact(...)` appended.
 * @param store - the resolved store facts for `artifact.versionId`.
 * @param producerLanguage - language of the producing run, when it is present in this session.
 * @returns the canonical structured value the tool returns.
 */
export function artifactReceiptFromArtifact(
  artifact: ScienceArtifactVersion,
  store: ScienceArtifactStoreFacts,
  producerLanguage: ScienceLanguage | undefined,
): ScienceArtifactReceiptValue {
  return {
    ...scienceArtifactValueFields(artifact, store),
    ...producerLanguage === undefined || store.version.producerTurn === undefined ? {} : {
      producer: {
        tool: producerLanguage === 'python' ? 'run_python' : 'run_r',
        turn: store.version.producerTurn,
      },
    },
    versionId: String(artifact.versionId),
  }
}

/** Resolve the producer language from the current session's run projection. */
function artifactProducerLanguage(store: ScienceArtifactStoreFacts, projection: ScienceProjection): ScienceLanguage | undefined {
  const runId = store.version.producerRunId
  return runId === undefined ? undefined : projection.runs.find(run => String(run.runId) === runId)?.language
}

/**
 * Render one artifact receipt as plain text. The model-safe receipt names
 * identity, producer tool and turn, direct edits, and media facts without
 * exposing the internal run or store version ids.
 * @param value - the canonical artifact receipt to render.
 * @returns the rendered Native text.
 */
export function formatArtifactReceipt(value: ScienceArtifactReceiptValue): string {
  const status = value.curated ? 'curated' : 'auto-captured'
  const lines = [
    `artifact "${value.logicalName}" v${String(value.version)} (${value.artifactId}), ${value.contentOrigin}, ${status}`,
    `title: ${value.title}`,
  ]
  if (value.caption !== undefined) lines.push(`caption: ${value.caption}`)
  if (value.producer !== undefined) lines.push(`produced by ${value.producer.tool} (turn ${String(value.producer.turn)})`)
  lines.push(`${value.mediaType}, ${String(value.bytes)} bytes`)
  const edits = formatScienceArtifactEdits(value.edits ?? [], value.editCount ?? 0)
  if (edits !== undefined) lines.push(edits)
  return lines.join('\n')
}

/** Reject an empty or whitespace-only field before it reaches the Runtime. */
function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) throw new Error(`tool-science: ${field} must be a non-empty string`)
  return value
}

/**
 * Register `annotate_artifact`.
 * @param ctx - plugin context; reads the optional `ctx.scienceRuntime` at call time.
 * @param directEditLimit - maximum recent direct-edit summaries in the receipt.
 */
export function applyAnnotateArtifactTool(ctx: Context, directEditLimit: number): void {
  ctx.tools.register(defineTool({
    name: 'annotate_artifact',
    description: 'Add a human-readable title and optional caption to an artifact your code already produced (see the artifact list in the run result or get_science_state). A curated artifact is highlighted for the reader — use it for the file that best demonstrates your result, not every intermediate output. If the user names an artifact you have no record of, call this tool with that exact name anyway and relay its diagnostic — never create a substitute file in place of one you cannot find. Returns a text receipt; never file bytes.',
    parameters: {
      logical_name: { type: 'string', required: true, description: 'The artifact\'s logical_name, exactly as it appeared in a run result or get_science_state, or exactly as the user named it when you have no record of it.' },
      version: { type: 'integer', description: 'Exact existing version of logical_name to curate. Defaults to its latest version.' },
      title: { type: 'string', required: true, description: 'Human-readable artifact title.' },
      caption: { type: 'string', description: 'Optional human-readable caption.' },
    },
    output: {
      schema: artifactReceiptSchema,
      render: (_args, value) => [{ type: 'text', text: formatArtifactReceipt(value) }],
      presentationMeta: (_args, value) => scienceArtifactPresentation([{
        artifactId: value.artifactId,
        logicalName: value.logicalName,
        version: value.version,
        title: value.title,
        content: {
          versionId: value.versionId,
          mediaType: value.mediaType as ScienceArtifactMediaType,
          byteCount: value.bytes,
        },
      }]),
    },
    async execute(args, exec) {
      requireDirectDispatch(exec, 'annotate_artifact')
      const session = requireScienceSession(exec)
      const scienceRuntime = ctx.get('scienceRuntime')
      if (scienceRuntime === undefined) {
        throw new Error('tool-science: no Science Runtime is mounted (ctx.scienceRuntime)')
      }
      const requestHeaderSeq = latestRequestHeaderSeq(session)
      if (requestHeaderSeq === undefined) {
        throw new Error('tool-science: no request/header is recorded for this session')
      }
      const artifact = await scienceRuntime.annotateArtifact({
        session,
        logicalName: nonEmpty(args.logical_name, 'logical_name'),
        ...args.version === undefined ? {} : { version: args.version },
        title: nonEmpty(args.title, 'title'),
        ...args.caption === undefined ? {} : { caption: args.caption },
        toolCallId: exec.callId,
        requestHeaderSeq,
        signal: exec.signal,
      })
      const store = await resolveArtifactStoreFacts(ctx, directEditLimit, artifact)
      const projection = replayScience(session.events)
      /* v8 ignore next -- annotateArtifact just appended into an already-bound Science session. */
      if (projection === null) throw new Error('tool-science: Science mode became unbound during artifact annotation')
      return artifactReceiptFromArtifact(artifact, store, artifactProducerLanguage(store, projection))
    },
  }))
}
