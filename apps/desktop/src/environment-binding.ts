/** Desktop-owned pointer to the conda-family prefix(es) the user bound during onboarding. */

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'
import { IDENTIFIER } from './environment-declaration.ts'
import type { InterpreterPresence } from './interpreter-presence.ts'
import { desktopEnvironmentsRoot, provisionedEnvironmentsDirectory } from './provisioning.ts'

/**
 * The persisted binding: at least one prefix (both if the same environment
 * carries Python and R), and the id of the package source whose provisioning
 * attempt succeeded — the Host's package installs start from that source.
 */
export interface EnvironmentBinding {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
  readonly sourceId: string
  readonly boundAt: number
}

/**
 * A bind request naming the prefix(es) to persist as the environment
 * binding: `bindProvisionedPrefix` (`main.ts`) is the only caller, passing
 * the one prefix a provisioning run just published as both fields (one
 * provisioned prefix carries both interpreters). Python and R remain
 * independent fields because {@link EnvironmentBinding} itself keeps them
 * independent.
 */
export interface BindRequest {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
  /** The id of the package source the provisioning run succeeded through. */
  readonly sourceId: string
}

/**
 * Resolve a {@link BindRequest} into the {@link EnvironmentBinding} to
 * persist, re-validating each named prefix against the specific interpreter
 * it is bound for. This is a defense-in-depth re-check, not redundant
 * validation: it re-proves the health checks that already ran during
 * provisioning against the exact path about to be written, rather than
 * trusting them a second time untested. Each given prefix is checked
 * structurally (an absolute path) before this probe runs, so a malformed
 * prefix is rejected without touching the filesystem. A prefix given for
 * both fields is re-checked once per interpreter. Rejects the whole
 * request — never binds a partial result — when either named prefix is not
 * an absolute path or does not qualify for the interpreter it was named for.
 * @param request - the prefix(es) to bind.
 * @param qualify - re-checks a prefix's current interpreter presence
 *   (production: {@link qualifyingInterpreters} from `./interpreter-presence.ts`).
 * @returns the binding to persist.
 * @throws when neither prefix is given, `sourceId` is not an identifier, a
 *   given prefix is not an absolute path, or a given prefix does not have the
 *   interpreter it was named for.
 */
export async function resolveBindRequest(
  request: BindRequest,
  qualify: (prefix: string) => Promise<InterpreterPresence | undefined>,
): Promise<EnvironmentBinding> {
  if (request.pythonPrefix === undefined && request.rPrefix === undefined) {
    throw new Error('desktop bind: request must include pythonPrefix or rPrefix')
  }
  if (!IDENTIFIER.test(request.sourceId)) {
    throw new Error(`desktop bind: sourceId must be a lowercase identifier (${request.sourceId})`)
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

const FIELDS = ['pythonPrefix', 'rPrefix', 'sourceId', 'boundAt'] as const

function bindingPath(dshHome: string): string {
  return join(dshHome, 'environment-binding.json')
}

/**
 * Parse an untrusted JSON value into an {@link EnvironmentBinding}.
 * @param value - the parsed JSON content of `environment-binding.json`.
 * @throws when a field is missing, has the wrong type, `sourceId` is not an identifier, or neither prefix is present.
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
  if (typeof record.sourceId !== 'string' || !IDENTIFIER.test(record.sourceId)) {
    throw new Error('desktop environment binding: sourceId must be a lowercase identifier')
  }
  if (!Number.isSafeInteger(record.boundAt)) {
    throw new Error('desktop environment binding: boundAt must be a safe integer')
  }
  return {
    ...(record.pythonPrefix === undefined ? {} : { pythonPrefix: record.pythonPrefix as string }),
    ...(record.rPrefix === undefined ? {} : { rPrefix: record.rPrefix as string }),
    sourceId: record.sourceId,
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
 * `bound` — a binding file exists, parses, every prefix it names still
 * exists on disk, and every prefix it names is inside this application's own
 * provisioned environments root. `unbound` — no binding file exists yet;
 * onboarding is a first run. `invalid` — a binding file exists but cannot be
 * trusted (parse failure, an unreadable file, a prefix it names has since
 * disappeared, or a prefix it names is outside this application's own
 * provisioned environments root — a foreign conda-family environment a prior
 * build once bound, from before this application owned its environment
 * outright); `reason` is a loud, user-facing status, never a silent
 * fall-through to onboarding's first-run copy.
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
 * Whether `prefix` sits strictly inside this application's own provisioned
 * environments root (`<dshHome>/desktop-environments/environments/`), the
 * only prefixes this application may ever bind since it stopped offering a
 * bind-an-existing-environment route. A binding written before that change,
 * or one otherwise naming a foreign conda-family install, must not silently
 * keep working — {@link resolveEnvironmentBindingStatus} routes it back to
 * onboarding instead.
 * @param dshHome - the Harness home the binding is scoped to.
 * @param prefix - the bound prefix to check.
 */
function isWithinProvisionedRoot(dshHome: string, prefix: string): boolean {
  const root = provisionedEnvironmentsDirectory(desktopEnvironmentsRoot(dshHome))
  const rel = relative(root, prefix)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * Resolve the binding status driving `openInitialSurface`: read and parse
 * `environment-binding.json`, then confirm every prefix it names is still a
 * directory inside this application's own provisioned environments root.
 * This performs filesystem I/O (unlike `discipline-status.ts`'s pure
 * comparison over already-loaded data) because prefix existence can only be
 * answered by checking the disk at launch time.
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
    if (prefix === undefined) continue
    if (!(await directoryExists(prefix))) {
      return { kind: 'invalid', reason: `desktop environment binding: bound prefix no longer exists (${prefix})` }
    }
    if (!isWithinProvisionedRoot(dshHome, prefix)) {
      return {
        kind: 'invalid',
        reason: `desktop environment binding: ${prefix} is not an environment PaperMachine installed; the environment must be reinstalled`,
      }
    }
  }
  return { kind: 'bound', binding }
}
