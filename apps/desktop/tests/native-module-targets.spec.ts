import { describe, expect, it } from 'vitest'
import {
  parseNativeModuleEntry,
  parsePlatformVariantEntry,
  selectForeignPlatformEntries,
  selectNativeModuleTargets,
} from '../scripts/native-module-targets.mjs'

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
    expect(selectNativeModuleTargets('@img', { os: 'darwin', arch: 'arm64' }, SHARP_ENTRIES)).toEqual({
      keep: ['colour', 'sharp-darwin-arm64', 'sharp-libvips-darwin-arm64'],
      remove: ['sharp-darwin-x64', 'sharp-win32-x64', 'sharp-libvips-darwin-x64'],
    })
    expect(selectNativeModuleTargets('@koromix', { os: 'darwin', arch: 'arm64' }, KOFFI_ENTRIES)).toEqual({
      keep: ['koffi-darwin-arm64'],
      remove: ['koffi-darwin-x64', 'koffi-win32-x64'],
    })
  })

  it('keeps only the darwin-x64 sharp/koffi variants and the non-platform entry', () => {
    expect(selectNativeModuleTargets('@img', { os: 'darwin', arch: 'x64' }, SHARP_ENTRIES)).toEqual({
      keep: ['colour', 'sharp-darwin-x64', 'sharp-libvips-darwin-x64'],
      remove: ['sharp-darwin-arm64', 'sharp-win32-x64', 'sharp-libvips-darwin-arm64'],
    })
    expect(selectNativeModuleTargets('@koromix', { os: 'darwin', arch: 'x64' }, KOFFI_ENTRIES)).toEqual({
      keep: ['koffi-darwin-x64'],
      remove: ['koffi-darwin-arm64', 'koffi-win32-x64'],
    })
  })

  it('keeps only the win32-x64 sharp variant (no separate sharp-libvips package exists there) and koffi variant', () => {
    expect(selectNativeModuleTargets('@img', { os: 'win32', arch: 'x64' }, SHARP_ENTRIES)).toEqual({
      keep: ['colour', 'sharp-win32-x64'],
      remove: ['sharp-darwin-arm64', 'sharp-darwin-x64', 'sharp-libvips-darwin-arm64', 'sharp-libvips-darwin-x64'],
    })
    expect(selectNativeModuleTargets('@koromix', { os: 'win32', arch: 'x64' }, KOFFI_ENTRIES)).toEqual({
      keep: ['koffi-win32-x64'],
      remove: ['koffi-darwin-arm64', 'koffi-darwin-x64'],
    })
  })

  it('leaves an unknown directory name untouched regardless of target', () => {
    const entries = ['colour', 'sharp-darwin-arm64', 'sharp-libvips-darwin-arm64', 'some-future-package']
    const { keep, remove } = selectNativeModuleTargets('@img', { os: 'darwin', arch: 'arm64' }, entries)
    expect(keep).toContain('some-future-package')
    expect(remove).not.toContain('some-future-package')
  })

  it('throws when a family ships for the target os but not the target arch', () => {
    expect(() => selectNativeModuleTargets('@img', { os: 'win32', arch: 'x64' }, ['sharp-win32-arm64', 'sharp-darwin-arm64']))
      .toThrow(/no sharp-win32-x64 entry for the win32-x64 packaging target \(present for win32: sharp-win32-arm64\)/)
  })

  it('throws when EVERY entry of a required family for the target os is missing, not only some (a totally failed target install must still fail loud, the same as a partially failed one)', () => {
    expect(() => selectNativeModuleTargets(
      '@img',
      { os: 'win32', arch: 'x64' },
      ['sharp-darwin-arm64', 'sharp-darwin-x64', 'sharp-libvips-darwin-arm64', 'sharp-libvips-darwin-x64'],
    )).toThrow(/no sharp-win32-x64 entry for the win32-x64 packaging target \(no sharp entry for win32 at all\)/)
  })

  it('does not require a family that never ships for the target os at all (win32 never installs sharp-libvips)', () => {
    expect(() => selectNativeModuleTargets('@img', { os: 'win32', arch: 'x64' }, ['sharp-win32-x64'])).not.toThrow()
  })

  it('does not require sharp-libvips for a win32 target even when darwin entries of that family are present', () => {
    expect(() => selectNativeModuleTargets('@img', { os: 'win32', arch: 'x64' }, SHARP_ENTRIES)).not.toThrow()
  })

  it('throws when @img has no sharp entry at all (an empty scope directory), not only when some entries are missing', () => {
    expect(() => selectNativeModuleTargets('@img', { os: 'darwin', arch: 'arm64' }, []))
      .toThrow(/no sharp-darwin-arm64 entry for the darwin-arm64 packaging target \(no sharp entry for darwin at all\)/)
  })

  it('throws when @img carries only a non-platform entry (colour) and no sharp/sharp-libvips entry at all', () => {
    expect(() => selectNativeModuleTargets('@img', { os: 'darwin', arch: 'arm64' }, ['colour']))
      .toThrow(/no sharp-darwin-arm64 entry for the darwin-arm64 packaging target \(no sharp entry for darwin at all\)/)
  })

  it('throws when @koromix has no koffi entry at all (an empty scope directory)', () => {
    expect(() => selectNativeModuleTargets('@koromix', { os: 'win32', arch: 'x64' }, []))
      .toThrow(/no koffi-win32-x64 entry for the win32-x64 packaging target \(no koffi entry for win32 at all\)/)
  })

  it('throws for an unrecognized scope', () => {
    expect(() => selectNativeModuleTargets('@unknown', { os: 'darwin', arch: 'arm64' }, []))
      .toThrow(/unknown native module scope @unknown/)
  })
})

