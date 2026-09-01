import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { launchHostOnRememberedPort } from '../src/host-launch.ts'
import { readRememberedHostPort } from '../src/host-port.ts'

const homes: string[] = []

async function makeDshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-host-launch-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async path => rm(path, { recursive: true, force: true })))
})

describe('launchHostOnRememberedPort', () => {
  it('requests an OS-assigned port on a first launch with nothing remembered yet', async () => {
    const dshHome = await makeDshHome()
    const attempt = vi.fn(async (port: number) => new URL(`http://127.0.0.1:${String(port === 0 ? 51204 : port)}`))

    const url = await launchHostOnRememberedPort(dshHome, attempt)

    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledWith(0)
    expect(url.port).toBe('51204')
  })

  it('reuses the remembered port on an ordinary launch, with no fallback attempt', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'host-port.json'), JSON.stringify({ port: 51204 }), 'utf8')
    const attempt = vi.fn(async (port: number) => new URL(`http://127.0.0.1:${String(port)}`))

    const url = await launchHostOnRememberedPort(dshHome, attempt)

    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledWith(51204)
    expect(url.port).toBe('51204')
  })

  it('falls back to an OS-assigned port and records the newly reported one when the remembered port is unavailable', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'host-port.json'), JSON.stringify({ port: 51204 }), 'utf8')
    const attempt = vi.fn(async (port: number) => {
      if (port === 51204) throw new Error('desktop host: exited before readiness (1)')
      return new URL('http://127.0.0.1:60123')
    })

    const url = await launchHostOnRememberedPort(dshHome, attempt)

    expect(attempt).toHaveBeenCalledTimes(2)
    expect(attempt).toHaveBeenNthCalledWith(1, 51204)
    expect(attempt).toHaveBeenNthCalledWith(2, 0)
    expect(url.port).toBe('60123')
    // The port actually reported is remembered, not the unavailable one that was requested.
    expect(await readRememberedHostPort(dshHome)).toBe(60123)
  })

  it('records the port an ordinary (non-fallback) launch reported', async () => {
    const dshHome = await makeDshHome()
    const attempt = vi.fn(async () => new URL('http://127.0.0.1:51204'))

    await launchHostOnRememberedPort(dshHome, attempt)

    expect(await readRememberedHostPort(dshHome)).toBe(51204)
  })

  it('propagates the fallback attempt failure when even an OS-assigned port fails to launch', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'host-port.json'), JSON.stringify({ port: 51204 }), 'utf8')
    const failure = new Error('desktop host: exited before readiness (1)')
    const attempt = vi.fn(async () => { throw failure })

    await expect(launchHostOnRememberedPort(dshHome, attempt)).rejects.toBe(failure)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('degrades to an OS-assigned port, without failing the launch, when the remembered-port file is corrupt', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'host-port.json'), '{ not json', 'utf8')
    const attempt = vi.fn(async (port: number) => new URL(`http://127.0.0.1:${String(port === 0 ? 51204 : port)}`))

    const url = await launchHostOnRememberedPort(dshHome, attempt)

    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledWith(0)
    expect(url.port).toBe('51204')
  })
})
