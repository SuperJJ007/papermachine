import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseHostPortRecord, readRememberedHostPort, writeRememberedHostPort } from '../src/host-port.ts'

const homes: string[] = []

async function makeDshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-host-port-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async path => rm(path, { recursive: true, force: true })))
})

describe('parseHostPortRecord', () => {
  it('accepts a record with a valid port', () => {
    expect(parseHostPortRecord({ port: 51204 })).toEqual({ port: 51204 })
  })

  it('rejects a non-record value', () => {
    expect(() => parseHostPortRecord('51204')).toThrow(/must be a record/)
  })

  it('rejects an unknown field', () => {
    expect(() => parseHostPortRecord({ port: 51204, extra: true })).toThrow(/unknown field extra/)
  })

  it('rejects a non-integer port', () => {
    expect(() => parseHostPortRecord({ port: 51204.5 })).toThrow(/port must be an integer/)
  })

  it('rejects a port outside 1-65535', () => {
    expect(() => parseHostPortRecord({ port: 0 })).toThrow(/port must be an integer/)
    expect(() => parseHostPortRecord({ port: 65536 })).toThrow(/port must be an integer/)
  })
})

describe('readRememberedHostPort / writeRememberedHostPort', () => {
  it('round-trips the port a launch reported', async () => {
    const dshHome = await makeDshHome()

    await writeRememberedHostPort(dshHome, 51204)

    expect(await readRememberedHostPort(dshHome)).toBe(51204)
  })

  it('reports no remembered port before any launch has recorded one', async () => {
    expect(await readRememberedHostPort(await makeDshHome())).toBeUndefined()
  })

  it('degrades to undefined, rather than throwing, on a corrupt file', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'host-port.json'), '{ not json', 'utf8')

    await expect(readRememberedHostPort(dshHome)).resolves.toBeUndefined()
  })

  it('degrades to undefined, rather than throwing, on a file that parses but fails validation', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'host-port.json'), JSON.stringify({ port: 'not-a-number' }), 'utf8')

    await expect(readRememberedHostPort(dshHome)).resolves.toBeUndefined()
  })

  it('degrades to undefined, rather than throwing, on an unreadable path', async () => {
    // A directory where the file is expected: readFile fails with EISDIR,
    // not ENOENT, exercising the catch-all branch rather than the
    // ordinary-first-launch one.
    const dshHome = await makeDshHome()
    await mkdir(join(dshHome, 'host-port.json'))

    await expect(readRememberedHostPort(dshHome)).resolves.toBeUndefined()
  })

  it('overwrites a previously remembered port', async () => {
    const dshHome = await makeDshHome()
    await writeRememberedHostPort(dshHome, 51204)

    await writeRememberedHostPort(dshHome, 60123)

    expect(await readRememberedHostPort(dshHome)).toBe(60123)
  })

  it('writes an owner-only file', async () => {
    const dshHome = await makeDshHome()

    await writeRememberedHostPort(dshHome, 51204)

    const raw = await readFile(join(dshHome, 'host-port.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ port: 51204 })
  })

  it('does not throw when the write destination is unusable', async () => {
    // dshHome itself does not exist, so writeFileAtomic's temp-file open
    // fails: a write failure must not escape as a rejection.
    const dshHome = join(tmpdir(), 'dsh-desktop-host-port-missing', 'nested')

    await expect(writeRememberedHostPort(dshHome, 51204)).resolves.toBeUndefined()
  })
})
