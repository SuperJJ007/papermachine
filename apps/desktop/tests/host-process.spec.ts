import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostProcessSupervisor, parseHostReadyLine, type HostStderrLog } from '../src/host-process.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function stderrLog(maxBytes = 1024, maxRotatedFiles = 2): HostStderrLog {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-log-'))
  roots.push(dshHome)
  return { path: join(dshHome, 'logs', 'host.log'), maxBytes, maxRotatedFiles }
}

function nodeCommand(
  source: string,
  options: { readonly env?: NodeJS.ProcessEnv; readonly stderrLog?: HostStderrLog } = {},
): ConstructorParameters<typeof HostProcessSupervisor>[0] {
  return {
    executable: process.execPath,
    args: ['--input-type=module', '--eval', source],
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stderrLog: options.stderrLog ?? stderrLog(),
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

  it.runIf(process.platform !== 'win32')('rejects promptly when the Host exits before readiness but a grandchild keeps its stderr pipe open', async () => {
    // Mirrors a real subagent process (spawn(..., { stderr: 'inherit' })):
    // the grandchild duplicates the "Host" fixture's own stderr file
    // descriptor, so the pipe this supervisor reads from never sees EOF even
    // after the fixture process itself has exited. The grandchild is
    // detached/unref'd from this test and self-exits after 3s as a backstop.
    const source = `
      const { spawn } = require('node:child_process')
      spawn(process.execPath, ['--eval', 'setTimeout(() => {}, 3000)'], { stdio: ['ignore', 'ignore', 'inherit'], detached: true }).unref()
      process.exit(3)
    `
    const host = new HostProcessSupervisor({
      executable: process.execPath,
      args: ['--eval', source],
      cwd: process.cwd(),
      env: { ...process.env },
      stderrLog: stderrLog(),
    }, { graceMs: 1000 })
    const startedAt = Date.now()

    await expect(host.start()).rejects.toThrow(/exited before readiness \(3\)$/)

    expect(Date.now() - startedAt).toBeLessThan(2000)
  })

  it('rotates Host stderr within the configured byte and retention bounds', async () => {
    const log = stderrLog(1024, 2)
    await mkdir(dirname(log.path), { recursive: true })
    await writeFile(`${log.path}.3`, 'stale rotation')
    const onUnexpectedExit = vi.fn()
    const source = [
      "process.stderr.write('A'.repeat(700) + '\\n')",
      "process.stderr.write('B'.repeat(700) + '\\n')",
      "process.stderr.write('C'.repeat(700) + '\\n')",
      "console.log('dsh web: http://127.0.0.1:43123')",
      'setTimeout(() => process.exit(0), 20)',
    ].join(';')
    const host = new HostProcessSupervisor(nodeCommand(source, { stderrLog: log }), { onUnexpectedExit, graceMs: 1000 })
    await host.start()
    await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledOnce() })

    const files = await Promise.all([log.path, `${log.path}.1`, `${log.path}.2`].map(path => readFile(path)))
    expect(files.map(file => file.byteLength)).toEqual([701, 701, 701])
    await expect(access(`${log.path}.3`)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(files[0]?.toString()).toMatch(/^C+\n$/)
    expect(files[1]?.toString()).toMatch(/^B+\n$/)
    expect(files[2]?.toString()).toMatch(/^A+\n$/)
  })

  it('redacts inherited and labeled credentials before persisting Host stderr', async () => {
    const log = stderrLog()
    const onUnexpectedExit = vi.fn()
    const source = [
      "console.error('env=' + process.env.DEEPSEEK_API_KEY)",
      "console.error('apiKey=literal-secret-value')",
      "console.error('Authorization: Bearer bearer-secret-value')",
      "console.log('dsh web: http://127.0.0.1:43123')",
      'setTimeout(() => process.exit(0), 20)',
    ].join(';')
    const host = new HostProcessSupervisor(nodeCommand(source, {
      env: { DEEPSEEK_API_KEY: 'abc' },
      stderrLog: log,
    }), { onUnexpectedExit, graceMs: 1000 })
    await host.start()
    await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledOnce() })

    const persisted = await readFile(log.path, 'utf8')
    expect(persisted).not.toContain('env=abc')
    expect(persisted).not.toContain('literal-secret-value')
    expect(persisted).not.toContain('bearer-secret-value')
    expect(persisted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(3)
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
      stderrLog: stderrLog(),
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
