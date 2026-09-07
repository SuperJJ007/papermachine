import { describe, expect, it, vi } from 'vitest'
import { maybeSignMacApp, signMacApp } from '../scripts/sign-mac-app.mjs'

const APP_PATH = '/Applications/PaperMachine.app'

describe('signMacApp', () => {
  it('signs before verifying, both against appPath, with codesign as the command', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const execFile = vi.fn(async (command: string, args: readonly string[]) => {
      calls.push({ command, args })
      return { stdout: '', stderr: '' }
    })

    await signMacApp(APP_PATH, execFile)

    expect(calls).toEqual([
      { command: 'codesign', args: ['--force', '--deep', '--sign', '-', APP_PATH] },
      { command: 'codesign', args: ['--verify', '--deep', '--strict', '--verbose=2', APP_PATH] },
    ])
  })

  it('throws with the verify invocation\'s stderr when verification fails', async () => {
    const execFile = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === '--verify') {
        throw Object.assign(new Error('Command failed'), {
          stderr: 'code has no resources but signature indicates they must be present',
        })
      }
      return { stdout: '', stderr: '' }
    })

    await expect(signMacApp(APP_PATH, execFile)).rejects.toThrow(
      /code has no resources but signature indicates they must be present/,
    )
  })

  it('throws with the sign invocation\'s stderr when signing itself fails, without attempting verify', async () => {
    const execFile = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === '--force') {
        throw Object.assign(new Error('Command failed'), { stderr: 'codesign: no identity found' })
      }
      return { stdout: '', stderr: '' }
    })

    await expect(signMacApp(APP_PATH, execFile)).rejects.toThrow(/no identity found/)
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('throws with the underlying error message when the sign invocation fails with no stderr, such as a missing codesign binary', async () => {
    const execFile = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === '--force') {
        throw Object.assign(new Error('spawn codesign ENOENT'), { code: 'ENOENT' })
      }
      return { stdout: '', stderr: '' }
    })

    await expect(signMacApp(APP_PATH, execFile)).rejects.toThrow(/codesign sign failed/)
    await expect(signMacApp(APP_PATH, execFile)).rejects.toThrow(/ENOENT/)
  })

  it('forwards stdout and stderr from a successful invocation into the process streams', async () => {
    const execFile = vi.fn(async (_command: string, args: readonly string[]) =>
      args[0] === '--force'
        ? { stdout: 'signing PaperMachine.app\n', stderr: '' }
        : { stdout: '', stderr: 'PaperMachine.app: valid on disk\n' },
    )
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      await signMacApp(APP_PATH, execFile)

      expect(stdoutWrite).toHaveBeenCalledWith('signing PaperMachine.app\n')
      expect(stderrWrite).toHaveBeenCalledWith('PaperMachine.app: valid on disk\n')
    } finally {
      stdoutWrite.mockRestore()
      stderrWrite.mockRestore()
    }
  })
})

describe('maybeSignMacApp', () => {
  it('signs for darwin', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }))

    await maybeSignMacApp('darwin', APP_PATH, execFile)

    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('does not invoke codesign for a non-darwin target', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }))

    await maybeSignMacApp('win32', APP_PATH, execFile)
    await maybeSignMacApp('linux', APP_PATH, execFile)

    expect(execFile).not.toHaveBeenCalled()
  })
})
