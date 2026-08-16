/**
 * A preset's own metadata: the display text a picker shows, plus whether the
 * preset may be a copy source.
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
 * Every read failure degrades to empty metadata, `copyable` included: a
 * preset whose file is missing, malformed, or unreadable still mounts and
 * still resolves as copyable. A shipped preset's file lives beside its
 * `agent.cordis.yml` under the same install permissions, so a tamper that
 * could flip `copyable` back on could equally rewrite the composition itself
 * — the read-only install tree, not this parse, is what actually protects a
 * durably-bound preset like `science`; the composition health check in
 * `./discovery.ts` is the one field here that fails loud, because an
 * unloadable composition blocks mounting rather than degrading.
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
   * preset that must refuse copying — because its identity is durably bound
   * to its literal id, as `dsh-tool-science`'s `ScienceModeRef.presetId` binds
   * to `science` — declares `false` explicitly rather than relying on a
   * caller to know.
   */
  readonly copyable?: boolean
}

/** A non-empty trimmed string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read one preset directory's display metadata.
 *
 * Absent, unparsable, and wrongly-shaped files are all the same answer —
 * empty metadata — because the caller renders a picker, not a diagnostic.
 * @param directory - the preset directory.
 * @returns the display text the preset published, possibly empty.
 */
export async function readPresetMetadata(directory: string): Promise<PresetMetadata> {
  let raw: string
  try {
    raw = await readFile(join(directory, METADATA_FILE), 'utf8')
  } catch {
    // Absent is the common case: metadata is optional and most presets,
    // including every one authored by duplicating another, carry none.
    return {}
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    // Malformed display text is not worth failing discovery over; the picker
    // falls back to the id, and the composition still mounts.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const record = parsed as Record<string, unknown>
  const name = text(record.name)
  const description = text(record.description)
  const order = typeof record.order === 'number' && Number.isFinite(record.order)
    ? record.order
    : undefined
  const copyable = typeof record.copyable === 'boolean' ? record.copyable : undefined
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
