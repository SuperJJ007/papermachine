/** Desktop-owned pointer to the conda-family prefix(es) the user bound during onboarding. */

import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** The persisted binding: at least one prefix, both if the same environment carries Python and R. */
export interface EnvironmentBinding {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
  readonly boundAt: number
}

const FIELDS = ['pythonPrefix', 'rPrefix', 'boundAt'] as const

function bindingPath(dshHome: string): string {
  return join(dshHome, 'environment-binding.json')
}

/**
 * Parse an untrusted JSON value into an {@link EnvironmentBinding}.
 * @param value - the parsed JSON content of `environment-binding.json`.
 * @throws when a field is missing, has the wrong shape, or neither prefix is present.
 */
export function parseEnvironmentBinding(value: unknown): EnvironmentBinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop environment binding: must be a record')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(FIELDS as readonly string[]).includes(key)) throw new Error(`desktop environment binding: unknown field ${key}`)
  }
  for (const field of ['pythonPrefix', 'rPrefix'] as const) {
    const prefix = record[field]
    if (prefix !== undefined && (typeof prefix !== 'string' || !isAbsolute(prefix))) {
      throw new Error(`desktop environment binding: ${field} must be an absolute path`)
    }
  }
  if (record.pythonPrefix === undefined && record.rPrefix === undefined) {
    throw new Error('desktop environment binding: requires pythonPrefix or rPrefix')
  }
  if (!Number.isSafeInteger(record.boundAt)) {
    throw new Error('desktop environment binding: boundAt must be a safe integer')
  }
  return {
    ...(record.pythonPrefix === undefined ? {} : { pythonPrefix: record.pythonPrefix as string }),
    ...(record.rPrefix === undefined ? {} : { rPrefix: record.rPrefix as string }),
    boundAt: record.boundAt as number,
  }
}

/**
 * Write the binding atomically (temp file then rename) so a crash or
 * concurrent read never observes a partially written file, owner-only
 * (mode 0600) since the file names filesystem paths this process trusts
 * without re-validation on every read.
 * @param dshHome - the Harness home directory the binding is scoped to.
 * @param binding - the binding to persist.
 */
export async function writeEnvironmentBinding(dshHome: string, binding: EnvironmentBinding): Promise<void> {
  const path = bindingPath(dshHome)
  await writeFile(`${path}.next`, `${JSON.stringify(binding)}\n`, { mode: 0o600 })
  await rename(`${path}.next`, path)
}

/**
 * `bound` — a binding file exists, parses, and every prefix it names still
 * exists on disk. `unbound` — no binding file exists yet; onboarding is a
 * first run. `invalid` — a binding file exists but cannot be trusted (parse
 * failure, an unreadable file, or a prefix it names has since disappeared);
 * `reason` is a loud, user-facing status, never a silent fall-through to
 * onboarding's first-run copy.
 */
export type EnvironmentBindingStatus =
  | { readonly kind: 'bound'; readonly binding: EnvironmentBinding }
  | { readonly kind: 'unbound' }
  | { readonly kind: 'invalid'; readonly reason: string }

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Resolve the binding status driving `openInitialSurface`: read and parse
 * `environment-binding.json`, then confirm every prefix it names is still a
 * directory. This performs filesystem I/O (unlike `discipline-status.ts`'s
 * pure comparison over already-loaded data) because prefix existence can
 * only be answered by checking the disk at launch time.
 * @param dshHome - the Harness home directory the binding is scoped to.
 * @returns the status routing the caller to the workspace or onboarding.
 */
export async function resolveEnvironmentBindingStatus(dshHome: string): Promise<EnvironmentBindingStatus> {
  let raw: string
  try {
    raw = await readFile(bindingPath(dshHome), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'unbound' }
    return { kind: 'invalid', reason: `desktop environment binding: cannot read binding file (${String((error as NodeJS.ErrnoException).code ?? error)})` }
  }
  let binding: EnvironmentBinding
  try {
    binding = parseEnvironmentBinding(JSON.parse(raw))
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : String(error) }
  }
  for (const prefix of [binding.pythonPrefix, binding.rPrefix]) {
    if (prefix !== undefined && !(await directoryExists(prefix))) {
      return { kind: 'invalid', reason: `desktop environment binding: bound prefix no longer exists (${prefix})` }
    }
  }
  return { kind: 'bound', binding }
}
