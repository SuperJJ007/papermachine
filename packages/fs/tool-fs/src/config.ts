/**
 * Plugin configuration and read-cap resolution shared by every
 * `@deepseek-ai/dsh-tool-fs` entry point. The root and `./read-only` entries
 * both re-export the exact `Config` schema value defined here so the two
 * entries validate and default read limits identically.
 * @module @deepseek-ai/dsh-tool-fs/config
 */

import z from '@deepseek-ai/schemastery'
import { READ_LIMIT, STREAM_MIN_SIZE } from './read.ts'
import type { ReadToolCaps } from './read.ts'
import { READ_MAX_BYTES, READ_MAX_LINE_LENGTH } from './read-render.ts'

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Default and maximum number of lines returned by one `read` call. */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` call. */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readStreamMinSize?: number
}

export const Config: z<Config> = z.object({
  readLimit: z.number().default(READ_LIMIT),
  readMaxLineLength: z.number().default(READ_MAX_LINE_LENGTH),
  readMaxBytes: z.number().default(READ_MAX_BYTES),
  readStreamMinSize: z.number().default(STREAM_MIN_SIZE),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Every read cap counts lines/chars/bytes — a positive integer, or windowing arithmetic misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-fs: ${name} must be a positive integer`)
  }
}

/**
 * Validate a schemastery-defaulted config and resolve the `read`/`read_image`
 * caps every entry point shares.
 * @param config - config already defaulted by the {@link Config} schema.
 * @returns the validated read caps for {@link applyReadTool}.
 */
export function resolveReadCaps(config: Config): ReadToolCaps {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('readLimit', resolved.readLimit)
  assertPositiveInteger('readMaxLineLength', resolved.readMaxLineLength)
  assertPositiveInteger('readMaxBytes', resolved.readMaxBytes)
  assertPositiveInteger('readStreamMinSize', resolved.readStreamMinSize)
  return {
    limit: resolved.readLimit,
    maxLineLength: resolved.readMaxLineLength,
    maxBytes: resolved.readMaxBytes,
    streamMinSize: resolved.readStreamMinSize,
  }
}
