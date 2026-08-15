/** Wire validation for the public Science projection value. */

import { isJsonValue } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { ZodType } from 'zod'
import {
  decodeScienceChart,
  decodeScienceEnvironment,
  decodeScienceMode,
  decodeScienceOutcome,
  decodeScienceRunStarted,
  decodeScienceRunTerminal,
} from './codec.ts'
import { scienceProjectionMetrics } from './projection-value.ts'
import type { ScienceProjection, ScienceRun } from './types.ts'

/**
 * Narrow a value to a plain record.
 * @param value - value to inspect.
 * @returns the record, or `undefined` for another JSON kind.
 */
export function projectionRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Test a record for an exact key set.
 * @param value - record to inspect.
 * @param keys - required keys with no extras.
 * @returns whether the key sets are equal.
 */
export function projectionExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function validInterruptedRun(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined || candidate['status'] !== 'interrupted') return false
  const { status: _status, finishedAt, interruptedAtSeq, ...identity } = candidate
  try {
    const start = decodeScienceRunStarted({ ...identity, status: 'running' })
    return typeof finishedAt === 'number'
      && Number.isSafeInteger(finishedAt)
      && finishedAt >= start.startedAt
      && typeof interruptedAtSeq === 'number'
      && Number.isSafeInteger(interruptedAtSeq)
      && interruptedAtSeq >= 0
  } catch {
    return false
  }
}

function validRun(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined) return false
  try {
    if (candidate['status'] === 'running') decodeScienceRunStarted(value)
    else if (candidate['status'] === 'interrupted') return validInterruptedRun(value)
    else decodeScienceRunTerminal(value)
    return true
  } catch {
    return false
  }
}

/**
 * Validate the complete projection value, including derived counters.
 * @param value - untrusted public value.
 * @returns whether the value is a valid Science projection.
 */
export function validScienceProjection(value: unknown): value is ScienceProjection | null {
  if (value === null) return true
  if (!isJsonValue(value)) return false
  const candidate = projectionRecord(value)
  if (candidate === undefined || !projectionExactKeys(candidate, [
    'mode',
    'environment',
    'runs',
    'charts',
    'outcome',
    'metrics',
    'lastScienceEventSeq',
  ])) return false
  try {
    decodeScienceMode(candidate['mode'])
    if (candidate['environment'] !== null) decodeScienceEnvironment(candidate['environment'])
    if (!Array.isArray(candidate['runs']) || !candidate['runs'].every(validRun)) return false
    if (!Array.isArray(candidate['charts'])) return false
    const charts = candidate['charts'].map(value => decodeScienceChart(value))
    const outcome = candidate['outcome'] === null ? null : decodeScienceOutcome(candidate['outcome'])
    const lastScienceEventSeq = candidate['lastScienceEventSeq'] as number
    if (!Number.isSafeInteger(lastScienceEventSeq) || lastScienceEventSeq < 0) return false
    const storedMetrics = projectionRecord(candidate['metrics'])
    if (storedMetrics === undefined || !projectionExactKeys(storedMetrics, [
      'runCount',
      'successfulRunCount',
      'chartCount',
      'chartVersionCount',
      'outcomeRevision',
    ])) return false
    const runs = candidate['runs'] as unknown as ScienceRun[]
    const expectedMetrics = scienceProjectionMetrics(runs, charts, outcome?.revision ?? 0)
    return Object.entries(expectedMetrics).every(([key, expected]) => storedMetrics[key] === expected)
  } catch {
    return false
  }
}

/** Wire validator for the Science projection registration. */
export const scienceProjectionSchema: ZodType<ScienceProjection | null> = z.custom<ScienceProjection | null>(
  validScienceProjection,
  { message: 'invalid Science projection value' },
)
