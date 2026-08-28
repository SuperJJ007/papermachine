/** Wire validation for the public Science projection value. */

import { isJsonValue } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { ZodType } from 'zod'
import { decodeScienceMode } from './codec.ts'
import type { ScienceClientProjection, ScienceKernelEndReason } from './types.ts'

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
  'toolCallId',
  'requestHeaderSeq',
  'environmentRevision',
  'environmentFingerprintPreview',
  'startedAt',
  'codeSha256',
  'kernelEpoch',
] as const

function validArtifactVersionRef(value: unknown): boolean {
  const candidate = projectionRecord(value)
  return candidate !== undefined
    && projectionExactKeys(candidate, ['artifactId', 'version'])
    && typeof candidate['artifactId'] === 'string'
    && candidate['artifactId'].length > 0
    && safeInteger(candidate['version'], 1)
}

function validRunInput(value: unknown): boolean {
  const candidate = projectionRecord(value)
  return candidate !== undefined
    && projectionExactKeys(candidate, ['artifactId', 'version', 'path'])
    && validArtifactVersionRef({ artifactId: candidate['artifactId'], version: candidate['version'] })
    && typeof candidate['path'] === 'string'
    && candidate['path'].length > 0
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function validPackage(value: unknown): boolean {
  const candidate = projectionRecord(value)
  return candidate !== undefined
    && projectionExactKeys(candidate, ['name', 'version'])
    && typeof candidate['name'] === 'string' && candidate['name'].length > 0
    && typeof candidate['version'] === 'string' && candidate['version'].length > 0
}

function validInterpreter(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined) return false
  const keys = ['language', 'capability']
  if (candidate['languageVersion'] !== undefined) keys.push('languageVersion')
  if (candidate['fingerprintPreview'] !== undefined) keys.push('fingerprintPreview')
  if (candidate['packages'] !== undefined) keys.push('packages')
  if (candidate['packagesTruncated'] !== undefined) keys.push('packagesTruncated')
  if (candidate['packagesSha256Preview'] !== undefined) keys.push('packagesSha256Preview')
  if (!projectionExactKeys(candidate, keys)) return false
  if (candidate['language'] !== 'python' && candidate['language'] !== 'r') return false
  if (!['available', 'unavailable', 'invalid', 'drifted'].includes(String(candidate['capability']))) return false
  if (candidate['languageVersion'] !== undefined
    && (typeof candidate['languageVersion'] !== 'string' || /[\\/]/.test(candidate['languageVersion']))) return false
  if (candidate['fingerprintPreview'] !== undefined
    && (typeof candidate['fingerprintPreview'] !== 'string' || !/^[a-f0-9]{12}$/.test(candidate['fingerprintPreview']))) return false
  if (candidate['packages'] !== undefined
    && (!Array.isArray(candidate['packages']) || !candidate['packages'].every(validPackage))) return false
  if (candidate['packagesTruncated'] !== undefined && typeof candidate['packagesTruncated'] !== 'boolean') return false
  return candidate['packagesSha256Preview'] === undefined
    || (typeof candidate['packagesSha256Preview'] === 'string' && /^[a-f0-9]{12}$/.test(candidate['packagesSha256Preview']))
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
    && typeof candidate['toolCallId'] === 'string'
    && candidate['toolCallId'].length > 0
    && safeInteger(candidate['requestHeaderSeq'])
    && safeInteger(candidate['environmentRevision'], 1)
    && typeof candidate['environmentFingerprintPreview'] === 'string'
    && /^[a-f0-9]{12}$/.test(candidate['environmentFingerprintPreview'])
    && safeInteger(candidate['startedAt'])
    && typeof candidate['codeSha256'] === 'string'
    && /^[a-f0-9]{64}$/.test(candidate['codeSha256'])
    && (candidate['inputs'] === undefined
      || (Array.isArray(candidate['inputs']) && candidate['inputs'].every(validRunInput)))
    && safeInteger(candidate['kernelEpoch'], 1)
}

