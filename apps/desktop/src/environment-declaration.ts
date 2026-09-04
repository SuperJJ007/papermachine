/** Versioned, data-only scientific environment declarations. */

import { HTTPS_URL } from './https-url.ts'

/**
 * Platform-architecture pairs this carrier ships a micromamba binary and a
 * conda package set for. `resources/micromamba.json` keys and every
 * declaration's `supportedPlatforms` are drawn from this list, and
 * {@link parseEnvironmentDeclaration} rejects anything outside it.
 */
export const DESKTOP_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const

export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number]

/**
 * Whether `value` names a platform this carrier ships for.
 * @param value - a `${process.platform}-${process.arch}` pair, or any other string.
 * @returns true when `value` is one of {@link DESKTOP_PLATFORMS}.
 */
export function isDesktopPlatform(value: string): value is DesktopPlatform {
  return (DESKTOP_PLATFORMS as readonly string[]).includes(value)
}

/**
 * File name of the bundled micromamba binary for `platform`. Windows refuses
 * to execute an extensionless image, so the fetch script and the runtime
 * lookup must agree on the `.exe` suffix rather than each deriving it.
 * @param platform - the platform whose bundled binary is being named.
 * @returns the file name under `resources/bin/<platform>/`.
 */
export function micromambaExecutableName(platform: DesktopPlatform): string {
  return platform.startsWith('win32-') ? 'micromamba.exe' : 'micromamba'
}

type EnvironmentLanguage = 'python' | 'r'

/** One interpreter probe executed inside a provisioned prefix. */
interface EnvironmentHealthCheck {
  readonly language: EnvironmentLanguage
  readonly executable: string
  readonly args: readonly string[]
}

/**
 * One whole package source a `micromamba create` attempt can be run
 * against: a stable id, a display name for the confirmation panel and
 * progress messages, and the conda channel URL(s) that make up this source.
 * Provisioning tries each source in turn as a complete `create` attempt
 * (never merges several sources' channels into one `channels` list a single
 * solve searches across) — see {@link EnvironmentDeclaration.sources}.
 */
export interface EnvironmentSource {
  readonly id: string
  readonly name: string
  readonly channels: readonly string[]
}

/** A complete, versioned input to desktop environment provisioning. */
export interface EnvironmentDeclaration {
  readonly schemaVersion: 1
  readonly id: string
  readonly revision: string
  readonly name: string
  readonly supportedPlatforms: readonly DesktopPlatform[]
  /**
   * Package sources tried in order as whole, independent `micromamba create`
   * attempts: the first source that lets the create succeed wins, and a
   * source that fails (for any reason, including a bad package spec) moves
   * on to the next rather than being merged into a combined channel list —
   * mixing sources into one list would let a single solve pull packages from
   * different mirrors into one inconsistent environment. `provisioning.ts`
   * owns the retry loop; a caller (`main.ts`) may reorder this list to start
   * from a user-chosen source, but never adds to or removes from it.
   */
  readonly sources: readonly EnvironmentSource[]
  readonly packages: readonly string[]
  readonly estimatedDownloadBytes: number
  readonly requiredFreeBytes: number
  readonly timeoutMs: number
  readonly healthChecks: readonly EnvironmentHealthCheck[]
}

/** The closed identifier vocabulary shared by declaration ids, source ids, and the environment binding's recorded source id. */
export const IDENTIFIER = /^[a-z][a-z0-9-]*$/u
const REVISION = /^[0-9]{4}\.[0-9]{2}\.[0-9]+$/u
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:+<>=!*~-]*$/u
// A conda channel URL that reaches micromamba's argv unescaped; see {@link HTTPS_URL}.
const CHANNEL_URL = HTTPS_URL
const SOURCE_FIELDS = ['id', 'name', 'channels'] as const
const FIELDS = [
  'schemaVersion', 'id', 'revision', 'name', 'supportedPlatforms', 'sources', 'packages',
  'estimatedDownloadBytes', 'requiredFreeBytes', 'timeoutMs', 'healthChecks',
] as const

