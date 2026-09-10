import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { verifyDesktopSeedRuntime } from '../scripts/verify-seed-runtime.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function project(outcome: 'ready' | 'missing-native', version = '0.1.5-rc.1'): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-seed-runtime-test-'))
  roots.push(root)
  const host = join(root, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
  mkdirSync(join(host, 'lib'), { recursive: true })
  writeFileSync(join(host, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(host, 'lib', 'index.js'), `
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
writeFileSync(join(process.cwd(), 'health-home'), process.env.DSH_HOME)
process.on('exit', () => writeFileSync(join(process.cwd(), 'exited'), 'yes'))
process.on('message', message => { if (message.type === 'shutdown') process.exit(0) })
${outcome === 'ready'
  ? `process.send({ type: 'ready', protocolVersion: 3, dshVersion: ${JSON.stringify(version)} })`
  : 'try { await import("./missing-native.js") } catch (error) { process.send({ type: "fatal", message: error.message }) }'}
`)
  return root
}

function expectDisposed(root: string): void {
  expect(readFileSync(join(root, 'exited'), 'utf8')).toBe('yes')
  expect(existsSync(readFileSync(join(root, 'health-home'), 'utf8'))).toBe(false)
}

it('accepts a ready Host and awaits its exit before removing the isolated home', async () => {
  const root = project('ready')
  await expect(verifyDesktopSeedRuntime(process.execPath, root, '0.1.5-rc.1')).resolves.toBeUndefined()
  expectDisposed(root)
})

it('rejects missing runtime dependencies even when the Host entry exists', async () => {
  const root = project('missing-native')
  await expect(verifyDesktopSeedRuntime(process.execPath, root, '0.1.5-rc.1')).rejects.toThrow('missing-native.js')
  expectDisposed(root)
})

it('rejects a Host reporting a different release and still disposes its home', async () => {
  const root = project('ready', '0.1.4')
  await expect(verifyDesktopSeedRuntime(process.execPath, root, '0.1.5-rc.1')).rejects.toThrow('Host reports 0.1.4; expected 0.1.5-rc.1')
  expectDisposed(root)
})
