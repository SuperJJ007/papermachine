import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ProjectArtifactStoreEngine } from '../src/store.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/concurrent-append-worker.ts', import.meta.url))

interface WorkerResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

function runWorker(args: readonly string[]): Promise<WorkerResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', FIXTURE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', (code) => { resolvePromise({ code, stdout, stderr }) })
  })
}

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('concurrent append across separate processes', () => {
  it('serializes two concurrent appends into one linear chain with no fork', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-concurrent-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-concurrent-ws-'))
    dirs.push(home, workspace)

    const engine = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 5000, dshHome: home })
    const { projectId } = await engine.openProject(workspace)
    const { artifact, version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'shared.txt',
      originSessionId: 'session-origin' as SessionId,
      data: new TextEncoder().encode('v1'),
      mediaType: 'text/plain',
      origin: 'auto',
    })
    await engine.close()

    // Two real OS processes, launched without awaiting one before the other,
    // both append onto the SAME artifact through the SAME on-disk store.
    const [resultA, resultB] = await Promise.all([
      runWorker([home, workspace, artifact.artifactId, 'session-a', 'from-a']),
      runWorker([home, workspace, artifact.artifactId, 'session-b', 'from-b']),
    ])

    expect(resultA.code, resultA.stderr).toBe(0)
    expect(resultB.code, resultB.stderr).toBe(0)
    const a = JSON.parse(resultA.stdout) as { versionId: string; ordinal: number; parentVersionId: string | null }
    const b = JSON.parse(resultB.stdout) as { versionId: string; ordinal: number; parentVersionId: string | null }

    // Both committed distinct ordinals contiguous with v1 — no two writers
    // observed the same "latest" and no ordinal was skipped or reused.
    const ordinals = [a.ordinal, b.ordinal].sort((x, y) => x - y)
    expect(ordinals).toEqual([2, 3])

    const second = a.ordinal === 2 ? a : b
    const third = a.ordinal === 3 ? a : b
    // The earlier committer's parent is the artifact's original version...
    expect(second.parentVersionId).toBe(v1.versionId)
    // ...and the LATER committer's parent is the EARLIER committer's version:
    // a real linear chain, not two versions independently forking off v1.
    expect(third.parentVersionId).toBe(second.versionId)

    const readEngine = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 5000, dshHome: home })
    try {
      const versions = await readEngine.listVersions(projectId, artifact.artifactId)
      expect(versions).toHaveLength(3)
      expect(versions.map(v => v.ordinal)).toEqual([1, 2, 3])
      const latest = await readEngine.getLatestVersion(projectId, artifact.artifactId)
      expect(latest?.versionId).toBe(third.versionId)
    } finally {
      await readEngine.close()
    }
  }, 30_000)
})
