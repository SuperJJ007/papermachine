/**
 * A preset's own metadata: the display text a picker shows, plus the validated
 * policy that decides whether the preset may be a copy source.
 *
 * It lives in its own file because the composition is a top-level list of
 * plugin rows — YAML cannot carry sibling keys beside it, and faking a
 * metadata row would hand the Loader something to load. Keeping it separate
 * also keeps the composition exactly what its name says: a Cordis file the
 * loader owns and the cordis preset can author.
 *
 * `id` is the directory name and `trust` comes from the root a preset was
 * discovered under, so neither is writable here — otherwise a locally
 * authored preset could claim to be a shipped one.
 *
 * An absent optional file means no display text and the ordinary copyable
 * default. A present file must be readable YAML containing a map, and a
 * declared `copyable` value must be boolean. Discovery requires metadata for
 * shipped presets so a missing or damaged non-copyable policy makes the row
 * broken instead of silently authoring a copy that cannot execute.
 * @module @deepseek-ai/dsh-agent-presets/metadata
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'

/** The optional display-metadata file beside a preset's composition. */
export const METADATA_FILE = 'preset.yml'

/** Display text and copy eligibility a preset may publish about itself. */
export interface PresetMetadata {
  /** Human-facing name; falls back to the preset id when absent. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /**
   * Position within its group; lower comes first. A preset that declares
   * none sorts after every preset that does, then by id — so the shipped set
   * can read in capability order while authored ones stay alphabetical.
   */
  readonly order?: number
  /**
   * Whether `agentPresets.copy()` may use this preset as a source. Absent
   * defaults to `true`: ordinary presets are copy sources by default, and a
   * preset that must refuse copying declares `false` explicitly rather than
   * relying on a caller to know. `dsh-science-session`'s `ScienceModeRef.presetId`
   * durably records whichever preset actually bound Science mode rather than
   * a hardcoded literal, but `dsh-tool-science`'s own eligibility check still
   * recognizes only its one shipped preset id (no preset-metadata mechanism
   * yet answers "is this copy's differing id still Science-family"), so a
   * copy of the `science` preset would silently never activate Science mode —
   * the reason its own metadata declares `false`.
   */
  readonly copyable?: boolean
}

/** Metadata that cannot be used to make a copy-eligibility decision. */
export class PresetMetadataError extends Error {
  constructor(
    /** Why the metadata is unusable, without this package's message prefix. */
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`agent-presets: ${reason}`, options)
  }
}

/** A non-empty trimmed string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read one preset directory's display metadata and copy policy.
 *
 * An absent optional file returns empty metadata. A required file that is
 * absent, any unreadable or malformed file, a non-map document, or a declared
 * non-boolean `copyable` value rejects so discovery can mark the preset broken.
 * @param directory - the preset directory.
 * @param options - whether this root requires every preset to publish metadata.
 * @returns the validated metadata the preset published, possibly empty.
 * @throws {@link PresetMetadataError} when required or present metadata cannot
 * provide a trustworthy copy-eligibility decision.
 */
export async function readPresetMetadata(
  directory: string,
  options: { readonly required?: boolean } = {},
): Promise<PresetMetadata> {
  const path = join(directory, METADATA_FILE)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && options.required !== true) return {}
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? `the metadata file ${METADATA_FILE} is required for shipped presets`
      : `the metadata file ${METADATA_FILE} cannot be read`
    throw new PresetMetadataError(reason, { cause: error })
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (error) {
    /* v8 ignore next -- js-yaml throws YAMLException (an Error) for every parse failure; the fallback keeps a hostile value readable */
    const full = error instanceof Error ? error.message : String(error)
    throw new PresetMetadataError(
      `the metadata file ${METADATA_FILE} is not valid YAML: ${full.replace(/\n[\s\S]*$/, '')}`,
      { cause: error },
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PresetMetadataError(`the metadata file ${METADATA_FILE} must be a map`)
  }
  const record = parsed as Record<string, unknown>
  if ('copyable' in record && typeof record.copyable !== 'boolean') {
    throw new PresetMetadataError(`the metadata field copyable in ${METADATA_FILE} must be a boolean`)
  }
  const name = text(record.name)
  const description = text(record.description)
  const order = typeof record.order === 'number' && Number.isFinite(record.order)
    ? record.order
    : undefined
  const copyable = record.copyable as boolean | undefined
  return {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
    ...copyable === undefined ? {} : { copyable },
  }
}

/**
 * Render display metadata as the file's contents.
 *
 * Absent fields are omitted rather than written empty, so a preset with no
 * description does not ship a key that reads as an intentional blank.
 * @param metadata - the display text and copy eligibility to store.
 * @returns the YAML document, or undefined when there is nothing to store.
 */
export function renderPresetMetadata(metadata: PresetMetadata): string | undefined {
  const name = text(metadata.name)
  const description = text(metadata.description)
  const { order, copyable } = metadata
  if (name === undefined && description === undefined && order === undefined && copyable === undefined) {
    return undefined
  }
  return yaml.dump({
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
    ...copyable === undefined ? {} : { copyable },
  }, { lineWidth: -1 })
}
