/**
 * Shared JSON-schema fields and value fields for model-safe Science artifact
 * values, common to `annotate_artifact`, `run_python`/`run_r`, and
 * `get_science_state`.
 */

import type { ContentOrigin, VersionRecord } from '@deepseek-ai/dsh-science-artifact-store'
import type { ScienceArtifactVersion, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session'

/** Model-safe identity of one applied chart operation and its addressed element. */
export interface ScienceArtifactEditSummary {
  readonly op: ScienceChartOp['op']
  readonly target: string
}

/** Model-safe lineage for one captured artifact version. */
export type ScienceArtifactLineage = {
  readonly kind: 'edited-from'
  readonly logicalName: string
  readonly version: number
} | {
  readonly kind: 'continues'
  readonly version: number
}

/** Store facts resolved for one session-visible artifact. */
export interface ScienceArtifactStoreFacts {
  readonly version: VersionRecord
  readonly edits: readonly ScienceArtifactEditSummary[]
  readonly editCount: number
  readonly lineage?: ScienceArtifactLineage
}

const chartEditSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['set_title', 'set_subtitle', 'set_axis_label', 'set_legend_position', 'toggle_grid', 'set_font'], required: true },
    target: { type: 'string', required: true },
  },
} as const

/**
 * Identity, curation, and media fields shared by the artifact-receipt and
 * state schemas. `contentOrigin` and `curated` are the only two store-owned
 * provenance facts the model face exposes — never the store's internal
 * `versionId`/`sha256`/`projectId`/annotation-actor detail (`packages/AGENTS.md`).
 */
export const scienceArtifactSchemaProperties = {
  artifactId: { type: 'string', required: true },
  logicalName: { type: 'string', required: true },
  version: { type: 'integer', required: true },
  title: { type: 'string', required: true },
  caption: { type: 'string' },
  contentOrigin: { type: 'string', enum: ['run-auto', 'human-edit', 'import'], required: true },
  curated: { type: 'boolean', required: true },
  mediaType: { type: 'string', required: true },
  bytes: { type: 'integer', required: true },
  seenAt: { type: 'integer', required: true },
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
  readonly contentOrigin: ContentOrigin
  readonly curated: boolean
  readonly mediaType: string
  readonly bytes: number
  readonly seenAt: number
  readonly edits?: ScienceArtifactEditSummary[]
  readonly editCount?: number
}

/**
 * Read one artifact version's current store version row, keyed by the exact
 * store reference the session-level artifact names. Shared by every
 * model-facing artifact listing (`run_python`/`run_r`, `annotate_artifact`,
 * `get_science_state`) that resolves `contentOrigin`/`curated`/media facts
 * from the store.
 * @param artifact - the session-visible artifact version to resolve.
 * @returns the store's current version row.
 */
export type ResolveArtifactStoreFacts = (artifact: ScienceArtifactVersion) => Promise<ScienceArtifactStoreFacts>

function axesTarget(axes: number | null, element: string): string {
  return axes === null ? element : `axes[${String(axes)}].${element}`
}

function chartEditTarget(op: ScienceChartOp): string {
  switch (op.op) {
    case 'set_title': return axesTarget(op.axes, 'title')
    case 'set_subtitle': return axesTarget(op.axes, 'subtitle')
    case 'set_axis_label': return axesTarget(op.axes, `${op.axis}_label`)
    case 'set_legend_position': return axesTarget(op.axes, 'legend')
    case 'toggle_grid': return axesTarget(op.axes, 'grid')
    case 'set_font': return 'font'
    /* v8 ignore next -- exhaustive over the closed ScienceChartOp union. */
    default: return assertNever(op)
  }
}

/* v8 ignore next 3 -- only the ignored closed-union default arm calls this guard. */
function assertNever(value: never): never {
  throw new Error(`tool-science: unsupported chart operation ${JSON.stringify(value)}`)
}

/**
 * Select the most recent model-safe chart operations within the configured history bound.
 * @param chart - decoded live chart state, when the PNG version carries one.
 * @param limit - maximum operation summaries to return.
 * @returns recent operation summaries and the complete operation count.
 */
export function scienceArtifactEdits(
  chart: ScienceChartState | undefined,
  limit: number,
): Pick<ScienceArtifactStoreFacts, 'edits' | 'editCount'> {
  const operations = chart?.ops ?? []
  return {
    edits: operations.slice(-limit).map(op => ({ op: op.op, target: chartEditTarget(op) })),
    editCount: operations.length,
  }
}

/**
 * Render the model-visible direct-edit summary for one artifact version.
 * @param edits - recent operation and target identities.
 * @param editCount - complete operation count.
 * @returns the summary, or `undefined` when the artifact has no direct edits.
 */
export function formatScienceArtifactEdits(
  edits: readonly ScienceArtifactEditSummary[],
  editCount: number,
): string | undefined {
  if (editCount === 0) return undefined
  const recent = edits.map(edit => `${edit.op} (${edit.target})`).join(', ')
  const truncation = edits.length < editCount ? `; latest ${String(edits.length)} shown` : ''
  return `${String(editCount)} direct edits: ${recent}${truncation}.`
}

/**
 * Flatten one durable artifact version's model-safe identity, curation, and
 * media fields, matching `scienceArtifactSchemaProperties` field-for-field.
 * `artifact` supplies the session's own presentation snapshot (title/caption
 * as the model saw them, and `seenAt`); `store` supplies the store's current
 * version row — the sole authority for `contentOrigin`/media/curation status
 * since the T1/T2 artifact-authority migration.
 * @param artifact - the session-visible artifact version (presentation snapshot).
 * @param store - the resolved store facts for `artifact.versionId`.
 * @returns the shared value fields.
 */
export function scienceArtifactValueFields(artifact: ScienceArtifactVersion, store: ScienceArtifactStoreFacts): ScienceArtifactValueFields {
  const version = store.version
  return {
    artifactId: String(artifact.artifactId),
    logicalName: artifact.logicalName,
    version: artifact.version,
    title: artifact.title,
    ...artifact.caption === undefined ? {} : { caption: artifact.caption },
    contentOrigin: version.contentOrigin,
    curated: version.latestAnnotation !== undefined && version.latestAnnotation.actor !== 'capture',
    mediaType: version.mediaType,
    bytes: version.byteCount,
    seenAt: artifact.seenAt,
    ...store.editCount === 0 ? {} : { edits: [...store.edits], editCount: store.editCount },
  }
}