function validRun(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined || !validRunIdentity(candidate)) return false
  const identityKeys: string[] = [...RUN_IDENTITY_KEYS]
  if (candidate['inputs'] !== undefined) identityKeys.push('inputs')
  const status = candidate['status']
  if (status === 'running') return projectionExactKeys(candidate, [...identityKeys, 'status'])
  if (status === 'interrupted') {
    return projectionExactKeys(candidate, [...identityKeys, 'status', 'finishedAt', 'interruptedAtSeq'])
      && safeInteger(candidate['finishedAt'], candidate['startedAt'] as number)
      && safeInteger(candidate['interruptedAtSeq'])
  }
  if (!['success', 'failed', 'timed-out', 'cancelled'].includes(String(status))) return false
  const keys = [
    ...identityKeys,
    'status',
    'finishedAt',
    'stdoutBytes',
    'stderrBytes',
    'stdoutTruncated',
    'stderrTruncated',
  ]
  if (candidate['failureCode'] !== undefined) keys.push('failureCode')
  if (candidate['outputDegraded'] !== undefined) keys.push('outputDegraded')
  return projectionExactKeys(candidate, keys)
    && safeInteger(candidate['finishedAt'], candidate['startedAt'] as number)
    && safeInteger(candidate['stdoutBytes'])
    && safeInteger(candidate['stderrBytes'])
    && typeof candidate['stdoutTruncated'] === 'boolean'
    && typeof candidate['stderrTruncated'] === 'boolean'
    && (candidate['failureCode'] === undefined || typeof candidate['failureCode'] === 'string')
    && (candidate['outputDegraded'] === undefined || candidate['outputDegraded'] === true)
}

const KERNEL_END_REASONS = [
  'idle',
  'session-end',
  'environment-rebound',
  'run-escalation',
  'protocol',
  'crash',
  'service-disposed',
] as const satisfies readonly ScienceKernelEndReason[]

const KERNEL_IDENTITY_KEYS = [
  'kernelEpoch',
  'language',
  'environmentRevision',
  'environmentFingerprintPreview',
] as const

function validKernelIdentity(candidate: Record<string, unknown>): boolean {
  return safeInteger(candidate['kernelEpoch'], 1)
    && (candidate['language'] === 'python' || candidate['language'] === 'r')
    && safeInteger(candidate['environmentRevision'], 1)
    && typeof candidate['environmentFingerprintPreview'] === 'string'
    && /^[a-f0-9]{12}$/.test(candidate['environmentFingerprintPreview'])
}

function validKernel(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined || !validKernelIdentity(candidate)) return false
  if (candidate['state'] === 'interrupted') {
    return projectionExactKeys(candidate, [...KERNEL_IDENTITY_KEYS, 'state', 'startedAt', 'finishedAt', 'interruptedAtSeq'])
      && safeInteger(candidate['startedAt'])
      && safeInteger(candidate['finishedAt'], candidate['startedAt'])
      && safeInteger(candidate['interruptedAtSeq'])
  }
  if (candidate['state'] !== 'started' && candidate['state'] !== 'exited') return false
  const keys = [...KERNEL_IDENTITY_KEYS, 'state', 'at']
  if (candidate['reason'] !== undefined) keys.push('reason')
  if (candidate['startedAt'] !== undefined) keys.push('startedAt')
  return projectionExactKeys(candidate, keys)
    && safeInteger(candidate['at'])
    && (candidate['state'] === 'exited') === (candidate['reason'] !== undefined)
    && (candidate['state'] === 'exited') === (candidate['startedAt'] !== undefined)
    && (candidate['startedAt'] === undefined
      || (safeInteger(candidate['startedAt']) && candidate['at'] >= candidate['startedAt']))
    && (candidate['reason'] === undefined
      || (typeof candidate['reason'] === 'string' && (KERNEL_END_REASONS as readonly string[]).includes(candidate['reason'])))
}

