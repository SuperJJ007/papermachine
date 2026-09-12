import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalWindowsSigner } from '../scripts/local-windows-sign.mjs'

const processMock = vi.hoisted(() => ({
  exec: vi.fn((_file: string, _args: readonly string[], _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void) => { callback(null, '', '') }),
  repair: vi.fn(async (_path: string) => false),
}))
vi.mock('node:child_process', () => ({ execFile: processMock.exec }))
vi.mock('../scripts/windows-sign.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../scripts/windows-sign.mjs')>(),
  repairDanglingAuthenticodeDirectory: processMock.repair,
}))

beforeEach(() => { vi.clearAllMocks() })

describe('local Windows signing', () => {
  it.each([undefined, '', 'short', 'A'.repeat(39), 'G'.repeat(40), 'A'.repeat(40) + ';'])('rejects invalid certificate selection %s', (value) => {
    expect(() => createLocalWindowsSigner({ DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT: value })).toThrow(/test certificate/u)
  })

  it('repairs the NSIS certificate entry and passes target paths as data without credentials', async () => {
    const thumbprint = 'A'.repeat(40)
    const path = 'C:\\acceptance\\中文 files\\test & package.exe'
    const sign = createLocalWindowsSigner({
      DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT: thumbprint,
      SystemRoot: 'C:\\Windows',
      DEEPSEEK_API_KEY: 'must-not-be-inherited',
      DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'must-not-be-inherited',
    })
    await sign({ path, hash: 'sha256', isNest: false })
    expect(processMock.repair).toHaveBeenCalledWith(path)
    expect(processMock.exec).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-File', expect.stringContaining('local-windows-sign.ps1'),
    ], {
      env: {
        SystemRoot: 'C:\\Windows',
        DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT: thumbprint,
        DSH_LOCAL_SIGN_CERT: thumbprint,
        DSH_LOCAL_SIGN_PATH: path,
      },
      windowsHide: true,
    }, expect.any(Function))
    expect(processMock.repair.mock.invocationCallOrder[0]).toBeLessThan(processMock.exec.mock.invocationCallOrder[0]!)
  })

  it('rejects non-SHA-256 signing before touching the executable', async () => {
    const sign = createLocalWindowsSigner({ DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT: 'A'.repeat(40) })
    await expect(sign({ path: 'test.exe', hash: 'sha1', isNest: false })).rejects.toThrow(/SHA-256/u)
    expect(processMock.repair).not.toHaveBeenCalled()
    expect(processMock.exec).not.toHaveBeenCalled()
  })

  it('propagates a signing process failure', async () => {
    processMock.exec.mockImplementationOnce((_file, _args, _options, callback) => { callback(new Error('signing failed'), '', '') })
    const sign = createLocalWindowsSigner({ DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT: 'A'.repeat(40) })
    await expect(sign({ path: 'test.exe', hash: 'sha256', isNest: false })).rejects.toThrow('signing failed')
  })
})
