/** Wire validation for the public Science projection value. */

import { isJsonValue } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { ZodType } from 'zod'
import { decodeScienceMode } from './codec.ts'
import type { ScienceClientProjection } from './types.ts'

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

const RUN_IDENTITY_KEYS = [
  'runId',
  'language',
  'environmentRevision',
  'environmentFingerprintPreview',
  'startedAt',
] as const

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function validInterpreter(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined) return false
  const keys = ['language', 'capability']
  if (candidate['languageVersion'] !== undefined) keys.push('languageVersion')
  if (candidate['fingerprintPreview'] !== undefined) keys.push('fingerprintPreview')
  if (!projectionExactKeys(candidate, keys)) return false
  if (candidate['language'] !== 'python' && candidate['language'] !== 'r') return false
  if (!['available', 'unavailable', 'invalid', 'drifted'].includes(String(candidate['capability']))) return false
  if (candidate['languageVersion'] !== undefined
    && (typeof candidate['languageVersion'] !== 'string' || /[\\/]/.test(candidate['languageVersion']))) return false
  return candidate['fingerprintPreview'] === undefined
    || (typeof candidate['fingerprintPreview'] === 'string' && /^[a-f0-9]{12}$/.test(candidate['fingerprintPreview']))
}

function validEnvironment(value: unknown): boolean {
  if (value === null) return true
  const candidate = projectionRecord(value)
  if (candidate === undefined) return false
  const keys = ['revision', 'profileId', 'configuredAt', 'validatedAt', 'status']
  if (candidate['python'] !== undefined) keys.push('python')
  if (candidate['r'] !== undefined) keys.push('r')
  const interpreters = [candidate['python'], candidate['r']].filter(value => value !== undefined)
  const capabilities = interpreters.map(value => (value as Record<string, unknown>)['capability'])
  return projectionExactKeys(candidate, keys)
    && safeInteger(candidate['revision'], 1)
    && typeof candidate['profileId'] === 'string'
    && candidate['profileId'].length > 0
    && safeInteger(candidate['configuredAt'])
    && safeInteger(candidate['validatedAt'])
    && (candidate['status'] === 'applied' || candidate['status'] === 'invalid' || candidate['status'] === 'drifted')
    && (candidate['python'] === undefined || validInterpreter(candidate['python']))
    && (candidate['r'] === undefined || validInterpreter(candidate['r']))
    && interpreters.length > 0
    && (candidate['status'] === 'applied'
      ? capabilities.every(capability => capability === 'available')
      : capabilities.some(capability => capability !== 'available'))
}

function validRunIdentity(candidate: Record<string, unknown>): boolean {
  return typeof candidate['runId'] === 'string'
    && candidate['runId'].length > 0
    && (candidate['language'] === 'python' || candidate['language'] === 'r')
    && safeInteger(candidate['environmentRevision'], 1)
    && typeof candidate['environmentFingerprintPreview'] === 'string'
    && /^[a-f0-9]{12}$/.test(candidate['environmentFingerprintPreview'])
    && safeInteger(candidate['startedAt'])
}

function validRun(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined || !validRunIdentity(candidate)) return false
  const status = candidate['status']
  if (status === 'running') return projectionExactKeys(candidate, [...RUN_IDENTITY_KEYS, 'status'])
  if (status === 'interrupted') {
    return projectionExactKeys(candidate, [...RUN_IDENTITY_KEYS, 'status', 'finishedAt', 'interruptedAtSeq'])
      && safeInteger(candidate['finishedAt'], candidate['startedAt'] as number)
      && safeInteger(candidate['interruptedAtSeq'])
  }
  if (!['success', 'failed', 'timed-out', 'cancelled'].includes(String(status))) return false
  const keys = [
    ...RUN_IDENTITY_KEYS,
    'status',
    'finishedAt',
    'stdoutBytes',
    'stderrBytes',
    'stdoutTruncated',
    'stderrTruncated',
  ]
  if (candidate['exitCode'] !== undefined) keys.push('exitCode')
  if (candidate['signal'] !== undefined) keys.push('signal')
  if (candidate['failureCode'] !== undefined) keys.push('failureCode')
  return projectionExactKeys(candidate, keys)
    && safeInteger(candidate['finishedAt'], candidate['startedAt'] as number)
    && (candidate['exitCode'] === undefined || Number.isSafeInteger(candidate['exitCode']))
    && (candidate['signal'] === undefined
      || (typeof candidate['signal'] === 'string' && !/[\\/]/.test(candidate['signal'])))
    && safeInteger(candidate['stdoutBytes'])
    && safeInteger(candidate['stderrBytes'])
    && typeof candidate['stdoutTruncated'] === 'boolean'
    && typeof candidate['stderrTruncated'] === 'boolean'
    && (candidate['failureCode'] === undefined || typeof candidate['failureCode'] === 'string')
}

