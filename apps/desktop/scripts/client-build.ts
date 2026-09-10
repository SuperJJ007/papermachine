/** Require the complete PaperMachine browser artifact set before Desktop consumes it. */
import { paperMachineClientBuildEnvironment, readClientBuildRecord } from '../../../scripts/client-build-environment.ts'

/**
 * Reject another product's build, stale source identity, or modified client artifacts.
 * @param root - Repository containing the complete client build record and artifacts.
 */
export function verifyDesktopClientBuild(root: string): void {
  readClientBuildRecord(root, paperMachineClientBuildEnvironment(root))
}

/**
 * Build when requested, then validate artifacts before any development launch work.
 * @param root - Repository supplying the complete build record.
 * @param skipBuild - Whether to require an already matching product build.
 * @param build - Complete PaperMachine build action, invoked only when not skipped.
 */
export async function prepareDesktopClientBuild(root: string, skipBuild: boolean, build: () => Promise<void>): Promise<void> {
  if (!skipBuild) await build()
  verifyDesktopClientBuild(root)
}
