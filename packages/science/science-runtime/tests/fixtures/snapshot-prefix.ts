/** Private interpreter prefix for replaying the recorded Science kernel operation. */
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Create an isolated probe-compatible interpreter that speaks the kernel wire protocol.
 * The caller owns the containing workspace and removes it after the subprocess exits.
 * @param workspace - Unique workspace outside generic sandbox temporary grants.
 * @returns The absolute Conda prefix to pass to the Science runtime configuration.
 */
export async function prepareSciencePrefix(workspace: string): Promise<string> {
  const prefix = join(workspace, '.dsh', 'snapshot-conda')
  await mkdir(join(prefix, 'bin'), { recursive: true })
  await mkdir(join(prefix, 'conda-meta'), { recursive: true })
  await writeFile(join(prefix, 'conda-meta', 'history'), '+python-3.13.15\n')
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`
  const driver = fileURLToPath(new URL('./snapshot-kernel.mjs', import.meta.url))
  const executable = join(prefix, 'bin', 'python')
  await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(driver)} "$@"\n`)
  await chmod(executable, 0o700)
  return prefix
}
