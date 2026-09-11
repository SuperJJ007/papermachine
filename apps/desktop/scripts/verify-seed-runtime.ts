/** Qualify an offline seed by booting its installed Host and client plugins. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopHostProcess } from '../src/host-process.ts'

/**
 * Boot the installed composition before accepting its offline dependency store.
 * @param node - Bundled Node executable for this seed.
 * @param projectDir - Seed project with its offline-installed node_modules.
 * @param expectedVersion - Harness release bound to the seed.
 * @returns After Host startup and shutdown, or rejects on a load/version failure.
 */
export async function verifyDesktopSeedRuntime(node: string, projectDir: string, expectedVersion: string): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-seed-health-'))
  const host = new DesktopHostProcess(node, projectDir, home)
  try {
    const ready = await host.start()
    if (ready.dshVersion !== expectedVersion) {
      throw new Error(`desktop seed: Host reports ${ready.dshVersion}; expected ${expectedVersion}`)
    }
  } finally {
    try {
      await host.stop()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }
}
