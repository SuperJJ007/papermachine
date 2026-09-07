import { describe, expect, it } from 'vitest'
import { parseNativeModuleEntry, selectNativeModuleTargets } from '../scripts/native-module-targets.mjs'

/** The `@img` scope's full entry list once every desktop packaging target's variant is installed. */
const SHARP_ENTRIES = [
  'colour',
  'sharp-darwin-arm64',
  'sharp-darwin-x64',
  'sharp-win32-x64',
  'sharp-libvips-darwin-arm64',
  'sharp-libvips-darwin-x64',
]

/** The `@koromix` scope's full entry list once every desktop packaging target's variant is installed. */
const KOFFI_ENTRIES = ['koffi-darwin-arm64', 'koffi-darwin-x64', 'koffi-win32-x64']

describe('parseNativeModuleEntry', () => {
  it('parses a sharp entry', () => {
    expect(parseNativeModuleEntry('sharp-darwin-arm64')).toEqual({
      name: 'sharp-darwin-arm64', family: 'sharp', os: 'darwin', arch: 'arm64',
    })
  })

  it('parses a sharp-libvips entry as its own family, not sharp', () => {
    expect(parseNativeModuleEntry('sharp-libvips-darwin-x64')).toEqual({
      name: 'sharp-libvips-darwin-x64', family: 'sharp-libvips', os: 'darwin', arch: 'x64',
    })
  })

  it('parses a koffi entry', () => {
    expect(parseNativeModuleEntry('koffi-win32-x64')).toEqual({
      name: 'koffi-win32-x64', family: 'koffi', os: 'win32', arch: 'x64',
    })
  })

  it('returns undefined for a name matching no known family', () => {
    expect(parseNativeModuleEntry('colour')).toBeUndefined()
  })

  it('returns undefined for a family prefix without a valid os-arch remainder', () => {
    expect(parseNativeModuleEntry('sharp-wasm32')).toBeUndefined()
  })
})

describe('selectNativeModuleTargets', () => {
  it('keeps only the darwin-arm64 sharp/koffi variants and the non-platform entry', () => {
    expect(selectNativeModuleTargets({ os: 'darwin', arch: 'arm64' }, SHARP_ENTRIES)).toEqual({
      keep: ['colour', 'sharp-darwin-arm64', 'sharp-libvips-darwin-arm64'],
      remove: ['sharp-darwin-x64', 'sharp-win32-x64', 'sharp-libvips-darwin-x64'],
    })
    expect(selectNativeModuleTargets({ os: 'darwin', arch: 'arm64' }, KOFFI_ENTRIES)).toEqual({
      keep: ['koffi-darwin-arm64'],
      remove: ['koffi-darwin-x64', 'koffi-win32-x64'],
    })
  })

  it('keeps only the darwin-x64 sharp/koffi variants and the non-platform entry', () => {
    expect(selectNativeModuleTargets({ os: 'darwin', arch: 'x64' }, SHARP_ENTRIES)).toEqual({
      keep: ['colour', 'sharp-darwin-x64', 'sharp-libvips-darwin-x64'],
      remove: ['sharp-darwin-arm64', 'sharp-win32-x64', 'sharp-libvips-darwin-arm64'],
    })
    expect(selectNativeModuleTargets({ os: 'darwin', arch: 'x64' }, KOFFI_ENTRIES)).toEqual({
      keep: ['koffi-darwin-x64'],
      remove: ['koffi-darwin-arm64', 'koffi-win32-x64'],
    })
  })

  it('keeps only the win32-x64 sharp variant (no separate sharp-libvips package exists there) and koffi variant', () => {
    expect(selectNativeModuleTargets({ os: 'win32', arch: 'x64' }, SHARP_ENTRIES)).toEqual({
      keep: ['colour', 'sharp-win32-x64'],
      remove: ['sharp-darwin-arm64', 'sharp-darwin-x64', 'sharp-libvips-darwin-arm64', 'sharp-libvips-darwin-x64'],
    })
    expect(selectNativeModuleTargets({ os: 'win32', arch: 'x64' }, KOFFI_ENTRIES)).toEqual({
      keep: ['koffi-win32-x64'],
      remove: ['koffi-darwin-arm64', 'koffi-darwin-x64'],
    })
  })

  it('leaves an unknown directory name untouched regardless of target', () => {
    const entries = ['colour', 'sharp-darwin-arm64', 'some-future-package']
    const { keep, remove } = selectNativeModuleTargets({ os: 'darwin', arch: 'arm64' }, entries)
    expect(keep).toContain('some-future-package')
    expect(remove).not.toContain('some-future-package')
  })

  it('throws when a family ships for the target os but not the target arch', () => {
    expect(() => selectNativeModuleTargets({ os: 'win32', arch: 'x64' }, ['sharp-win32-arm64', 'sharp-darwin-arm64']))
      .toThrow(/no sharp-win32-x64 entry for the win32-x64 packaging target \(present for win32: sharp-win32-arm64\)/)
  })

  it('does not require a family that never ships for the target os at all (win32 never installs sharp-libvips)', () => {
    expect(() => selectNativeModuleTargets({ os: 'win32', arch: 'x64' }, ['sharp-win32-x64'])).not.toThrow()
  })

  it('does not require sharp-libvips for a win32 target even when darwin entries of that family are present', () => {
    expect(() => selectNativeModuleTargets({ os: 'win32', arch: 'x64' }, SHARP_ENTRIES)).not.toThrow()
  })
})
