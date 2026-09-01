import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { InterpreterPresence } from '../src/interpreter-presence.ts'
import { desktopEnvironmentsRoot, provisionedEnvironmentsDirectory } from '../src/provisioning.ts'
import {
  parseEnvironmentBinding,
  resolveBindRequest,
  resolveEnvironmentBindingStatus,
  writeEnvironmentBinding,
  type EnvironmentBinding,
} from '../src/environment-binding.ts'

async function makeDshHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-desktop-binding-'))
}

/** A prefix path inside `dshHome`'s own provisioned environments root, the only prefixes a valid binding may name. */
function provisionedPrefix(dshHome: string, ...segments: readonly string[]): string {
  return join(provisionedEnvironmentsDirectory(desktopEnvironmentsRoot(dshHome)), ...segments)
}

describe('parseEnvironmentBinding', () => {
  it('accepts a binding with both prefixes', () => {
    expect(parseEnvironmentBinding({ pythonPrefix: '/env/py', rPrefix: '/env/r', boundAt: 1 }))
      .toEqual({ pythonPrefix: '/env/py', rPrefix: '/env/r', boundAt: 1 })
  })

  it('accepts a binding with only pythonPrefix', () => {
    expect(parseEnvironmentBinding({ pythonPrefix: '/env/py', boundAt: 1 }))
      .toEqual({ pythonPrefix: '/env/py', boundAt: 1 })
  })

  it('accepts a binding with only rPrefix', () => {
    expect(parseEnvironmentBinding({ rPrefix: '/env/r', boundAt: 1 }))
      .toEqual({ rPrefix: '/env/r', boundAt: 1 })
  })

  it('rejects a binding with neither prefix', () => {
    expect(() => parseEnvironmentBinding({ boundAt: 1 })).toThrow(/requires pythonPrefix or rPrefix/)
  })

  it('rejects a relative prefix', () => {
    expect(() => parseEnvironmentBinding({ pythonPrefix: 'relative/path', boundAt: 1 })).toThrow(/must be an absolute path/)
  })

  it('rejects an unknown field', () => {
    expect(() => parseEnvironmentBinding({ pythonPrefix: '/env/py', boundAt: 1, extra: true })).toThrow(/unknown field/)
  })

  it('rejects a non-integer boundAt', () => {
    expect(() => parseEnvironmentBinding({ pythonPrefix: '/env/py', boundAt: 'now' })).toThrow(/boundAt must be a safe integer/)
  })

  it('rejects a non-record value', () => {
    expect(() => parseEnvironmentBinding('nope')).toThrow(/must be a record/)
  })
})

