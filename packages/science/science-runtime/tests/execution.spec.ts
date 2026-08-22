/** Focused coverage for execution.ts's standalone helpers not otherwise exercised through the run pipeline. */

import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { interpreterArgv, quiesce, readCaptureTail } from '../src/execution.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('interpreterArgv', () => {
  it('drops isolated mode for a Python kernel so PYTHONUSERBASE-scoped inline installs are importable', () => {
    expect(interpreterArgv('python', '/prefix/bin/python', '/driver.py', '/resp.fifo'))
      .toEqual(['/prefix/bin/python', '-B', '-u', '-X', 'utf8', '/driver.py', '/resp.fifo'])
  })

  it('leaves the R kernel flag set unaffected', () => {
    expect(interpreterArgv('r', '/prefix/bin/Rscript', '/driver.R', '/resp.fifo'))
      .toEqual(['/prefix/bin/Rscript', '--vanilla', '--encoding=UTF-8', '/driver.R', '/resp.fifo'])
  })
})

describe('readCaptureTail', () => {
  it('reads an existing empty file the same way as a missing one', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-execution-tail-'))
    roots.push(root)
    const path = join(root, 'stdout.txt')
    closeSync(openSync(path, 'w'))
    await expect(readCaptureTail(path)).resolves.toEqual({ text: '', bytes: 0, truncated: false })
    await expect(readCaptureTail(join(root, 'never-written.txt'))).resolves.toEqual({ text: '', bytes: 0, truncated: false })
  })

  it('reads a short existing file whole, untruncated', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-execution-tail-short-'))
    roots.push(root)
    const path = join(root, 'stdout.txt')
    const fd = openSync(path, 'w')
    writeSync(fd, 'hello')
    closeSync(fd)
    await expect(readCaptureTail(path)).resolves.toEqual({ text: 'hello', bytes: 5, truncated: false })
  })
})

describe('quiesce', () => {
  it('waits again after a forced termination and proves quiescence within the second grace window', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn({
      argv: [process.execPath, '-e', 'setInterval(() => {}, 1_000)'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
      graceMs: 3_000,
      environmentBase: 'empty',
    })
    // The process never exits on its own within the first grace window, so
    // the first waitForExit(grace) proves false; terminate() then sends
    // SIGTERM, which this plain Node process has installed no handler
    // against, so the second waitForExit(forced) proves quiescence quickly.
    await expect(quiesce(handle)).resolves.toEqual({ quiescent: true, forced: true })
  }, 15_000)

  it('returns eventual quiescence unproven when the tree survives both bounded grace windows', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn({
      argv: [process.execPath, '-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)"],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
      graceMs: 3_000,
      environmentBase: 'empty',
    })
    // This process ignores SIGTERM, so terminate() cannot prove quiescence
    // within the second grace window either; the caller keeps quarantine
    // active on the returned eventualQuiescence instead.
    const result = await quiesce(handle)
    expect(result).toMatchObject({ quiescent: false, forced: true })
    if (result.quiescent) throw new Error('unreachable: asserted above')
    // SIGTERM alone never reaps this process: prove eventualQuiescence
    // resolves once something unblockable (SIGKILL) finally does, rather
    // than hanging the test forever on a tree only this test owns.
    try {
      process.kill(-handle.pid, 'SIGKILL')
    } catch {
      process.kill(handle.pid, 'SIGKILL')
    }
    await expect(result.eventualQuiescence).resolves.toBe(true)
  }, 15_000)
})
