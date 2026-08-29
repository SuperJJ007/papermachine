/**
 * Shared JSON-schema fields and value fields for model-safe Science artifact
 * values, common to `annotate_artifact` and `get_science_state`.
 */

import type { ScienceArtifactMediaType, ScienceArtifactVersion, ScienceChartOp } from '@deepseek-ai/dsh-science-session'

/** Model-safe identity of one applied chart operation and its addressed element. */
export interface ScienceArtifactEditSummary {
  readonly op: ScienceChartOp['op']
  readonly target: string
}

const chartEditSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['set_title', 'set_axis_label', 'set_legend_position', 'toggle_grid'], required: true },
    target: { type: 'string', required: true },
  },
} as const

/** Identity, curation, source, and media fields shared by the artifact-receipt and state schemas. */
export const scienceArtifactSchemaProperties = {
  artifactId: { type: 'string', required: true },
  logicalName: { type: 'string', required: true },
  version: { type: 'integer', required: true },
  title: { type: 'string', required: true },
  caption: { type: 'string' },
  origin: { type: 'string', enum: ['auto', 'model', 'human-edit'], required: true },
  parent: {
    type: 'object', additionalProperties: false,
    properties: {
      artifactId: { type: 'string', required: true },
      version: { type: 'integer', required: true },
    },
  },
  runId: { type: 'string' },
  mediaType: { type: 'string', required: true },
  bytes: { type: 'integer', required: true },
  createdAt: { type: 'integer', required: true },
  edits: { type: 'array', items: chartEditSchema },
  editCount: { type: 'integer' },
} as const

/** Value shape `scienceArtifactValueFields` returns, matching `scienceArtifactSchemaProperties` field-for-field. */
export interface ScienceArtifactValueFields {
  readonly artifactId: string
  readonly logicalName: string
  readonly version: number
  readonly title: string
  readonly caption?: string
  readonly origin: ScienceArtifactVersion['origin']
  readonly parent?: { readonly artifactId: string; readonly version: number }
  readonly runId?: string
  readonly mediaType: ScienceArtifactMediaType
  readonly bytes: number
  readonly createdAt: number
  readonly edits?: ScienceArtifactEditSummary[]
  readonly editCount?: number
}

function axesTarget(axes: number | null, element: string): string {
  return axes === null ? element : `axes[${String(axes)}].${element}`
}

function chartEditTarget(op: ScienceChartOp): string {
  switch (op.op) {
    case 'set_title': return axesTarget(op.axes, 'title')
    case 'set_axis_label': return axesTarget(op.axes, `${op.axis}_label`)
    case 'set_legend_position': return axesTarget(op.axes, 'legend')
    case 'toggle_grid': return axesTarget(op.axes, 'grid')
    /* v8 ignore next -- exhaustive over the closed ScienceChartOp union; unreachable through the typed API. */
    default: return assertNever(op)
  }
}

/* v8 ignore next 3 -- only the ignored closed-union default arm calls this guard. */
function assertNever(value: never): never {
  throw new Error(`tool-science: unsupported chart operation ${JSON.stringify(value)}`)
}

/**
 * Reduce chart operations to model-safe operation and element identities.
 * @param artifact - artifact version whose direct edits are summarized.
 * @returns operation and addressed-element identities in application order.
 */
export function scienceArtifactEdits(artifact: ScienceArtifactVersion): ScienceArtifactEditSummary[] {
  return artifact.chart?.ops.map(op => ({ op: op.op, target: chartEditTarget(op) })) ?? []
}

/**
 * Render the model-visible direct-edit suffix for one artifact version.
 * @param edits - operation and addressed-element identities to render.
 * @returns the suffix, or `undefined` when the artifact has no direct edits.
 */
export function formatScienceArtifactEdits(edits: readonly ScienceArtifactEditSummary[]): string | undefined {
  if (edits.length === 0) return undefined
  return `${String(edits.length)} direct edits: ${edits.map(edit => `${edit.op} (${edit.target})`).join(', ')}.`
}

/**
 * Flatten one durable artifact version's identity, curation, source, and
 * media fields, matching `scienceArtifactSchemaProperties` field-for-field.
 * The artifact-receipt (`annotate-artifact.ts`) and state (`state.ts`) value
 * builders each spread this and add their own remaining fields —
 * `versionId` for the receipt, `environmentRevision`/
 * `environmentFingerprintPreview` for state.
 * @param artifact - the durable artifact version to flatten.
 * @returns the shared value fields.
 */
export function scienceArtifactValueFields(artifact: ScienceArtifactVersion): ScienceArtifactValueFields {
  const edits = scienceArtifactEdits(artifact)
  return {
    artifactId: String(artifact.artifactId),
    logicalName: artifact.logicalName,
    version: artifact.version,
    title: artifact.title,
    ...artifact.caption === undefined ? {} : { caption: artifact.caption },
    origin: artifact.origin,
    ...artifact.parent === undefined ? {} : {
      parent: { artifactId: String(artifact.parent.artifactId), version: artifact.parent.version },
    },
    ...artifact.origin === 'human-edit' ? {} : { runId: String(artifact.runId) },
    mediaType: artifact.mediaType,
    bytes: artifact.byteCount,
    createdAt: artifact.createdAt,
    ...edits.length === 0 ? {} : { edits, editCount: edits.length },
  }
}