describe('resolveBindRequest', () => {
  type Presence = Record<string, InterpreterPresence | undefined>
  function fakeQualify(presence: Presence): (prefix: string) => Promise<InterpreterPresence | undefined> {
    return async prefix => presence[prefix]
  }

  /**
   * Asserts `binding` matches `expected` field-by-field, with `boundAt`
   * checked only for being a number (its exact value is a timestamp
   * `resolveBindRequest` assigns internally).
   */
  function expectBinding(binding: EnvironmentBinding, expected: { readonly pythonPrefix?: string; readonly rPrefix?: string }): void {
    expect(binding.pythonPrefix).toBe(expected.pythonPrefix)
    expect(binding.rPrefix).toBe(expected.rPrefix)
    expect(typeof binding.boundAt).toBe('number')
  }

  it('resolves both prefixes when both still qualify for their interpreter', async () => {
    const qualify = fakeQualify({
      '/env/py': { python: true, r: false },
      '/env/r': { python: false, r: true },
    })

    const binding = await resolveBindRequest({ pythonPrefix: '/env/py', rPrefix: '/env/r' }, qualify)

    expectBinding(binding, { pythonPrefix: '/env/py', rPrefix: '/env/r' })
  })

  it('resolves a python-only request without re-checking an r prefix', async () => {
    const qualify = vi.fn(fakeQualify({ '/env/py': { python: true, r: false } }))

    const binding = await resolveBindRequest({ pythonPrefix: '/env/py' }, qualify)

    expectBinding(binding, { pythonPrefix: '/env/py' })
    expect(qualify).toHaveBeenCalledExactlyOnceWith('/env/py')
  })

  it('resolves an r-only request without re-checking a python prefix', async () => {
    const qualify = vi.fn(fakeQualify({ '/env/r': { python: false, r: true } }))

    const binding = await resolveBindRequest({ rPrefix: '/env/r' }, qualify)

    expectBinding(binding, { rPrefix: '/env/r' })
    expect(qualify).toHaveBeenCalledExactlyOnceWith('/env/r')
  })

  it('resolves the same prefix chosen in both groups, checking it once per interpreter', async () => {
    const qualify = fakeQualify({ '/env/both': { python: true, r: true } })

    const binding = await resolveBindRequest({ pythonPrefix: '/env/both', rPrefix: '/env/both' }, qualify)

    expectBinding(binding, { pythonPrefix: '/env/both', rPrefix: '/env/both' })
  })

  it('rejects a request naming neither prefix', async () => {
    await expect(resolveBindRequest({}, fakeQualify({})))
      .rejects.toThrow(/requires pythonPrefix or rPrefix|must include pythonPrefix or rPrefix/)
  })

  it('rejects a relative pythonPrefix without invoking the filesystem probe', async () => {
    const qualify = vi.fn(fakeQualify({}))

    await expect(resolveBindRequest({ pythonPrefix: 'relative/py' }, qualify)).rejects.toThrow(/pythonPrefix must be an absolute path/)
    expect(qualify).not.toHaveBeenCalled()
  })

  it('rejects a relative rPrefix without invoking the filesystem probe', async () => {
    const qualify = vi.fn(fakeQualify({}))

    await expect(resolveBindRequest({ rPrefix: 'relative/r' }, qualify)).rejects.toThrow(/rPrefix must be an absolute path/)
    expect(qualify).not.toHaveBeenCalled()
  })

  it('rejects when the python prefix no longer has a python interpreter', async () => {
    const qualify = fakeQualify({ '/env/py': { python: false, r: false } })

    await expect(resolveBindRequest({ pythonPrefix: '/env/py' }, qualify)).rejects.toThrow(/no longer has a Python interpreter/)
  })

  it('rejects when the r prefix no longer has an r interpreter', async () => {
    const qualify = fakeQualify({ '/env/r': { python: false, r: false } })

    await expect(resolveBindRequest({ rPrefix: '/env/r' }, qualify)).rejects.toThrow(/no longer has an R interpreter/)
  })

  it('rejects when a chosen prefix no longer qualifies as an environment at all', async () => {
    const qualify = fakeQualify({})

    await expect(resolveBindRequest({ pythonPrefix: '/env/gone' }, qualify)).rejects.toThrow(/no longer has a Python interpreter/)
  })

  it('rejects a both-groups request when only the r prefix fails its TOCTOU re-check, without resolving a partial binding', async () => {
    const qualify = fakeQualify({ '/env/py': { python: true, r: false } })

    await expect(resolveBindRequest({ pythonPrefix: '/env/py', rPrefix: '/env/r-gone' }, qualify)).rejects.toThrow(/no longer has an R interpreter/)
  })

  it('rejects a both-groups request when only the python prefix fails its TOCTOU re-check, without resolving a partial binding', async () => {
    const qualify = fakeQualify({ '/env/r': { python: false, r: true } })

    await expect(resolveBindRequest({ pythonPrefix: '/env/py-gone', rPrefix: '/env/r' }, qualify)).rejects.toThrow(/no longer has a Python interpreter/)
  })

  it('leaves no binding file on disk when a TOCTOU re-check fails, matching bindProvisionedPrefix\'s sequential resolve-then-write', async () => {
    const dshHome = await makeDshHome()
    const qualify = fakeQualify({ '/env/py': { python: true, r: false } })

    await expect((async () => {
      const binding = await resolveBindRequest({ pythonPrefix: '/env/py', rPrefix: '/env/r-gone' }, qualify)
      await writeEnvironmentBinding(dshHome, binding)
    })()).rejects.toThrow(/no longer has an R interpreter/)

    expect(await readdir(dshHome)).toEqual([])
  })
})

