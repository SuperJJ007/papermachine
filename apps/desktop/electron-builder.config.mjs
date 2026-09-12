import product from './src/product-version.json' with { type: 'json' }
import {
  resolveDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from './scripts/desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './scripts/notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './scripts/verify-macos-signature.mjs'
import {
  createWindowsTokenSigner,
  installWindowsNsisBootstrapSigner,
} from './scripts/windows-sign.mjs'
import { resolveDesktopAutoUpdateConfig } from './scripts/desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './scripts/desktop-build-paths.mjs'
import { resolve } from 'node:path'
import { isLocalAcceptance, verifyLocalCode } from './scripts/local-acceptance.mjs'
import { createLocalWindowsSigner } from './scripts/local-windows-sign.mjs'

/**
 * Create electron-builder configuration from one release environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const appId = resolveDesktopAppId(env)
  const targetPlatform = env.DSH_DESKTOP_TARGET_PLATFORM
  const resolvedPlatform = targetPlatform ?? hostPlatform
  const resolvedArch = env.DSH_DESKTOP_TARGET_ARCH ?? hostArch
  const localAcceptance = isLocalAcceptance(env, resolvedPlatform)
  const packagesMacOS = targetPlatform === 'darwin' || (targetPlatform === undefined && hostPlatform === 'darwin')
  const packagesWindows = targetPlatform === 'win32'
  const macOSSigning = packagesMacOS && !localAcceptance ? resolveMacOSSigningEnvironment(env) : undefined
  if (packagesMacOS && !localAcceptance) resolveMacOSNotarizationEnvironment(env)
  const windowsSigner = packagesWindows
    ? localAcceptance ? createLocalWindowsSigner(env) : createWindowsTokenSigner({
        certificateFile: env.DSH_DESKTOP_WINDOWS_CER_FILE,
        signTool: env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
        tokenPin: env.DSH_DESKTOP_WINDOWS_TOKEN_PIN,
        keyContainer: env.DSH_DESKTOP_WINDOWS_KEY_CONTAINER,
      })
    : undefined
  if (windowsSigner !== undefined) {
    installWindowsNsisBootstrapSigner({ sign: windowsSigner })
  }
  const update = localAcceptance ? undefined : resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)
  const target = update?.target ?? resolveDesktopBuildTarget(env, hostPlatform, hostArch)
  const buildPaths = desktopTargetBuildPaths(target, env)
  return {
    appId,
    productName: 'PaperMachine',
    artifactName: `papermachine-${product.version}${localAcceptance ? '-local' : ''}-\${os}-\${arch}.\${ext}`,
    directories: { output: buildPaths.artifacts },
    asar: true,
    files: [
      'lib/*.js',
      'lib/*.cjs',
      'renderer/**/*',
      'package.json',
    ],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: buildPaths.seed, to: 'seed' },
      { from: 'resources', to: 'product' },
    ],
    mac: {
      category: 'public.app-category.developer-tools',
      identity: localAcceptance ? '-' : macOSSigning?.signingIdentity,
      forceCodeSigning: !localAcceptance,
      hardenedRuntime: true,
      notarize: !localAcceptance,
      target: ['dmg', 'zip'],
    },
    dmg: {
      sign: !localAcceptance,
      writeUpdateInfo: false,
    },
    afterSign: context => {
      if (context.electronPlatformName !== 'darwin') return
      if (localAcceptance) {
        verifyLocalCode(resolve(context.appOutDir, `${context.packager.appInfo.productFilename}.app`))
        return
      }
      verifyMacOSSignatureAfterSign(context, macOSSigning ?? resolveMacOSSigningEnvironment(env))
    },
    artifactBuildCompleted: artifact => {
      if (localAcceptance || !artifact.file.endsWith('.dmg')) return
      return notarizeMacOSDiskImageArtifact(
        artifact,
        env,
        macOSSigning ?? resolveMacOSSigningEnvironment(env),
      )
    },
    win: {
      forceCodeSigning: true,
      signtoolOptions: {
        sign: windowsSigner,
        signingHashAlgorithms: ['sha256'],
      },
      target: ['nsis'],
    },
    linux: {
      category: 'Development',
      target: ['AppImage'],
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      differentialPackage: true,
    },
    publish: update === undefined ? null : [{ provider: 'generic', url: update.publicUrl }],
  }
}

export default createElectronBuilderConfig()
