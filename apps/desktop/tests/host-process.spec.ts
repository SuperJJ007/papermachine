import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { HostProcessSupervisor, parseHostReadyLine } from '../src/host-process.ts'

function nodeCommand(source: string): ConstructorParameters<typeof HostProcessSupervisor>[0] {
  return {
    executable: process.execPath,
    args: ['--input-type=module', '--eval', source],
    cwd: process.cwd(),
    env: { ...process.env },
  }
}

describe('desktop Host supervision', () => {
  it('accepts only the stable loopback readiness line', () => {
    expect(parseHostReadyLine('dsh web: http://127.0.0.1:43123')?.href).toBe('http://127.0.0.1:43123/')
    expect(parseHostReadyLine('dsh web: http://192.0.2.1:43123')).toBeUndefined()
    expect(parseHostReadyLine('noise http://127.0.0.1:43123')).toBeUndefined()
  })

  it('rejects a Host that exits before readiness without exposing its output', async () => {
    const host = new HostProcessSupervisor(nodeCommand("console.error('fixture failed'); process.exit(7)"), { graceMs: 1000 })
    await expect(host.start()).rejects.toThrow(/exited before readiness \(7\)$/)
  })

  it('reports an unexpected ready-Host exit and can restart over the same command', async () => {
    const onUnexpectedExit = vi.fn()
    const host = new HostProcessSupervisor(nodeCommand(
      "console.log('dsh web: http://127.0.0.1:43123'); setTimeout(() => process.exit(9), 40)",
    ), { onUnexpectedExit, graceMs: 1000 })
    await expect(host.start()).resolves.toMatchObject({ port: '43123' })
    await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledWith({ code: 9, signal: null }) })
    await expect(host.start()).resolves.toMatchObject({ port: '43123' })
    await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledTimes(2) })
  })

  it('stops the ready Host process group cooperatively', async () => {
    const host = new HostProcessSupervisor(nodeCommand(
      "process.on('SIGTERM', () => process.exit(0)); console.log('dsh web: http://127.0.0.1:43123'); setInterval(() => {}, 1000)",
    ), { graceMs: 1000 })
    await host.start()
    const pid = host.pid
    expect(pid).toBeTypeOf('number')
    await host.stop()
    expect(() => process.kill(pid as number, 0)).toThrow()
  })

  it.runIf(process.platform !== 'win32')('escalates to the process group when a grandchild ignores SIGTERM after the Host itself exits', async () => {
    // A real grandchild that ignores SIGTERM, in the same POSIX process
    // group as the Host: the direct child (the "Host") exits cleanly on
    // SIGTERM while the grandchild survives, so only a group-level SIGKILL
    // after the grace period collects it.
    const dir = await mkdtemp(join(tmpdir(), 'dsh-desktop-host-stop-'))
    const pidFile = join(dir, 'grandchild.pid')
    const source = `
      const { spawn } = require('node:child_process')
      const fs = require('node:fs')
      const grandchild = spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' })
      fs.writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid))
      console.log('dsh web: http://127.0.0.1:43123')
      process.on('SIGTERM', () => process.exit(0))
      setInterval(() => {}, 1000)
    `
    const host = new HostProcessSupervisor({
      executable: process.execPath,
      args: ['--eval', source],
      cwd: process.cwd(),
      env: { ...process.env },
    }, { graceMs: 300 })
    await host.start()
    const grandchildPid = Number(await readFile(pidFile, 'utf8'))
    await host.stop()
    await vi.waitFor(() => { expect(() => process.kill(grandchildPid, 0)).toThrow() })
  })

  it.runIf(process.platform !== 'win32')('watchdog collects the Host group after its parent disappears', async () => {
    const host = spawn(process.execPath, ['--input-type=module', '--eval', 'setInterval(() => {}, 1000)'], {
      detached: true,
    })
    if (host.pid === undefined) throw new Error('fixture process missing pid')
    const watchdogEntry = fileURLToPath(new URL('../src/watchdog.ts', import.meta.url))
    // The watchdog detects Electron's death by its own OS ppid changing away
    // from the original parent, so it must be spawned as a genuine child of
    // "parent" (mirroring main.ts spawning it directly from Electron) rather
    // than by this test process, or killing "parent" would never reparent
    // it. "parent" is only killed once it has actually reached the spawn
    // call, so a slow process start cannot get SIGKILLed before the
    // watchdog exists at all.
    const dir = await mkdtemp(join(tmpdir(), 'dsh-desktop-host-watchdog-'))
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
})
