import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { watchParent } from '../src/watchdog.ts'

describe.runIf(process.platform !== 'win32')('watchParent', () => {
  it('escalates to SIGKILL when the Host group ignores SIGTERM', async () => {
    const parent = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'])
    const host = spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: 'ignore',
    })
    if (parent.pid === undefined || host.pid === undefined) throw new Error('fixture process missing pid')
    const run = watchParent(parent.pid, host.pid, { pollMs: 20, graceMs: 200 })
    parent.kill('SIGKILL')
    await run
    await vi.waitFor(() => { expect(() => process.kill(host.pid as number, 0)).toThrow() })
  })

  it('stops a cooperative Host group with only SIGTERM', async () => {
    const parent = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'])
    const host = spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: 'ignore',
    })
    if (parent.pid === undefined || host.pid === undefined) throw new Error('fixture process missing pid')
    const run = watchParent(parent.pid, host.pid, { pollMs: 20, graceMs: 2_000 })
    parent.kill('SIGKILL')
    await run
    await vi.waitFor(() => { expect(() => process.kill(host.pid as number, 0)).toThrow() })
  })

  it('bounds its own lifetime and never signals the Host when the parent never disappears', async () => {
    const parent = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'])
    const host = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })
    try {
      if (parent.pid === undefined || host.pid === undefined) throw new Error('fixture process missing pid')
      await watchParent(parent.pid, host.pid, { pollMs: 10, maxLifetimeMs: 60 })
      expect(() => process.kill(host.pid as number, 0)).not.toThrow()
    } finally {
      parent.kill('SIGKILL')
      host.kill('SIGKILL')
    }
  })
})
