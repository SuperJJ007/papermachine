/** `save_chart`: import one PNG from a successful run's artifact directory through `ctx.scienceRuntime`. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-science-runtime'
import { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactVersion } from '@deepseek-ai/dsh-science-session'
import { latestRequestHeaderSeq, requireScienceSession } from './run.ts'
import { requireDirectDispatch } from './guard.ts'
import { scienceChartPresentation } from './presentation.ts'
import { scienceChartSchemaProperties } from './chart-schema.ts'

const chartReceiptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...scienceChartSchemaProperties,
    // Full attachment metadata for the canonical result; `render` deliberately
    // omits attachmentId from the model-visible text (it is an internal
    // storage handle, not a fact the model reasons about), while it remains
    // available here for `presentationMeta` to carry into the Client row.
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    attachmentName: { type: 'string' },
    createdAt: { type: 'integer', required: true },
  },
} as const

/** Bounded structured value for a durably committed chart version. */
export type ScienceChartReceiptValue = InferValue<typeof chartReceiptSchema>

/**
 * Flatten a durable chart version into the tool's canonical value.
 * @param chart - the durable chart version `ctx.scienceRuntime.commitChart(...)` appended.
 * @returns the canonical structured value the tool returns.
 */
export function chartReceiptFromChart(chart: ScienceArtifactVersion): ScienceChartReceiptValue {
  return {
    chartId: String(chart.artifactId),
    logicalName: chart.logicalName,
    version: chart.version,
    title: chart.title,
    ...chart.caption === undefined ? {} : { caption: chart.caption },
    runId: String(chart.runId),
    attachmentId: String(chart.attachment.attachmentId),
    mediaType: chart.attachment.mediaType,
    bytes: chart.attachment.bytes,
    width: chart.attachment.width,
    height: chart.attachment.height,
    ...chart.attachment.name === undefined ? {} : { attachmentName: chart.attachment.name },
    createdAt: chart.createdAt,
  }
}

/**
 * Render one chart receipt as plain text. The model-safe receipt names
 * identity, version, source run, title/caption, and dimensions/byte count —
 * never the internal attachment id and never image bytes.
 * @param value - the canonical chart receipt to render.
 * @returns the rendered Native text.
 */
export function formatChartReceipt(value: ScienceChartReceiptValue): string {
  const lines = [
    `chart "${value.logicalName}" v${String(value.version)} (${value.chartId}) saved from run ${value.runId}`,
    `title: ${value.title}`,
  ]
  if (value.caption !== undefined) lines.push(`caption: ${value.caption}`)
  lines.push(`${value.mediaType}, ${String(value.width)}x${String(value.height)}, ${String(value.bytes)} bytes`)
  return lines.join('\n')
}

/** Reject an empty or whitespace-only field before it reaches the Runtime. */
function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) throw new Error(`tool-science: ${field} must be a non-empty string`)
  return value
}

/**
 * Register `save_chart`.
 * @param ctx - plugin context; reads the optional `ctx.scienceRuntime` at call time.
 */
export function applySaveChartTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'save_chart',
    description: 'Import one PNG chart from a successful run\'s SCIENCE_ARTIFACT_DIR (artifact_path is relative to that run\'s own directory) and durably save it. The first save of a logical_name becomes version 1; a later save with the same logical_name commits the next version of the same chart. Returns a text receipt, never image bytes; the chart becomes visible in the product transcript.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'The exact successful run_python/run_r run to import from.' },
      artifact_path: { type: 'string', required: true, description: 'Forward-slash path relative to that run\'s SCIENCE_ARTIFACT_DIR, naming an existing PNG file.' },
      logical_name: { type: 'string', required: true, description: 'Stable name for this chart across versions (e.g. "loss-curve"). Reusing it commits the next version of the same chart.' },
      title: { type: 'string', required: true, description: 'Human-readable chart title.' },
      caption: { type: 'string', description: 'Optional human-readable caption.' },
    },
    output: {
      schema: chartReceiptSchema,
      render: (_args, value) => [{ type: 'text', text: formatChartReceipt(value) }],
      presentationMeta: (_args, value) => scienceChartPresentation(value),
    },
    async execute(args, exec) {
      requireDirectDispatch(exec, 'save_chart')
      const session = requireScienceSession(exec)
      const scienceRuntime = ctx.get('scienceRuntime')
      if (scienceRuntime === undefined) {
        throw new Error('tool-science: no Science Runtime is mounted (ctx.scienceRuntime)')
      }
      const requestHeaderSeq = latestRequestHeaderSeq(session)
      if (requestHeaderSeq === undefined) {
        throw new Error('tool-science: no request/header is recorded for this session')
      }
      const chart = await scienceRuntime.commitChart({
        session,
        runId: ScienceRunId(nonEmpty(args.run_id, 'run_id')),
        artifactPath: nonEmpty(args.artifact_path, 'artifact_path'),
        logicalName: nonEmpty(args.logical_name, 'logical_name'),
        title: nonEmpty(args.title, 'title'),
        ...args.caption === undefined ? {} : { caption: args.caption },
        toolCallId: exec.callId,
        requestHeaderSeq,
        signal: exec.signal,
      })
      return chartReceiptFromChart(chart)
    },
  }))
}