function record(value: unknown, subject: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`desktop environment: ${subject} must be a record`)
  }
}

function nonEmptyStrings(value: unknown, subject: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`desktop environment: ${subject} must be a non-empty string array`)
  }
}

function positiveInteger(value: unknown, subject: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`desktop environment: ${subject} must be a positive integer`)
  }
}

/** Parse an untrusted JSON value into the closed declaration vocabulary. */
export function parseEnvironmentDeclaration(value: unknown): EnvironmentDeclaration {
  record(value, 'declaration')
  for (const key of Object.keys(value)) {
    if (!(FIELDS as readonly string[]).includes(key)) throw new Error(`desktop environment: unknown field ${key}`)
  }
  if (value.schemaVersion !== 1) throw new Error('desktop environment: schemaVersion must be 1')
  if (typeof value.id !== 'string' || !IDENTIFIER.test(value.id)) throw new Error('desktop environment: invalid id')
  if (typeof value.revision !== 'string' || !REVISION.test(value.revision)) throw new Error('desktop environment: invalid revision')
  if (typeof value.name !== 'string' || value.name.trim().length === 0) throw new Error('desktop environment: name must be non-empty')
  nonEmptyStrings(value.supportedPlatforms, 'supportedPlatforms')
  if (value.supportedPlatforms.some(item => !(DESKTOP_PLATFORMS as readonly string[]).includes(item))) {
    throw new Error('desktop environment: unsupported platform identifier')
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw new Error('desktop environment: sources must be a non-empty array')
  }
  const sourceIds = new Set<string>()
  for (const item of value.sources) {
    record(item, 'source')
    if (Object.keys(item).some(key => !(SOURCE_FIELDS as readonly string[]).includes(key))) {
      throw new Error('desktop environment: source has an unknown field')
    }
    if (typeof item.id !== 'string' || !IDENTIFIER.test(item.id)) throw new Error('desktop environment: invalid source id')
    if (sourceIds.has(item.id)) throw new Error('desktop environment: duplicate source id')
    sourceIds.add(item.id)
    if (typeof item.name !== 'string' || item.name.trim().length === 0) {
      throw new Error('desktop environment: source name must be non-empty')
    }
    nonEmptyStrings(item.channels, 'source channels')
    if (item.channels.some(channel => !CHANNEL_URL.test(channel))) {
      throw new Error('desktop environment: invalid channel URL')
    }
  }
  nonEmptyStrings(value.packages, 'packages')
  if (value.packages.some(item => !TOKEN.test(item))) {
    throw new Error('desktop environment: invalid package token')
  }
  positiveInteger(value.estimatedDownloadBytes, 'estimatedDownloadBytes')
  positiveInteger(value.requiredFreeBytes, 'requiredFreeBytes')
  positiveInteger(value.timeoutMs, 'timeoutMs')
  if (!Array.isArray(value.healthChecks) || value.healthChecks.length !== 2) {
    throw new Error('desktop environment: exactly two healthChecks are required')
  }
  const languages = new Set<EnvironmentLanguage>()
  for (const item of value.healthChecks) {
    record(item, 'healthCheck')
    if (Object.keys(item).some(key => !['language', 'executable', 'args'].includes(key))) {
      throw new Error('desktop environment: healthCheck has an unknown field')
    }
    if (item.language !== 'python' && item.language !== 'r') throw new Error('desktop environment: invalid healthCheck language')
    if (languages.has(item.language)) throw new Error('desktop environment: duplicate healthCheck language')
    languages.add(item.language)
    if (typeof item.executable !== 'string' || !TOKEN.test(item.executable)) throw new Error('desktop environment: invalid healthCheck executable')
    if (!Array.isArray(item.args) || item.args.some(arg => typeof arg !== 'string')) throw new Error('desktop environment: invalid healthCheck args')
  }
  return value as unknown as EnvironmentDeclaration
}
