import { describe, expect, it } from 'vitest'
import { assertNativeInstallerTarget } from '../scripts/assert-native-installer.mjs'

describe('native Windows installer generation', () => {
  it.each(['nsis', 'nsis-web', 'portable'])('accepts %s on Windows', (target) => {
    expect(() => { assertNativeInstallerTarget(target, 'win32') }).not.toThrow()
  })

  it.each(['darwin', 'linux'] as const)('rejects every NSIS target on %s', (platform) => {
    for (const target of ['nsis', 'nsis-web', 'portable']) {
      expect(() => { assertNativeInstallerTarget(target, platform) }).toThrow('must be built on Windows')
    }
  })

  it('allows Mac disk images on macOS', () => {
    expect(() => { assertNativeInstallerTarget('dmg', 'darwin') }).not.toThrow()
  })
})
