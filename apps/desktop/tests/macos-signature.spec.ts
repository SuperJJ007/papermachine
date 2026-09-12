import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PAPER_MACHINE_VERSION } from '../src/product.ts'
import type { NotarizeOptions } from '@electron/notarize'
import {
  resolveDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from '../scripts/desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from '../scripts/notarize-macos-disk-images.mjs'
import {
  assertMacOSSeedSignatureDetails,
  assertMacOSSignatureDetails,
} from '../scripts/verify-macos-signature.mjs'
import { isLocalAcceptance } from '../scripts/local-acceptance.mjs'
import { desktopTargetBuildPaths } from '../scripts/desktop-build-paths.mjs'
import { createDesktopUploadPlan } from '../scripts/desktop-upload-plan.ts'

const RELEASE_ENVIRONMENT = {
  PAPERMACHINE_DESKTOP_APP_ID: 'com.example.desktop',
  DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
  DSH_DESKTOP_TARGET_ARCH: 'arm64',
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
  APPLE_API_KEY: '/private/credentials/AuthKey_TEST123456.p8',
  APPLE_API_KEY_ID: 'TEST123456',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
  DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
}

function portablePath(value: string): string {
  return value.replaceAll('\\', '/')
}

describe('desktop macOS release signature', () => {
  it('builds isolated local installers without release credentials or an update publisher', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const environment = { DSH_DESKTOP_LOCAL_ACCEPTANCE: '1' }
    const config = createElectronBuilderConfig(environment, 'darwin', 'arm64')
    expect(config.mac).toMatchObject({ identity: '-', notarize: false })
    expect(config.dmg.sign).toBe(false)
    expect(config.publish).toBeNull()
    expect(config.artifactName).toContain('-local-')
    expect(config.directories.output).toContain('local-acceptance')
    expect(config.directories.output).not.toBe(desktopTargetBuildPaths('mac-arm64', {}).artifacts)
    expect(config.artifactBuildCompleted({ file: '/tmp/local.dmg' })).toBeUndefined()
    await expect(createDesktopUploadPlan('mac-arm64', { environment })).rejects.toThrow(/cannot be uploaded/u)
  })

  it('rejects ambiguous local modes, production updates, and unsupported local targets', () => {
    expect(isLocalAcceptance({}, 'darwin')).toBe(false)
    expect(isLocalAcceptance({ DSH_DESKTOP_LOCAL_ACCEPTANCE: '0' }, 'darwin')).toBe(false)
    expect(() => isLocalAcceptance({ DSH_DESKTOP_LOCAL_ACCEPTANCE: 'yes' }, 'darwin')).toThrow(/0 or 1/u)
    expect(isLocalAcceptance({ DSH_DESKTOP_LOCAL_ACCEPTANCE: '1' }, 'win32')).toBe(true)
    expect(() => isLocalAcceptance({ DSH_DESKTOP_LOCAL_ACCEPTANCE: '1' }, 'linux')).toThrow(/only macOS and Windows/u)
    expect(() => isLocalAcceptance({
      DSH_DESKTOP_LOCAL_ACCEPTANCE: '1', DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    }, 'darwin')).toThrow(/production updates/u)
  })

  it('isolates Windows test-signed installers and refuses their upload', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const environment = {
      DSH_DESKTOP_LOCAL_ACCEPTANCE: '1',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT: 'A'.repeat(40),
    }
    const config = createElectronBuilderConfig(environment, 'win32', 'x64')
    expect(portablePath(config.directories.output)).toContain('/local-acceptance/win-x64/artifacts')
    expect(config.artifactName).toContain('-local-')
    expect(config.publish).toBeNull()
    await expect(createDesktopUploadPlan('win-x64', { environment })).rejects.toThrow(/cannot be uploaded/u)
  })

  beforeAll(() => {
    for (const [name, value] of Object.entries(RELEASE_ENVIRONMENT)) vi.stubEnv(name, value)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('loads release identifiers from the environment and requires code signing', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig(RELEASE_ENVIRONMENT, 'darwin', 'arm64')
    expect(portablePath(config.directories.output)).toContain('/.desktop-build/targets/mac-arm64/artifacts')
    expect(PAPER_MACHINE_VERSION).toBe('0.1.2')
    expect(config.extraResources.map(resource => resource.to)).toEqual(['runtime', 'seed', 'product'])
    expect(config.extraResources[2]).toEqual({ from: 'resources', to: 'product' })
    expect(portablePath(config.extraResources[0]?.from ?? '')).toContain('/.desktop-build/targets/mac-arm64/runtime')
    expect(portablePath(config.extraResources[1]?.from ?? '')).toContain('/.desktop-build/targets/mac-arm64/seed')
    expect(config).toMatchObject({
      appId: RELEASE_ENVIRONMENT.PAPERMACHINE_DESKTOP_APP_ID,
      productName: 'PaperMachine',
      artifactName: `papermachine-${PAPER_MACHINE_VERSION}-\${os}-\${arch}.\${ext}`,
      mac: {
        identity: RELEASE_ENVIRONMENT.DSH_DESKTOP_MACOS_SIGNING_IDENTITY,
        forceCodeSigning: true,
        notarize: true,
      },
      dmg: {
        sign: true,
        writeUpdateInfo: false,
      },
      publish: [{
        provider: 'generic',
        url: 'https://desktop-updates.example.com/_/papermachine/desktop/stable/mac-arm64/',
      }],
    })
    expect(typeof config.artifactBuildCompleted).toBe('function')
  })

  it('validates Windows signing without requiring macOS identifiers for a Windows target', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    expect(() => createElectronBuilderConfig({
      PAPERMACHINE_DESKTOP_APP_ID: RELEASE_ENVIRONMENT.PAPERMACHINE_DESKTOP_APP_ID,
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
    }, 'win32')).toThrow(/DSH_DESKTOP_WINDOWS_CER_FILE/u)
  })

  it('accepts the configured authority and team', () => {
    const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)
    expect(() => {
      assertMacOSSignatureDetails([
        `Authority=Developer ID Application: ${expected.signingIdentity}`,
        `TeamIdentifier=${expected.teamId}`,
      ].join('\n'), expected)
    }).not.toThrow()
  })

  it('requires a secure timestamp and hardened runtime for seed code', () => {
    const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)
    const details = [
      `Authority=Developer ID Application: ${expected.signingIdentity}`,
      `TeamIdentifier=${expected.teamId}`,
      'Timestamp=31 Aug 2026 at 20:00:00',
      'CodeDirectory v=20500 size=773 flags=0x10000(runtime) hashes=13+7 location=embedded',
    ].join('\n')
    expect(() => { assertMacOSSeedSignatureDetails(details, expected) }).not.toThrow()
    expect(() => {
      assertMacOSSeedSignatureDetails(details.replace(/^Timestamp=.*\n/um, ''), expected)
    }).toThrow(/secure timestamp/u)
    expect(() => {
      assertMacOSSeedSignatureDetails(details.replace('flags=0x10000(runtime)', 'flags=0x0(none)'), expected)
    }).toThrow(/hardened runtime/u)
  })

  it('rejects another developer identity', () => {
    const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)
    expect(() => {
      assertMacOSSignatureDetails([
        'Authority=Developer ID Application: Other Company (OTHERID123)',
        'TeamIdentifier=OTHERID123',
      ].join('\n'), expected)
    }).toThrow(/release identity/u)
  })

  it('rejects an unexpected team even when the authority is present', () => {
    const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)
    expect(() => {
      assertMacOSSignatureDetails([
        `Authority=Developer ID Application: ${expected.signingIdentity}`,
        'TeamIdentifier=OTHERID123',
      ].join('\n'), expected)
    }).toThrow(`TeamIdentifier=${expected.teamId}`)
  })

  it('keeps the installed PaperMachine identity when official CLI release variables are inherited', () => {
    expect(resolveDesktopAppId({})).toBe('com.papermachine.desktop')
    expect(resolveDesktopAppId({ DSH_DESKTOP_APP_ID: 'com.deepseek.harness' }))
      .toBe('com.papermachine.desktop')
    expect(resolveDesktopAppId({
      DSH_DESKTOP_APP_ID: 'com.deepseek.harness',
      PAPERMACHINE_DESKTOP_APP_ID: 'com.example.papermachine',
    })).toBe('com.example.papermachine')
  })

  it('rejects missing and malformed release identifiers', () => {
    expect(() => resolveDesktopAppId({ PAPERMACHINE_DESKTOP_APP_ID: ' ' })).toThrow(/PAPERMACHINE_DESKTOP_APP_ID/u)
    expect(() => resolveDesktopAppId({ PAPERMACHINE_DESKTOP_APP_ID: 'not-a-bundle-id' })).toThrow(/reverse-DNS/u)
    expect(() => resolveMacOSSigningEnvironment({})).toThrow(/DSH_DESKTOP_MACOS_SIGNING_IDENTITY/u)
    expect(() => resolveMacOSSigningEnvironment({
      DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Developer ID Application: Example Company (TEAMID1234)',
      DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
    })).toThrow(/must omit/u)
    expect(() => resolveMacOSSigningEnvironment({
      DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
      DSH_DESKTOP_MACOS_TEAM_ID: 'short',
    })).toThrow(/10 uppercase/u)
  })

  it('requires one complete notarization credential strategy', () => {
    expect(resolveMacOSNotarizationEnvironment(RELEASE_ENVIRONMENT)).toEqual({
      appleApiKey: RELEASE_ENVIRONMENT.APPLE_API_KEY,
      appleApiKeyId: RELEASE_ENVIRONMENT.APPLE_API_KEY_ID,
      appleApiIssuer: RELEASE_ENVIRONMENT.APPLE_API_ISSUER,
    })
    expect(resolveMacOSNotarizationEnvironment({
      APPLE_KEYCHAIN_PROFILE: 'dsh-notary',
    })).toEqual({ keychainProfile: 'dsh-notary' })
    expect(() => resolveMacOSNotarizationEnvironment({})).toThrow(/macOS packaging requires/u)
    expect(() => resolveMacOSNotarizationEnvironment({ APPLE_API_KEY: '/tmp/key.p8' })).toThrow(/APPLE_API_KEY_ID/u)
  })

  it('notarizes and qualifies a DMG before electron-builder publishes it', async () => {
    const submitted: string[] = []
    const submit = vi.fn(async (options: NotarizeOptions) => { submitted.push(options.appPath) })
    const verified: string[] = []
    const verify = vi.fn((path: string) => { verified.push(path) })
    await notarizeMacOSDiskImageArtifact(
      { file: '/tmp/release.dmg' },
      RELEASE_ENVIRONMENT,
      resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT),
      submit,
      verify,
    )
    await notarizeMacOSDiskImageArtifact(
      { file: '/tmp/release.zip' },
      RELEASE_ENVIRONMENT,
      resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT),
      submit,
      verify,
    )
    expect(submitted).toEqual(['/tmp/release.dmg'])
    expect(verified).toEqual(['/tmp/release.dmg'])
  })
})
