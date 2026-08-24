import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseEnvironmentBinding,
  resolveEnvironmentBindingStatus,
  writeEnvironmentBinding,
} from '../src/environment-binding.ts'

async function makeDshHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-desktop-binding-'))
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

  it('reports bound when the binding parses and every referenced prefix exists', async () => {
    const dshHome = await makeDshHome()
    const prefix = join(dshHome, 'env')
    await mkdir(prefix, { recursive: true })
    const binding = { pythonPrefix: prefix, boundAt: 7 }
    await writeEnvironmentBinding(dshHome, binding)

    expect(await resolveEnvironmentBindingStatus(dshHome)).toEqual({ kind: 'bound', binding })
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
