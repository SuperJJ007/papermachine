/**
 * `annotate_artifact`: metadata-only curation over an artifact auto-capture
 * already durably saved, through `ctx.scienceRuntime.annotateArtifact`. It
 * never touches the filesystem or the attachment store — the curated
 * version reuses the exact content-addressed attachment of the version it
 * annotates.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-science-runtime'
import type { ScienceArtifactVersion } from '@deepseek-ai/dsh-science-session'
import { latestRequestHeaderSeq, requireScienceSession } from './run.ts'
import { requireDirectDispatch } from './guard.ts'
import { scienceArtifactPresentation } from './presentation.ts'
import { scienceArtifactSchemaProperties, scienceArtifactValueFields } from './artifact-schema.ts'

const artifactReceiptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...scienceArtifactSchemaProperties,
    // Full attachment metadata for the canonical result; `render` deliberately
    // omits attachmentId from the model-visible text (it is an internal
    // storage handle, not a fact the model reasons about), while it remains
    // available here for `presentationMeta` to carry into the Client row.
    attachmentId: { type: 'string', required: true },
    attachmentName: { type: 'string' },
  },
} as const

/** Bounded structured value for a durably curated artifact version. */
export type ScienceArtifactReceiptValue = InferValue<typeof artifactReceiptSchema>

/**
 * Flatten a durable artifact version into the tool's canonical value.
 * @param artifact - the durable artifact version `ctx.scienceRuntime.annotateArtifact(...)` appended.
 * @returns the canonical structured value the tool returns.
 */
export function artifactReceiptFromArtifact(artifact: ScienceArtifactVersion): ScienceArtifactReceiptValue {
  const { attachment } = artifact
  return {
    ...scienceArtifactValueFields(artifact),
    attachmentId: String(attachment.attachmentId),
    ...attachment.name === undefined ? {} : { attachmentName: attachment.name },
  }
}

/**
 * Render one artifact receipt as plain text. The model-safe receipt names
 * identity, version, source run, title/caption, and media type/dimensions/
 * byte count — never the internal attachment id and never file bytes.
 * @param value - the canonical artifact receipt to render.
 * @returns the rendered Native text.
 */
export function formatArtifactReceipt(value: ScienceArtifactReceiptValue): string {
  const lines = [
    `artifact "${value.logicalName}" v${String(value.version)} (${value.artifactId}) curated from run ${value.runId}`,
    `title: ${value.title}`,
  ]
  if (value.caption !== undefined) lines.push(`caption: ${value.caption}`)
  const dimensions = value.width !== undefined && value.height !== undefined ? `, ${String(value.width)}x${String(value.height)}` : ''
  lines.push(`${value.mediaType}${dimensions}, ${String(value.bytes)} bytes`)
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
 */
export function applyAnnotateArtifactTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'annotate_artifact',
    description: 'Add a human-readable title and optional caption to an artifact your code already produced (see the artifact list in the run result or get_science_state). A curated artifact is highlighted for the reader — use it for the file that best demonstrates your result, not every intermediate output. Returns a text receipt; never file bytes.',
    parameters: {
      logical_name: { type: 'string', required: true, description: 'The artifact\'s logical_name, exactly as it appeared in a run result or get_science_state.' },
      version: { type: 'integer', description: 'Exact existing version of logical_name to curate. Defaults to its latest version.' },
      title: { type: 'string', required: true, description: 'Human-readable artifact title.' },
      caption: { type: 'string', description: 'Optional human-readable caption.' },
    },
    output: {
      schema: artifactReceiptSchema,
      render: (_args, value) => [{ type: 'text', text: formatArtifactReceipt(value) }],
      presentationMeta: (_args, value) => scienceArtifactPresentation(value),
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
      return artifactReceiptFromArtifact(artifact)
    },
  }))
}
