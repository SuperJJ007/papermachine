/** Pack PaperMachine's local seed inputs without creating an npm release publish order. */
import { mkdirSync, rmSync } from 'node:fs'
import { releaseFamily } from '../../../scripts/release/families.ts'
import { packReleaseMember } from '../../../scripts/release/pack.ts'
import { verifyDesktopClientBuild } from './client-build.ts'

/**
 * Validate the product build and package the dsh family for private desktop seed preparation.
 * @param root - Repository supplying workspace members and the verified product build.
 * @param destination - Owned absolute tarball output directory, replaced after validation.
 * @param environment - Packaging environment with upload and signing credentials removed.
 */
export async function prepareDesktopPackageTarballs(
  root: string,
  destination: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  verifyDesktopClientBuild(root)
  const family = releaseFamily('dsh')
  const members = family.publishOrder(family.members(root)).order
  family.verifyVersions(members)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const member of members) await packReleaseMember(family, member, destination, { cwd: root, env: environment })
}
