import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { watchParent } from '../src/watchdog.ts'

describe.runIf(process.platform !== 'win32')('watchParent', () => {
  it('detects a real parent process disappearing via ppid reparenting, then stops the Host group', async () => {
    // The watchdog must be a genuine OS child of "parent" (mirroring
    // main.ts spawning it directly from Electron), so killing "parent"
    // exercises real ppid reparenting rather than a value only passed as an
    // argument the watchdog never actually descends from. "parent" is only
    // killed once it has actually reached the spawn call — otherwise a slow
    // process start could get SIGKILLed before the watchdog exists at all.
    const host = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    })
    if (host.pid === undefined) throw new Error('fixture process missing pid')
    const watchdogEntry = fileURLToPath(new URL('../src/watchdog.ts', import.meta.url))
    const dir = await mkdtemp(join(tmpdir(), 'dsh-desktop-watchdog-'))
    const spawnedMarker = join(dir, 'watchdog-spawned')
    const parentSource = `
      const { spawn } = require('node:child_process')
      const fs = require('node:fs')
      spawn(${JSON.stringify(process.execPath)}, ['--import', 'tsx/esm', ${JSON.stringify(watchdogEntry)}, String(process.pid), ${JSON.stringify(String(host.pid))}], { detached: true, stdio: 'ignore' })
      fs.writeFileSync(${JSON.stringify(spawnedMarker)}, 'spawned')
      setInterval(() => {}, 1000)
    `
    const parent = spawn(process.execPath, ['--eval', parentSource])
    if (parent.pid === undefined) throw new Error('fixture process missing pid')
    await vi.waitFor(async () => { await access(spawnedMarker) })
    parent.kill('SIGKILL')
    await once(parent, 'exit')
    await vi.waitFor(() => { expect(() => process.kill(host.pid as number, 0)).toThrow() }, { timeout: 5_000 })
  })

  it('escalates to SIGKILL when the Host group ignores SIGTERM', async () => {
    // watchParent's loop only cares whether process.ppid still equals the
    // given parentPid; passing a value that can never match this test
    // process's real ppid exercises the SIGTERM/escalate mechanics directly,
    // without the overhead of a real parent-death fixture per case.
    const alreadyGoneParentPid = process.ppid + 1
    const host = spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: 'ignore',
    })
    if (host.pid === undefined) throw new Error('fixture process missing pid')
    await watchParent(alreadyGoneParentPid, host.pid, { pollMs: 20, graceMs: 200 })
    await vi.waitFor(() => { expect(() => process.kill(host.pid as number, 0)).toThrow() })
  })

  it('stops a cooperative Host group with only SIGTERM', async () => {
    const alreadyGoneParentPid = process.ppid + 1
    const host = spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: 'ignore',
    })
    if (host.pid === undefined) throw new Error('fixture process missing pid')
    await watchParent(alreadyGoneParentPid, host.pid, { pollMs: 20, graceMs: 2_000 })
    await vi.waitFor(() => { expect(() => process.kill(host.pid as number, 0)).toThrow() })
  })

  it('leaves the Host group alone while its ppid still matches the given parent', async () => {
    const host = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    })
    if (host.pid === undefined) throw new Error('fixture process missing pid')
    await Promise.race([
      watchParent(process.ppid, host.pid, { pollMs: 10 }),
      new Promise(resolve => setTimeout(resolve, 100)),
    ])
    expect(() => process.kill(host.pid as number, 0)).not.toThrow()
    host.kill('SIGKILL')
  })
})