describe('parsePlatformVariantEntry', () => {
  it('parses a scoped package variant', () => {
    expect(parsePlatformVariantEntry('@anthropic-ai/claude-agent-sdk-darwin-arm64')).toEqual({
      name: '@anthropic-ai/claude-agent-sdk-darwin-arm64', family: '@anthropic-ai/claude-agent-sdk', os: 'darwin', arch: 'arm64',
    })
  })

  it('parses an unscoped package variant', () => {
    expect(parsePlatformVariantEntry('ripgrep-win32-x64')).toEqual({
      name: 'ripgrep-win32-x64', family: 'ripgrep', os: 'win32', arch: 'x64',
    })
  })

  it('parses a variant with a toolchain qualifier', () => {
    expect(parsePlatformVariantEntry('node-addon-require-builtin-linux-arm64-gnu')).toEqual({
      name: 'node-addon-require-builtin-linux-arm64-gnu', family: 'node-addon-require-builtin', os: 'linux', arch: 'arm64',
    })
    expect(parsePlatformVariantEntry('node-addon-require-builtin-win32-arm64-msvc')).toEqual({
      name: 'node-addon-require-builtin-win32-arm64-msvc', family: 'node-addon-require-builtin', os: 'win32', arch: 'arm64',
    })
  })

  it('returns undefined for a name with no platform-variant suffix', () => {
    expect(parsePlatformVariantEntry('claude-agent-sdk')).toBeUndefined()
    expect(parsePlatformVariantEntry('colour')).toBeUndefined()
  })
})

describe('selectForeignPlatformEntries', () => {
  it('removes every other-platform variant of a family that has a matching target entry', () => {
    const entries = ['ripgrep-darwin-arm64', 'ripgrep-darwin-x64', 'ripgrep-win32-x64', 'ripgrep-linux-x64']
    expect(selectForeignPlatformEntries({ os: 'darwin', arch: 'arm64' }, entries)).toEqual([
      'ripgrep-darwin-x64', 'ripgrep-win32-x64', 'ripgrep-linux-x64',
    ])
  })

  it('leaves a family with no entry matching the target untouched entirely', () => {
    const entries = ['ripgrep-win32-x64', 'ripgrep-linux-x64']
    expect(selectForeignPlatformEntries({ os: 'darwin', arch: 'arm64' }, entries)).toEqual([])
  })

  it('leaves a non-platform-variant name untouched', () => {
    expect(selectForeignPlatformEntries({ os: 'darwin', arch: 'arm64' }, ['claude-agent-sdk', 'ripgrep-darwin-arm64'])).toEqual([])
  })

  it('scopes families by their full alias, not just the trailing package name, so same-named families in different scopes do not merge', () => {
    const entries = ['@scope-a/tool-darwin-arm64', '@scope-a/tool-win32-x64', '@scope-b/tool-win32-x64']
    // @scope-b/tool has no darwin-arm64 entry, so it is left alone even though @scope-a/tool (a different family) does.
    expect(selectForeignPlatformEntries({ os: 'darwin', arch: 'arm64' }, entries)).toEqual(['@scope-a/tool-win32-x64'])
  })
})