describe('writeEnvironmentBinding', () => {
  it('round-trips through the file it writes', async () => {
    const dshHome = await makeDshHome()
    const binding = { pythonPrefix: '/env/py', rPrefix: '/env/r', boundAt: 42 }

    await writeEnvironmentBinding(dshHome, binding)

    const raw = await readFile(join(dshHome, 'environment-binding.json'), 'utf8')
    expect(parseEnvironmentBinding(JSON.parse(raw))).toEqual(binding)
  })

  it('writes the file owner-only and leaves no temp file behind', async () => {
    const dshHome = await makeDshHome()

    await writeEnvironmentBinding(dshHome, { pythonPrefix: '/env/py', boundAt: 1 })

    const path = join(dshHome, 'environment-binding.json')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(dshHome)).toEqual(['environment-binding.json'])
  })

  it('replaces a previously written binding atomically', async () => {
    const dshHome = await makeDshHome()
    await writeEnvironmentBinding(dshHome, { pythonPrefix: '/env/py-old', boundAt: 1 })

    await writeEnvironmentBinding(dshHome, { pythonPrefix: '/env/py-new', boundAt: 2 })

    const raw = await readFile(join(dshHome, 'environment-binding.json'), 'utf8')
    expect(parseEnvironmentBinding(JSON.parse(raw))).toEqual({ pythonPrefix: '/env/py-new', boundAt: 2 })
  })
})

describe('resolveEnvironmentBindingStatus', () => {
  it('reports unbound when no binding file exists', async () => {
    const dshHome = await makeDshHome()

    expect(await resolveEnvironmentBindingStatus(dshHome)).toEqual({ kind: 'unbound' })
  })

  it('reports bound when the binding parses and every referenced prefix exists inside the provisioned environments root', async () => {
    const dshHome = await makeDshHome()
    const prefix = provisionedPrefix(dshHome, 'general', '2026.09.1')
    await mkdir(prefix, { recursive: true })
    const binding = { pythonPrefix: prefix, boundAt: 7 }
    await writeEnvironmentBinding(dshHome, binding)

    expect(await resolveEnvironmentBindingStatus(dshHome)).toEqual({ kind: 'bound', binding })
  })

  it('reports invalid for a prefix that exists but sits outside the provisioned environments root, never silently binding a foreign environment', async () => {
    const dshHome = await makeDshHome()
    const foreign = join(dshHome, 'not-ours')
    await mkdir(foreign, { recursive: true })
    await writeEnvironmentBinding(dshHome, { pythonPrefix: foreign, boundAt: 1 })

    const status = await resolveEnvironmentBindingStatus(dshHome)
    expect(status.kind).toBe('invalid')
    expect(status.kind === 'invalid' && status.reason).toContain(foreign)
    expect(status.kind === 'invalid' && status.reason).toMatch(/reinstalled/)
  })

  it('reports invalid for a prefix that exists directly at the provisioned environments root itself, not strictly inside it', async () => {
    const dshHome = await makeDshHome()
    const root = provisionedEnvironmentsDirectory(desktopEnvironmentsRoot(dshHome))
    await mkdir(root, { recursive: true })
    await writeEnvironmentBinding(dshHome, { pythonPrefix: root, boundAt: 1 })

    const status = await resolveEnvironmentBindingStatus(dshHome)
    expect(status.kind).toBe('invalid')
  })

  it('reports invalid with a loud reason for unparseable JSON', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'environment-binding.json'), '{not json', { mode: 0o600 })

    const status = await resolveEnvironmentBindingStatus(dshHome)
    expect(status.kind).toBe('invalid')
  })

  it('reports invalid with a loud reason for a schema violation', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'environment-binding.json'), JSON.stringify({ boundAt: 1 }), { mode: 0o600 })

    const status = await resolveEnvironmentBindingStatus(dshHome)
    expect(status.kind).toBe('invalid')
    expect(status.kind === 'invalid' && status.reason).toMatch(/requires pythonPrefix or rPrefix/)
  })

  it('reports invalid when a referenced prefix no longer exists, never silently falling back to unbound', async () => {
    const dshHome = await makeDshHome()
    const missing = join(dshHome, 'gone')
    await writeEnvironmentBinding(dshHome, { pythonPrefix: missing, boundAt: 1 })

    const status = await resolveEnvironmentBindingStatus(dshHome)
    expect(status.kind).toBe('invalid')
    expect(status.kind === 'invalid' && status.reason).toContain(missing)
  })
})
