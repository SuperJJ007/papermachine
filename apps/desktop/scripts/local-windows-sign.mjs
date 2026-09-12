/** Sign local Windows installers with an existing machine-store test certificate. */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { repairDanglingAuthenticodeDirectory, scrubWindowsSigningEnvironment } from './windows-sign.mjs'

const execFileAsync = promisify(execFile)
const script = fileURLToPath(new URL('./local-windows-sign.ps1', import.meta.url))

/**
 * Select an existing certificate without exporting its private key or changing trust stores.
 * @param {NodeJS.ProcessEnv} environment - Local packaging environment.
 * @returns {(configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>} SHA-256 signing hook.
 */
export function createLocalWindowsSigner(environment) {
  const thumbprint = environment.DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT?.trim()
  if (thumbprint === undefined || !/^[a-f0-9]{40}$/iu.test(thumbprint)) {
    throw new Error('desktop local acceptance: DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT must select a machine-store test certificate')
  }
  return async configuration => {
    if (configuration.hash !== 'sha256') throw new Error('desktop local acceptance: Windows signing requires SHA-256')
    await repairDanglingAuthenticodeDirectory(configuration.path)
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], {
      env: {
        ...scrubWindowsSigningEnvironment(environment),
        DSH_LOCAL_SIGN_CERT: thumbprint,
        DSH_LOCAL_SIGN_PATH: configuration.path,
      },
      windowsHide: true,
    })
  }
}
