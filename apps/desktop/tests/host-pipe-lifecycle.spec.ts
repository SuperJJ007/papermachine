import { close, createReadStream, createWriteStream, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeDesktopPipe } from '../../desktop-host/src/pipe-lifecycle.ts'

const roots: string[] = []

function file(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-host-pipe-close-'))
  roots.push(root)
  const path = join(root, 'bytes')
  writeFileSync(path, 'request')
  return path
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Host byte-pipe descriptor ownership', () => {
  it('finishes inherited request and response pipes before a real Host child exits', async () => {
    const entry = new URL('../../desktop-host/src/pipe-lifecycle.ts', import.meta.url).href
    const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', `
      import { createReadStream, createWriteStream } from 'node:fs'
      import { once } from 'node:events'
      import { closeDesktopPipe } from ${JSON.stringify(entry)}
      const request = createReadStream('', { fd: 3, autoClose: false })
      const response = createWriteStream('', { fd: 4, autoClose: false })
      request.resume()
      process.send('ready')
      await once(process, 'message')
      await closeDesktopPipe(request)
      await new Promise(resolve => response.end('flushed', resolve))
      await closeDesktopPipe(response)
      process.disconnect()
    `], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe', 'ipc'] })
    const exited = once(child, 'exit')
    let stderr = ''
    let response = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr += String(chunk) })
    child.stdio[4]?.on('data', (chunk: Buffer) => { response += String(chunk) })
    try {
      await once(child, 'message')
      child.send('shutdown')
      child.stdio[3]?.destroy()
      expect(await exited).toEqual([0, null])
      expect(stderr).toBe('')
      expect(response).toBe('flushed')
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
    }
  })

  it('closes the request descriptor once across concurrent and repeated shutdown', async () => {
    const fd = openSync(file(), 'r')
    const closeFd = vi.fn(close)
    const pipe = createReadStream('', { fd, autoClose: false, fs: { ...fs, close: closeFd } })
    await Promise.all([closeDesktopPipe(pipe), closeDesktopPipe(pipe)])
    await closeDesktopPipe(pipe)
    expect(closeFd).toHaveBeenCalledOnce()
    expect(pipe.closed).toBe(true)
    expect(() => fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }))
  })

  it('flushes response bytes and waits for an already requested descriptor close', async () => {
    const path = file()
    const fd = openSync(path, 'w')
    const closeFd = vi.fn(close)
    const pipe = createWriteStream('', { fd, autoClose: false, fs: { ...fs, close: closeFd } })
    await new Promise<void>((resolve) => { pipe.end('complete response', resolve) })
    pipe.destroy()
    await closeDesktopPipe(pipe)
    expect(readFileSync(path, 'utf8')).toBe('complete response')
    expect(closeFd).toHaveBeenCalledOnce()
    expect(pipe.closed).toBe(true)
    expect(() => fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }))
  })

  it('propagates descriptor close failures without retrying or swallowing EBADF', async () => {
    const fd = openSync(file(), 'w')
    const failure = Object.assign(new Error('descriptor close failed'), { code: 'EBADF' })
    const closeFd = vi.fn((descriptor: number, callback: (error: NodeJS.ErrnoException | null) => void) => {
      close(descriptor, () => { callback(failure) })
    })
    const pipe = createWriteStream('', { fd, autoClose: false, fs: { ...fs, close: closeFd } })
    await expect(closeDesktopPipe(pipe)).rejects.toBe(failure)
    expect(closeFd).toHaveBeenCalledOnce()
  })
})
