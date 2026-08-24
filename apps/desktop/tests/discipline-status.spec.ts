import { describe, expect, it } from 'vitest'
import { resolveDisciplineStatus } from '../src/discipline-status.ts'
import { parseEnvironmentDeclaration } from '../src/environment-declaration.ts'
import type { AppliedEnvironment } from '../src/provisioning.ts'

function declaration(id: string, revision: string): ReturnType<typeof parseEnvironmentDeclaration> {
  return parseEnvironmentDeclaration({
    schemaVersion: 1,
    id,
    revision,
    name: id,
    supportedPlatforms: ['darwin-arm64'],
    channels: ['conda-forge'],
    packages: ['python=3.13'],
    estimatedDownloadBytes: 100,
    requiredFreeBytes: 200,
    timeoutMs: 1_000,
    healthChecks: [
      { language: 'python', executable: 'python', args: ['-c', 'pass'] },
      { language: 'r', executable: 'Rscript', args: ['-e', 'TRUE'] },
    ],
  })
}

function applied(id: string, revision: string): AppliedEnvironment {
  return { id, revision, prefix: `/prefix/${id}/${revision}`, appliedAt: 1 }
}

describe('resolveDisciplineStatus', () => {
  it('reports unselected when nothing has ever been applied', () => {
    expect(resolveDisciplineStatus(undefined, [declaration('social-science', '2026.08.1')]))
      .toEqual({ kind: 'unselected' })
  })

  it('reports current when the applied revision matches the shipped declaration', () => {
    expect(resolveDisciplineStatus(applied('social-science', '2026.08.1'), [declaration('social-science', '2026.08.1')]))
      .toEqual({ kind: 'current' })
  })

  it('reports stale when the shipped declaration for the same discipline advanced', () => {
    const newer = declaration('social-science', '2026.08.2')
    expect(resolveDisciplineStatus(applied('social-science', '2026.08.1'), [newer]))
      .toEqual({ kind: 'stale', declaration: newer })
  })

  it('reports unknown-discipline when the applied id is no longer shipped', () => {
    expect(resolveDisciplineStatus(applied('retired-discipline', '2026.08.1'), [declaration('biology', '2026.08.1')]))
      .toEqual({ kind: 'unknown-discipline' })
  })
})
