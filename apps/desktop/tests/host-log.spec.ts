import { PassThrough } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { drainHostStderr, RotatingHostLog } from '../src/host-log.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
it('redacts a credential split across chunks before the first persistent write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-log-')); roots.push(root)
  const path = join(root, 'logs/host.log')
  const stderr = new PassThrough()
  const drained = drainHostStderr({ stderr }, new RotatingHostLog({ path, maxBytes: 1024, maxRotatedFiles: 2 }, { API_KEY: 'private-credential' }))
  stderr.write('response private-')
  stderr.end('credential\n')
  await drained
  expect(await readFile(path, 'utf8')).toBe('response [REDACTED]\n')
})
it('bounds oversized lines and rotates complete redacted lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-log-')); roots.push(root)
  const path = join(root, 'logs/host.log')
  const log = new RotatingHostLog({ path, maxBytes: 1024, maxRotatedFiles: 2 }, {})
  log.write('x'.repeat(1025)); log.write('a'.repeat(600)); log.write('b'.repeat(600))
  await log.flush()
  expect((await readFile(path)).length).toBeLessThanOrEqual(1024)
  expect((await readFile(`${path}.1`)).length).toBeLessThanOrEqual(1024)
})
