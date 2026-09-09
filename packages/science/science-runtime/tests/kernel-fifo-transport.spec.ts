/** FIFO resource ownership through a controlled subprocess seam, independent of host IPC support. */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { createKernelResponseTransport } from '../src/kernel-transport.ts'

const fault = vi.hoisted(() => ({ unlink: undefined as unknown }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
    if (fault.unlink !== undefined) throw fault.unlink
    return actual.unlink(path)
  } }
})
const roots: string[] = []
afterEach(() => {
  fault.unlink = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function harness() {
  const root = mkdtempSync(join(process.cwd(), '.science-fifo-ownership-'))
  roots.push(root)
  const stream = new PassThrough()
  const exit = Promise.withResolvers<SubprocessOutcome>()
  const waitForExit = vi.fn(async (_signal?: AbortSignal) => true)
  const terminate = vi.fn(() => { exit.resolve({ exitCode: 0, signal: null }) })
  // The transport consumes only stdout, done, terminate, and waitForExit from its forwarding handle.
  const reader = { stdout: stream, done: exit.promise, waitForExit, terminate } as unknown as SubprocessHandle
  const resolveExecutable = vi.fn(async (name: string) => name)
  const spawn = vi.fn((spec: SubprocessSpawnSpec): SubprocessHandle => {
    if (spec.argv[0] !== 'mkfifo') return reader
    writeFileSync(spec.argv[1]!, '')
    // The subprocess seam owns IPC creation; this fixture supplies only the owned path and exit evidence.
    return { done: Promise.resolve({ exitCode: 0, signal: null }) } as SubprocessHandle
  })
  const subprocess = { resolveExecutable, spawn } as unknown as SubprocessRuntime
  return { root, stream, exit, waitForExit, terminate, reader, resolveExecutable, spawn, subprocess }
}

describe('FIFO resource ownership', () => {
  it('selects TCP without creating a FIFO resource', async () => {
    const h = harness()
    const transport = await createKernelResponseTransport('tcp', h.subprocess, h.root)
    expect(transport.endpointArg).toMatch(/^tcp:127\.0\.0\.1:/)
    expect(h.spawn).not.toHaveBeenCalled()
    await transport.endStartFailure()
  })

  it('rejects a delimiter-bearing response path before filesystem or subprocess work', async () => {
    const h = harness()
    await expect(createKernelResponseTransport('fifo', h.subprocess, `${h.root}\tinvalid`)).rejects.toThrow(/delimiter|tab or newline/)
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('replaces stale resources, forwards bytes, and removes the path after reader exit', async () => {
    const h = harness()
    writeFileSync(join(h.root, 'resp.fifo'), 'stale')
    const transport = await createKernelResponseTransport('fifo', h.subprocess, h.root)
    expect(transport.endpointArg).toBe(join(h.root, 'resp.fifo'))
    expect(await transport.connect(h.reader, 100, undefined)).toBe(h.stream)
    expect(h.stream.readableEncoding).toBe('utf8')
    await expect(transport.end()).resolves.toEqual({ quiescent: true, forced: false })
    expect(h.terminate).toHaveBeenCalledOnce()
    expect(h.stream.destroyed).toBe(true)
    expect(existsSync(transport.endpointArg)).toBe(false)
    await transport.endStartFailure()
  })

  it.each([true, false])('reports mkfifo failure with collected stderr present: %s', async (stderr) => {
    const h = harness()
    h.spawn.mockImplementationOnce(() => ({ done: Promise.resolve({ exitCode: 1, signal: null }),
      collected: stderr ? { stderr: { readFrom: () => ({ text: 'denied' }) } } : {},
    }) as unknown as SubprocessHandle)
    await expect(createKernelResponseTransport('fifo', h.subprocess, h.root)).rejects.toThrow(stderr ? /denied/ : /exitCode=1/)
    expect(existsSync(join(h.root, 'resp.fifo'))).toBe(false)
  })

  it('removes a created path when the forwarding executable cannot be resolved', async () => {
    const h = harness()
    h.resolveExecutable.mockRejectedValueOnce(new Error('mkfifo unavailable'))
    await expect(createKernelResponseTransport('fifo', h.subprocess, h.root)).rejects.toThrow('mkfifo unavailable')
    h.resolveExecutable.mockResolvedValueOnce('mkfifo').mockRejectedValueOnce(new Error('cat unavailable'))
    await expect(createKernelResponseTransport('fifo', h.subprocess, h.root)).rejects.toThrow('cat unavailable')
    expect(existsSync(join(h.root, 'resp.fifo'))).toBe(false)
  })

  it.each([true, false])('awaits missing-stdout reader cleanup with immediately proven exit: %s', async (immediate) => {
    const h = harness()
    const proof = Promise.withResolvers<boolean>()
    const observed = Promise.withResolvers<undefined>()
    h.waitForExit.mockImplementation((signal) => {
      if (immediate) return Promise.resolve(true)
      if (signal !== undefined) return Promise.resolve(false)
      observed.resolve(undefined)
      return proof.promise
    })
    h.spawn.mockImplementationOnce((spec) => {
      writeFileSync(spec.argv[1]!, '')
      return { done: Promise.resolve({ exitCode: 0, signal: null }) } as SubprocessHandle
    }).mockReturnValueOnce({ ...h.reader, stdout: undefined })
    const creation = createKernelResponseTransport('fifo', h.subprocess, h.root)
    const rejected = expect(creation).rejects.toThrow(/stdout pipe/)
    if (!immediate) {
      await observed.promise
      expect(existsSync(join(h.root, 'resp.fifo'))).toBe(true)
      proof.resolve(true)
    }
    await rejected
    expect(existsSync(join(h.root, 'resp.fifo'))).toBe(false)
  })

  it('retains an unbounded reader-exit observation during failed startup cleanup', async () => {
    const h = harness()
    const transport = await createKernelResponseTransport('fifo', h.subprocess, h.root)
    const proof = Promise.withResolvers<boolean>()
    const observed = Promise.withResolvers<undefined>()
    h.waitForExit.mockImplementation((signal) => {
      if (signal !== undefined) return Promise.resolve(false)
      observed.resolve(undefined)
      return proof.promise
    })
    h.terminate.mockImplementation(() => { throw new Error('terminate failed') })
    const cleanup = transport.endStartFailure()
    await observed.promise
    expect(existsSync(transport.endpointArg)).toBe(true)
    proof.resolve(true)
    await cleanup
    expect(existsSync(transport.endpointArg)).toBe(false)
  })

  it('publishes a forwarding provider rejection through faulted', async () => {
    const h = harness()
    const transport = await createKernelResponseTransport('fifo', h.subprocess, h.root)
    const failed = expect(transport.faulted).rejects.toThrow('reader failed')
    h.exit.reject(new Error('reader failed'))
    await failed
    await transport.endStartFailure()
  })

  it.each([null, 'unlink failed', Object.assign(new Error('denied'), { code: 'EACCES' })])('propagates a non-missing unlink error: %s', async (error) => {
    const h = harness()
    fault.unlink = error
    await expect(createKernelResponseTransport('fifo', h.subprocess, h.root)).rejects.toBe(error)
  })
})
