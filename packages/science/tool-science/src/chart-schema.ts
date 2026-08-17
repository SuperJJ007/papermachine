/** Shared JSON-schema fields for model-safe Science chart values. */

/** Identity and source fields shared by the state and chart-receipt schemas. */
export const scienceChartSchemaProperties = {
  chartId: { type: 'string', required: true },
  logicalName: { type: 'string', required: true },
  version: { type: 'integer', required: true },
  title: { type: 'string', required: true },
  caption: { type: 'string' },
  runId: { type: 'string', required: true },
} as const
