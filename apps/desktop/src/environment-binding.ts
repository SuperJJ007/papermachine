/** Desktop-owned pointer to the conda-family prefix(es) the user bound during onboarding. */

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'
import type { InterpreterPresence } from './detection.ts'

/** The persisted binding: at least one prefix, both if the same environment carries Python and R. */
export interface EnvironmentBinding {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
  readonly boundAt: number
}

/**
 * A bind request from onboarding's independent Python and R selection
 * groups: each names a prefix chosen from that group's candidates, or is
 * absent when the group's "不绑定 / None" option was chosen.
 */
export interface BindRequest {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
}

/**
 * Resolve a {@link BindRequest} into the {@link EnvironmentBinding} to
 * persist, re-validating each chosen prefix against the specific
 * interpreter its group selected it for. The candidate list a request is
 * built from comes from an earlier detection call, and the filesystem can
 * change underneath it before the user clicks Bind (the environment
 * removed, `conda-meta` corrupted, an interpreter binary deleted), so this
 * is a TOCTOU re-check, not redundant validation. Each given prefix is
 * checked structurally (an absolute path) before this probe runs, so a
 * malformed prefix is rejected without touching the filesystem. A prefix
 * chosen in both groups is re-checked once per group since each check
 * targets a different interpreter. Rejects the whole request — never binds
 * a partial result — when either chosen prefix is not an absolute path or
 * no longer qualifies for the interpreter it was chosen for.
 * @param request - the prefixes selected in the Python and R groups.
 * @param qualify - re-checks a prefix's current interpreter presence (production: {@link qualifyingInterpreters} from `./detection.ts`).
 * @returns the binding to persist.
 * @throws when neither prefix is given, a given prefix is not an absolute
 *   path, or a given prefix no longer has the interpreter its group selected it for.
 */
export async function resolveBindRequest(
  request: BindRequest,
  qualify: (prefix: string) => Promise<InterpreterPresence | undefined>,
): Promise<EnvironmentBinding> {
  if (request.pythonPrefix === undefined && request.rPrefix === undefined) {
    throw new Error('desktop bind: request must include pythonPrefix or rPrefix')
  }
  if (request.pythonPrefix !== undefined) {
    if (!isAbsolute(request.pythonPrefix)) {
      throw new Error(`desktop bind: pythonPrefix must be an absolute path (${request.pythonPrefix})`)
    }
    const presence = await qualify(request.pythonPrefix)
    if (presence?.python !== true) throw new Error(`desktop bind: ${request.pythonPrefix} no longer has a Python interpreter`)
  }
  if (request.rPrefix !== undefined) {
    if (!isAbsolute(request.rPrefix)) {
      throw new Error(`desktop bind: rPrefix must be an absolute path (${request.rPrefix})`)
    }
    const presence = await qualify(request.rPrefix)
    if (presence?.r !== true) throw new Error(`desktop bind: ${request.rPrefix} no longer has an R interpreter`)
  }
  return parseEnvironmentBinding({ ...request, boundAt: Date.now() })
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
 * Write the binding atomically ({@link writeFileAtomic}) so a crash or
 * concurrent read never observes a partially written file, owner-only
 * (mode 0600) since the file names filesystem paths this process trusts
 * without re-validation on every read.
 * @param dshHome - the Harness home directory the binding is scoped to.
 * @param binding - the binding to persist.
 */
export async function writeEnvironmentBinding(dshHome: string, binding: EnvironmentBinding): Promise<void> {
  await writeFileAtomic(bindingPath(dshHome), `${JSON.stringify(binding)}\n`, { mode: 0o600 })
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
    const code = (error as NodeJS.ErrnoException).code ?? error
    return { kind: 'invalid', reason: `desktop environment binding: cannot read binding file (${String(code)})` }
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