function validAttachment(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined) return false
  const keys = ['attachmentId', 'mediaType', 'bytes', 'width', 'height']
  if (candidate['name'] !== undefined) keys.push('name')
  return projectionExactKeys(candidate, keys)
    && typeof candidate['attachmentId'] === 'string'
    && candidate['attachmentId'].length > 0
    && candidate['mediaType'] === 'image/png'
    && safeInteger(candidate['bytes'], 1)
    && safeInteger(candidate['width'], 1)
    && safeInteger(candidate['height'], 1)
    && (candidate['name'] === undefined || typeof candidate['name'] === 'string')
}

function validChart(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined) return false
  const keys = [
    'chartId', 'logicalName', 'version', 'title', 'attachment', 'runId',
    'environmentRevision', 'environmentFingerprintPreview', 'createdAt',
  ]
  if (candidate['caption'] !== undefined) keys.push('caption')
  return projectionExactKeys(candidate, keys)
    && typeof candidate['chartId'] === 'string'
    && typeof candidate['logicalName'] === 'string'
    && safeInteger(candidate['version'], 1)
    && typeof candidate['title'] === 'string'
    && (candidate['caption'] === undefined || typeof candidate['caption'] === 'string')
    && validAttachment(candidate['attachment'])
    && typeof candidate['runId'] === 'string'
    && safeInteger(candidate['environmentRevision'], 1)
    && typeof candidate['environmentFingerprintPreview'] === 'string'
    && /^[a-f0-9]{12}$/.test(candidate['environmentFingerprintPreview'])
    && safeInteger(candidate['createdAt'])
}

function validEvidence(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined) return false
  if (candidate['kind'] === 'run') {
    return projectionExactKeys(candidate, ['kind', 'runId']) && typeof candidate['runId'] === 'string'
  }
  if (candidate['kind'] === 'chart') {
    return projectionExactKeys(candidate, ['kind', 'chartId', 'version'])
      && typeof candidate['chartId'] === 'string'
      && safeInteger(candidate['version'], 1)
  }
  return candidate['kind'] === 'message'
    && projectionExactKeys(candidate, ['kind', 'seq'])
    && safeInteger(candidate['seq'])
}

function validOutcome(value: unknown): boolean {
  if (value === null) return true
  const candidate = projectionRecord(value)
  return candidate !== undefined
    && projectionExactKeys(candidate, [
      'revision', 'title', 'summaryMarkdown', 'evidence', 'publishedAt', 'environmentRevisions',
    ])
    && safeInteger(candidate['revision'], 1)
    && typeof candidate['title'] === 'string'
    && typeof candidate['summaryMarkdown'] === 'string'
    && Array.isArray(candidate['evidence'])
    && candidate['evidence'].length > 0
    && candidate['evidence'].every(validEvidence)
    && safeInteger(candidate['publishedAt'])
    && Array.isArray(candidate['environmentRevisions'])
    && candidate['environmentRevisions'].every(value => safeInteger(value, 1))
}

/**
 * Validate the complete projection value, including derived counters.
 * @param value - untrusted public value.
 * @returns whether the value is a valid Science projection.
 */
export function validScienceProjection(value: unknown): value is ScienceClientProjection | null {
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
    if (!validEnvironment(candidate['environment'])) return false
    if (!Array.isArray(candidate['runs']) || !candidate['runs'].every(validRun)) return false
    if (!Array.isArray(candidate['charts']) || !candidate['charts'].every(validChart)) return false
    if (!validOutcome(candidate['outcome'])) return false
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
    const chartIds = new Set(candidate['charts'].map(value => (value as Record<string, unknown>)['chartId']))
    const outcome = candidate['outcome'] as Record<string, unknown> | null
    const expectedMetrics = {
      runCount: candidate['runs'].length,
      successfulRunCount: candidate['runs'].filter(value => (value as Record<string, unknown>)['status'] === 'success').length,
      chartCount: chartIds.size,
      chartVersionCount: candidate['charts'].length,
      outcomeRevision: outcome === null ? 0 : outcome['revision'],
    }
    return Object.entries(expectedMetrics).every(([key, expected]) => storedMetrics[key] === expected)
  } catch {
    return false
  }
}

/** Wire validator for the Science projection registration. */
export const scienceProjectionSchema: ZodType<ScienceClientProjection | null> = z.custom<ScienceClientProjection | null>(
  validScienceProjection,
  { message: 'invalid Science projection value' },
)
