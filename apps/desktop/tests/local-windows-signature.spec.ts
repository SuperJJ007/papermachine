import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { createLocalWindowsSigner } from '../scripts/local-windows-sign.mjs'
import { scrubWindowsSigningEnvironment } from '../scripts/windows-sign.mjs'

const execFileAsync = promisify(execFile)

it.skipIf(process.platform !== 'win32' || process.env.DSH_DESKTOP_LOCAL_WINDOWS_CERT_THUMBPRINT === undefined).each([
  process.execPath,
  join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'),
])(
  'signs %s with the selected local certificate and rejects changed executable contents', async (source) => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-local-signature-'))
    try {
      const executable = join(directory, 'local-test.exe')
      await copyFile(source, executable)
      const sign = createLocalWindowsSigner(process.env)
      await sign({ path: executable, hash: 'sha256', isNest: false })
      const tampered = join(directory, 'tampered.exe')
      const bytes = await readFile(executable)
      bytes[64] = bytes[64]! ^ 1
      await writeFile(tampered, bytes)
      const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
        '$ErrorActionPreference = "Stop"',
        'Add-Type -Path $env:DSH_LOCAL_VERIFY_SOURCE',
        '$good = [DshLocalAuthenticode]::Verify($env:DSH_LOCAL_VERIFY_GOOD)',
        '$bad = [DshLocalAuthenticode]::Verify($env:DSH_LOCAL_VERIFY_BAD)',
        'if ($good -ne 0 -and $good -ne -2146762487) { throw "Signed fixture rejected" }',
        'if ($bad -ne -2146869232) { throw "Changed fixture did not produce TRUST_E_BAD_DIGEST" }',
        'Write-Output "signature and digest checks passed"',
      ].join('; ')], {
        env: {
          ...scrubWindowsSigningEnvironment(process.env),
          DSH_LOCAL_VERIFY_SOURCE: resolve(import.meta.dirname, '../scripts/local-windows-signature.cs'),
          DSH_LOCAL_VERIFY_GOOD: executable,
          DSH_LOCAL_VERIFY_BAD: tampered,
        },
        timeout: 60_000,
      })
      expect(result.stdout).toContain('signature and digest checks passed')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 90_000,
)
