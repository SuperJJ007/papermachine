import { describe, expect, it } from 'vitest'
import {
  desktopBuildRecordFilename,
  desktopUpdateMetadataFilename,
  resolveDesktopAutoUpdateConfig,
  resolveDesktopAutoUpdateEnvironment,
  resolveDesktopAutoUpdateTarget,
  resolveDesktopUploadConfig,
} from '../scripts/desktop-auto-update-environment.mjs'

describe('desktop auto-update environment', () => {
  it('defaults packages and uploads to the test deployment', () => {
    expect(resolveDesktopAutoUpdateEnvironment({})).toBe('test')
    expect(resolveDesktopAutoUpdateConfig({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com/',
    }, 'darwin', 'arm64')).toEqual({
      environment: 'test',
      target: 'mac-arm64',
      origin: 'https://desktop-updates.example.com',
      publicUrl: 'https://desktop-updates.example.com/_/papermachine/desktop/stable/mac-arm64/',
      keyPrefix: '_/papermachine/desktop/stable/mac-arm64',
    })
    expect(resolveDesktopUploadConfig({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com/',
      DOWNLOAD_TEST_COS_BUCKET: 'test-download-bucket',
    }, 'darwin', 'arm64')).toMatchObject({
      bucket: 'test-download-bucket',
      secretIdEnvName: 'DOWNLOAD_TEST_COS_SECRET_ID',
      secretKeyEnvName: 'DOWNLOAD_TEST_COS_SECRET_KEY',
    })
  })

  it('selects the production URL for packages and bucket for uploads', () => {
    expect(resolveDesktopAutoUpdateConfig({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      PAPERMACHINE_DOWNLOAD_ORIGIN: 'https://papermachine-updates.example.com',
    }, 'win32', 'x64')).toMatchObject({
      environment: 'production',
      target: 'win-x64',
      publicUrl: 'https://papermachine-updates.example.com/_/papermachine/desktop/stable/win-x64/',
    })
    expect(resolveDesktopUploadConfig({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      PAPERMACHINE_DOWNLOAD_ORIGIN: 'https://papermachine-updates.example.com',
      DOWNLOAD_PROD_COS_BUCKET: 'production-download-bucket',
    }, 'win32', 'x64')).toMatchObject({
      bucket: 'production-download-bucket',
      secretIdEnvName: 'DOWNLOAD_PROD_COS_SECRET_ID',
      secretKeyEnvName: 'DOWNLOAD_PROD_COS_SECRET_KEY',
    })
  })

  it('requires the selected deployment origin for packages and bucket only for uploads', () => {
    expect(() => resolveDesktopAutoUpdateConfig({}, 'darwin', 'arm64'))
      .toThrow(/DOWNLOAD_TEST_ORIGIN/u)
    expect(resolveDesktopAutoUpdateConfig({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
    }, 'darwin', 'arm64').publicUrl).toContain('/mac-arm64/')
    expect(() => resolveDesktopUploadConfig({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
    }, 'darwin', 'arm64')).toThrow(/DOWNLOAD_TEST_COS_BUCKET/u)
    expect(() => resolveDesktopUploadConfig({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      PAPERMACHINE_DOWNLOAD_ORIGIN: 'https://papermachine-updates.example.com',
    }, 'win32', 'x64')).toThrow(/DOWNLOAD_PROD_COS_BUCKET/u)
  })

  it('requires an explicit production origin', () => {
    expect(() => resolveDesktopAutoUpdateConfig({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    }, 'win32', 'x64')).toThrow(/PAPERMACHINE_DOWNLOAD_ORIGIN/u)
  })

  it.each([
    'https://download.deepseek.com',
    'https://DOWNLOAD.DEEPSEEK.COM',
    'https://download.deepseek.com.',
    'https://DOWNLOAD.DEEPSEEK.COM./',
  ])('rejects the official update origin %s in either deployment', (origin) => {
    expect(() => resolveDesktopAutoUpdateConfig({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      PAPERMACHINE_DOWNLOAD_ORIGIN: origin,
    }, 'darwin', 'arm64')).toThrow(/PaperMachine update origin/u)
    expect(() => resolveDesktopAutoUpdateConfig({
      DOWNLOAD_TEST_ORIGIN: origin,
    }, 'darwin', 'arm64')).toThrow(/PaperMachine update origin/u)
  })

  it('rejects a production feed without HTTPS or with a path', () => {
    for (const origin of ['http://updates.example.com', 'https://updates.example.com/releases']) {
      expect(() => resolveDesktopAutoUpdateConfig({
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
        PAPERMACHINE_DOWNLOAD_ORIGIN: origin,
      }, 'darwin', 'arm64')).toThrow(/HTTPS origin/u)
    }
  })

  it('rejects a test download URL that is not an HTTPS origin', () => {
    expect(() => resolveDesktopAutoUpdateConfig({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com/releases',
    }, 'darwin', 'arm64')).toThrow(/HTTPS origin without a path/u)
    expect(() => resolveDesktopAutoUpdateConfig({
      DOWNLOAD_TEST_ORIGIN: 'http://desktop-updates.example.com',
    }, 'darwin', 'arm64')).toThrow(/HTTPS origin/u)
  })

  it('rejects unknown deployments and targets', () => {
    expect(() => resolveDesktopAutoUpdateEnvironment({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'staging',
    })).toThrow(/test.*production/u)
    expect(() => resolveDesktopAutoUpdateTarget('linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => desktopBuildRecordFilename('linux-x64' as 'mac-arm64')).toThrow(/unsupported target/u)
  })

  it('matches electron-builder channel metadata names to the Desktop version', () => {
    expect(desktopUpdateMetadataFilename('1.2.3', 'darwin')).toBe('latest-mac.yml')
    expect(desktopUpdateMetadataFilename('1.2.3-alpha.4', 'darwin')).toBe('alpha-mac.yml')
    expect(desktopUpdateMetadataFilename('1.2.3-beta.2', 'win32')).toBe('beta.yml')
    expect(() => desktopUpdateMetadataFilename('not-semver', 'darwin')).toThrow(/invalid Desktop version/u)
    expect(() => desktopUpdateMetadataFilename('1.2.3', 'linux')).toThrow(/unsupported metadata platform/u)
  })
})