const ARTIFACT_MEDIA_TYPES = [
  'image/png',
  'text/csv',
  'application/json',
  'text/markdown',
  'text/plain',
]

function validArtifact(value: unknown): boolean {
  const candidate = projectionRecord(value)
  if (candidate === undefined) return false
  const humanEdit = candidate['origin'] === 'human-edit'
  const keys = ['artifactId', 'producerSessionId', 'logicalName', 'version', 'title', 'origin',
    'versionId', 'sha256', 'mediaType', 'byteCount',
    'environmentRevision', 'environmentFingerprintPreview', 'createdAt']
  if (!humanEdit) keys.push('runId', 'toolCallId', 'requestHeaderSeq')
  if (candidate['caption'] !== undefined) keys.push('caption')
  if (candidate['parent'] !== undefined) keys.push('parent')
  return projectionExactKeys(candidate, keys)
    && typeof candidate['artifactId'] === 'string'
    && candidate['artifactId'].length > 0
    && typeof candidate['producerSessionId'] === 'string'
    && candidate['producerSessionId'].length > 0
    && typeof candidate['logicalName'] === 'string'
    && safeInteger(candidate['version'], 1)
    && (humanEdit ? validArtifactVersionRef(candidate['parent']) : candidate['parent'] === undefined || validArtifactVersionRef(candidate['parent']))
    && typeof candidate['title'] === 'string'
    && (candidate['caption'] === undefined || typeof candidate['caption'] === 'string')
    && (humanEdit || candidate['origin'] === 'auto' || candidate['origin'] === 'model')
    && typeof candidate['versionId'] === 'string'
    && candidate['versionId'].length > 0
    && typeof candidate['sha256'] === 'string'
    && /^[a-f0-9]{64}$/.test(candidate['sha256'])
    && typeof candidate['mediaType'] === 'string'
    && ARTIFACT_MEDIA_TYPES.includes(candidate['mediaType'])
    && (!humanEdit || candidate['mediaType'] === 'image/png')
    && safeInteger(candidate['byteCount'], 1)
    && (humanEdit || typeof candidate['runId'] === 'string')
    && (humanEdit || typeof candidate['toolCallId'] === 'string' && candidate['toolCallId'].length > 0)
    && (humanEdit || safeInteger(candidate['requestHeaderSeq']))
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
    'kernels',
    'artifacts',
    'outcome',
    'metrics',
    'lastScienceEventSeq',
  ])) return false
  try {
    decodeScienceMode(candidate['mode'])
    if (!validEnvironment(candidate['environment'])) return false
    if (!Array.isArray(candidate['runs']) || !candidate['runs'].every(validRun)) return false
    if (!Array.isArray(candidate['kernels']) || !candidate['kernels'].every(validKernel)) return false
    if (!Array.isArray(candidate['artifacts']) || !candidate['artifacts'].every(validArtifact)) return false
    if (!validOutcome(candidate['outcome'])) return false
    const lastScienceEventSeq = candidate['lastScienceEventSeq'] as number
    if (!Number.isSafeInteger(lastScienceEventSeq) || lastScienceEventSeq < 0) return false
    const storedMetrics = projectionRecord(candidate['metrics'])
    if (storedMetrics === undefined || !projectionExactKeys(storedMetrics, [
      'runCount',
      'successfulRunCount',
      'artifactCount',
      'artifactVersionCount',
      'kernelCount',
      'outcomeRevision',
    ])) return false
    const artifactIds = new Set(candidate['artifacts'].map(value => (value as Record<string, unknown>)['artifactId']))
    const outcome = candidate['outcome'] as Record<string, unknown> | null
    const expectedMetrics = {
      runCount: candidate['runs'].length,
      successfulRunCount: candidate['runs'].filter(value => (value as Record<string, unknown>)['status'] === 'success').length,
      artifactCount: artifactIds.size,
      artifactVersionCount: candidate['artifacts'].length,
      kernelCount: candidate['kernels'].length,
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
