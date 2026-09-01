/**
 * Real OS-process fixture for the concurrent-append test: opens the project
 * at argv[1]/argv[2] (home/workspace, already created by the driving test)
 * and appends one version onto argv[3], printing the resulting version as
 * JSON on stdout. Loads no Cordis context, so it runs directly under the
 * TSX source launcher without the built-lib dual-mode subprocess machinery.
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import { ArtifactId } from '../../src/ids.ts'
import { ProjectArtifactStoreEngine } from '../../src/store.ts'

const [, , home, workspace, artifactIdArg, producerSessionIdArg, payload] = process.argv

async function main(): Promise<void> {
  const missing = home === undefined || workspace === undefined || artifactIdArg === undefined
    || producerSessionIdArg === undefined || payload === undefined
  if (missing) {
    throw new Error('usage: concurrent-append-worker.ts <home> <workspace> <artifactId> <producerSessionId> <payload>')
  }
  const engine = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 10_000, storeBackupRetention: 1, dshHome: home })
  try {
    const { projectId } = await engine.openProject(workspace)
    const version = await engine.appendVersion(projectId, ArtifactId(artifactIdArg), {
      producerSessionId: producerSessionIdArg as SessionId,
      data: new TextEncoder().encode(payload),
      mediaType: 'text/plain',
      contentOrigin: 'run-auto',
    })
    process.stdout.write(JSON.stringify({
      versionId: version.versionId,
      ordinal: version.ordinal,
      baseVersionId: version.baseVersionId ?? null,
    }))
  } finally {
    await engine.close()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exitCode = 1
})
