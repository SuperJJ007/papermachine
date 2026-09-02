/**
 * `collectProjectArtifactEvents` (pure session-log reading) and
 * `ScienceRuntime`'s reconciliation trigger wired through `sessionProject`:
 * fires once per project id per Host lifetime, never blocks or fails the
 * Science operation that triggered it.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { VersionId } from '@deepseek-ai/dsh-science-artifact-store'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import SessionPersistence, {
  SessionPersistenceRevision,
  type SessionInspection,
  type SessionLocation,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import { collectProjectArtifactEvents } from '../src/reconcile-trigger.ts'
import {
  createControlledRuntimeHarness,
  createFakePythonPrefix,
  createScienceSession,
} from './harness.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmp(prefix: string): string {
  const root = mkdtempSync(join(process.cwd(), prefix))
  roots.push(root)
  return root
}

/** Controllable in-memory `SessionPersistence` test double: pre-seeded sessions, per-id read failures, call counters. */
class TestPersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false
  static inject: string[] = []

  readonly durable = new Map<SessionId, SessionInspection>()
  readonly inspectFailureFor = new Set<SessionId>()
  listFailure: Error | undefined
  listCalls = 0
  inspectCalls = 0

  locate(_meta: SessionHeader): SessionLocation | undefined { return undefined }
  create(_meta: SessionHeader): Promise<void> { return Promise.resolve() }
  append(_id: SessionId, _events: readonly SessionEvent[]): Promise<void> { return Promise.resolve() }

  load(id: SessionId): Promise<SessionInspection> {
    return this.readFrom(id, 0)
  }

  inspect(id: SessionId): Promise<SessionInspection> {
    this.inspectCalls += 1
    if (this.inspectFailureFor.has(id)) return Promise.reject(new Error(`test persistence: forced inspect failure for "${id}"`))
    const stored = this.durable.get(id)
    return stored === undefined
      ? Promise.reject(new Error(`test persistence: session '${id}' not found`))
      : Promise.resolve(stored)
  }

  async readFrom(id: SessionId, fromSeq: number): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    const stored = this.durable.get(id)
    return stored === undefined
      ? Promise.reject(new Error(`test persistence: session '${id}' not found`))
      : { meta: stored.meta, events: stored.events.filter(event => event.seq >= fromSeq) }
  }

  list(): Promise<SessionHeader[]> {
    this.listCalls += 1
    if (this.listFailure !== undefined) return Promise.reject(this.listFailure)
    return Promise.resolve([...this.durable.values()].map(value => value.meta))
  }

  async listSnapshots(): Promise<SessionPersistenceSnapshot[]> {
    return [...this.durable.values()].map((value, index) => ({
      header: value.meta,
      revision: SessionPersistenceRevision(`test:${index}:${value.events.length}`),
    }))
  }

  setDurable(inspection: SessionInspection): void {
    this.durable.set(inspection.meta.id, inspection)
  }
}

function header(id: string, cwd: string, overrides: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt: 1000, cwd, ...overrides }
}

/** Raw, undecoded `science/artifact-saved` event — the exact on-disk shape `SessionPersistence.inspect()` returns. */
function artifactSavedEvent(seq: number, artifact: Record<string, unknown>): SessionEvent {
  return {
    type: 'science/artifact-saved', seq, time: 1000,
    data: { version: 1, artifact },
  } as unknown as SessionEvent
}

describe('collectProjectArtifactEvents', () => {
  it('folds science/artifact-saved events per versionId (last write wins) across every matching session', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('s1', cwd),
      events: [
        artifactSavedEvent(1, {
          artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'plot.png', sha256: 'a'.repeat(64), title: 'plot.png', seenAt: 100,
        }),
      ],
    })
    persistence.setDurable({
      meta: header('s2', cwd),
      events: [
        // Re-records v1 with a curated title — later session's re-record wins.
        artifactSavedEvent(1, {
          artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'plot.png', sha256: 'a'.repeat(64), title: 'Curated', seenAt: 200,
        }),
        artifactSavedEvent(2, {
          artifactId: 'a2', versionId: 'v2', version: 1, logicalName: 'summary.csv', sha256: 'b'.repeat(64), title: 'summary.csv', caption: 'A caption', seenAt: 300,
        }),
      ],
    })

    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100 })
    expect(result.complete).toBe(true)
    expect(result.truncated).toBe(false)
    expect(result.events.size).toBe(2)
    expect(result.events.get(VersionId('v1'))?.title).toBe('Curated')
    expect(result.events.get(VersionId('v1'))?.producerSessionId).toBe('s2')
    expect(result.events.get(VersionId('v2'))?.logicalName).toBe('summary.csv')
    expect(result.events.get(VersionId('v2'))?.caption).toBe('A caption')
  })

  it('skips a session whose header cwd names a different workspace', async () => {
    const persistence = new TestPersistence(new Context())
    persistence.setDurable({
      meta: header('other', '/workspace/other-project'),
      events: [artifactSavedEvent(1, { artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), title: 'x', seenAt: 1 })],
    })
    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: '/workspace/project-a', maxSessions: 100 })
    expect(result.events.size).toBe(0)
  })

  it('skips a session with no cwd at all', async () => {
    const persistence = new TestPersistence(new Context())
    const { cwd: _cwd, ...noCwdHeader } = header('no-cwd', '')
    persistence.setDurable({ meta: noCwdHeader, events: [] })
    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: '/workspace/project-a', maxSessions: 100 })
    expect(result.events.size).toBe(0)
  })

  it('skips an unreadable session log (inspect rejects) and keeps reading the rest, with a warning', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({ meta: header('broken', cwd), events: [] })
    persistence.inspectFailureFor.add(SessionId('broken'))
    persistence.setDurable({
      meta: header('ok', cwd),
      events: [artifactSavedEvent(1, { artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), title: 'x', seenAt: 1 })],
    })
    const warnings: string[] = []
    const result = await collectProjectArtifactEvents({
      sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100, onWarning: message => warnings.push(message),
    })
    expect(result.events.size).toBe(1)
    expect(result.complete).toBe(false)
    expect(warnings.some(message => message.includes('unreadable session log'))).toBe(true)
  })

  it('skips a malformed science/artifact-saved event, with a warning, without failing the walk', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('s1', cwd),
      events: [
        { type: 'science/artifact-saved', seq: 1, time: 1, data: { version: 1, artifact: { versionId: 'v1' } } } as unknown as SessionEvent,
        artifactSavedEvent(2, { artifactId: 'a2', versionId: 'v2', version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), title: 'x', seenAt: 1 }),
      ],
    })
    const warnings: string[] = []
    const result = await collectProjectArtifactEvents({
      sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100, onWarning: message => warnings.push(message),
    })
    expect(result.events.size).toBe(1)
    expect(result.complete).toBe(false)
    expect(result.events.has(VersionId('v2'))).toBe(true)
    expect(warnings.some(message => message.includes('malformed'))).toBe(true)
    expect(result.cursor).toBeDefined()
    const retry = await collectProjectArtifactEvents({
      sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100, cursor: result.cursor!,
    })
    expect(retry.changed).toBe(false)
  })

  it('skips a raw event value that is not an object', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('s1', cwd),
      events: [{ type: 'science/artifact-saved', seq: 1, time: 1, data: 'not-an-object' } as unknown as SessionEvent],
    })
    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100 })
    expect(result.events.size).toBe(0)
  })

  it('skips an event value whose artifact field is missing or not an object', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('s1', cwd),
      events: [
        { type: 'science/artifact-saved', seq: 1, time: 1, data: { version: 1 } } as unknown as SessionEvent,
        { type: 'science/artifact-saved', seq: 2, time: 1, data: { version: 1, artifact: 'not-an-object' } } as unknown as SessionEvent,
      ],
    })
    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100 })
    expect(result.events.size).toBe(0)
  })

  it('skips an otherwise well-formed event with neither seenAt nor a legacy createdAt', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('s1', cwd),
      events: [artifactSavedEvent(1, { artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), title: 'x' })],
    })
    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100 })
    expect(result.events.size).toBe(0)
  })

  it('defaults a missing title/caption to null rather than a non-string value', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('s1', cwd),
      events: [artifactSavedEvent(1, { artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), seenAt: 1 })],
    })
    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100 })
    expect(result.events.get(VersionId('v1'))).toMatchObject({ title: null, caption: null })
  })

  it('ignores every non-science/artifact-saved event in a matching session log', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('s1', cwd),
      events: [
        { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as unknown as SessionEvent,
        artifactSavedEvent(2, { artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), title: 'x', seenAt: 1 }),
      ],
    })
    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100 })
    expect(result.events.size).toBe(1)
  })

  it('falls back to a legacy createdAt when seenAt is absent', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('s1', cwd),
      events: [artifactSavedEvent(1, { artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), title: 'x', createdAt: 555 })],
    })
    const result = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 100 })
    expect(result.events.get(VersionId('v1'))?.seenAt).toBe(555)
  })

  it('continues beyond maxSessions on the next bounded call and returns the accumulated event set', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    for (let i = 0; i < 3; i += 1) {
      persistence.setDurable({
        meta: header(`s${String(i)}`, cwd),
        events: [artifactSavedEvent(1, { artifactId: `a${String(i)}`, versionId: `v${String(i)}`, version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), title: 'x', seenAt: 1 })],
      })
    }
    const first = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 2 })
    expect(first.complete).toBe(false)
    expect(first.truncated).toBe(true)
    expect(first.events.size).toBe(2)
    expect(first.cursor).toBeDefined()

    const second = await collectProjectArtifactEvents({
      sessionPersistence: persistence, workspacePath: cwd, maxSessions: 2,
      cursor: first.cursor!,
    })
    expect(second.complete).toBe(true)
    expect(second.truncated).toBe(false)
    expect(second.events.size).toBe(3)
    expect(persistence.inspectCalls).toBe(3)
  })

  it('rotates an unreadable session behind the unvisited tail', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({ meta: header('broken', cwd), events: [] })
    persistence.inspectFailureFor.add(SessionId('broken'))
    persistence.setDurable({
      meta: header('tail', cwd),
      events: [artifactSavedEvent(1, {
        artifactId: 'tail-artifact', versionId: 'tail-version', version: 1,
        logicalName: 'tail.png', sha256: 'a'.repeat(64), title: 'tail', seenAt: 1,
      })],
    })

    const first = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 1 })
    expect(first.events.size).toBe(0)
    expect(first.cursor).toBeDefined()
    const second = await collectProjectArtifactEvents({
      sessionPersistence: persistence, workspacePath: cwd, maxSessions: 1,
      cursor: first.cursor!,
    })
    expect(second.complete).toBe(false)
    expect(second.events.has(VersionId('tail-version'))).toBe(true)
    expect(second.cursor?.pendingSessionIds).toEqual([SessionId('broken')])
  })

  it('degrades gracefully to an empty result, with a warning, when listing session logs itself fails', async () => {
    const persistence = new TestPersistence(new Context())
    persistence.listFailure = new Error('forced list failure')
    const warnings: string[] = []
    const result = await collectProjectArtifactEvents({
      sessionPersistence: persistence, workspacePath: '/workspace/project-a', maxSessions: 100, onWarning: message => warnings.push(message),
    })
    expect(result).toEqual({ events: new Map(), complete: false, truncated: false, changed: false })
    expect(warnings.some(message => message.includes('could not list session logs'))).toBe(true)
  })

  it('retains accumulated events and cursor when a later session listing fails', async () => {
    const persistence = new TestPersistence(new Context())
    const cwd = '/workspace/project-a'
    persistence.setDurable({
      meta: header('retained', cwd),
      events: [artifactSavedEvent(1, {
        artifactId: 'retained-artifact', versionId: 'retained-version', version: 1,
        logicalName: 'retained.png', sha256: 'a'.repeat(64), title: 'retained', seenAt: 1,
      })],
    })
    const first = await collectProjectArtifactEvents({ sessionPersistence: persistence, workspacePath: cwd, maxSessions: 1 })
    expect(first.cursor).toBeDefined()
    persistence.listFailure = new Error('forced later list failure')

    const second = await collectProjectArtifactEvents({
      sessionPersistence: persistence, workspacePath: cwd, maxSessions: 1, cursor: first.cursor!,
    })
    expect(second.events.has(VersionId('retained-version'))).toBe(true)
    expect(second.cursor).toBe(first.cursor)
    expect(second).toMatchObject({ complete: false, truncated: false, changed: false })
  })
})

describe('ScienceRuntime reconciliation trigger', () => {
  async function bindFakePython(runtime: Awaited<ReturnType<typeof createControlledRuntimeHarness>>['runtime'], session: ReturnType<typeof createScienceSession>): Promise<void> {
    await runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal })
  }

  it('triggers a reconciliation pass exactly once across two sessions sharing the same project', async () => {
    const root = tmp('.science-runtime-reconcile-trigger-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    await harness.ctx.plugin(TestPersistence)
    const persistence = harness.ctx.sessionPersistence as unknown as TestPersistence

    const cwd = mkdtempSync(join(process.cwd(), '.science-runtime-reconcile-ws-'))
    roots.push(cwd)
    const sessionA = createScienceSession(harness.ctx, 'reconcile-trigger-a', cwd)
    await bindFakePython(harness.runtime, sessionA)
    await vi.waitFor(() => { expect(persistence.listCalls).toBe(1) })

    const sessionB = createScienceSession(harness.ctx, 'reconcile-trigger-b', cwd)
    await bindFakePython(harness.runtime, sessionB)
    // Give any (incorrect) second trigger a chance to run before asserting it did not.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(persistence.listCalls).toBe(1)
  })

  it('retries an incomplete event collection only after the configured delay on a later project resolution', async () => {
    const root = tmp('.science-runtime-reconcile-trigger-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, { reconcileRetryDelayMs: 50 },
    )
    contexts.push(harness.ctx)
    await harness.ctx.plugin(TestPersistence)
    const persistence = harness.ctx.sessionPersistence as unknown as TestPersistence
    const warnSpy = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => {})
    persistence.listFailure = new Error('forced list failure')

    const cwd = mkdtempSync(join(process.cwd(), '.science-runtime-reconcile-ws-'))
    roots.push(cwd)
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-retry-first', cwd))
    await vi.waitFor(() => { expect(persistence.listCalls).toBe(1) })
    await vi.waitFor(() => {
      expect(warnSpy.mock.calls.some(call => String(call[0]).includes('orphan classification was skipped'))).toBe(true)
    })

    persistence.listFailure = undefined
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-retry-too-soon', cwd))
    expect(persistence.listCalls).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 60))
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-retry-later', cwd))
    await vi.waitFor(() => { expect(persistence.listCalls).toBe(2) })
  })

  it('advances a truncated session walk and memoizes only after the accumulated set is reconciled', async () => {
    const root = tmp('.science-runtime-reconcile-trigger-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined,
      { reconcileMaxSessions: 1, reconcileRetryDelayMs: 1 },
    )
    contexts.push(harness.ctx)
    await harness.ctx.plugin(TestPersistence)
    const persistence = harness.ctx.sessionPersistence as unknown as TestPersistence
    const cwd = mkdtempSync(join(process.cwd(), '.science-runtime-reconcile-ws-'))
    roots.push(cwd)
    for (let index = 1; index <= 2; index += 1) {
      persistence.setDurable({
        meta: header(`durable-${String(index)}`, cwd),
        events: [artifactSavedEvent(1, {
          artifactId: `artifact-${String(index)}`, versionId: `version-${String(index)}`,
          version: 1, logicalName: `plot-${String(index)}.png`, sha256: String(index).repeat(64),
          title: `plot-${String(index)}`, seenAt: index,
        })],
      })
    }

    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-page-1', cwd))
    await vi.waitFor(() => { expect(persistence.inspectCalls).toBe(1) })
    await new Promise(resolve => setTimeout(resolve, 5))
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-page-2', cwd))
    await vi.waitFor(() => { expect(persistence.inspectCalls).toBe(2) })
    const opened = await harness.ctx.scienceArtifactStore.openProject(cwd)
    await vi.waitFor(async () => {
      await expect(harness.ctx.scienceArtifactStore.getVersion(opened.projectId, VersionId('version-2'))).resolves.toBeDefined()
    })

    await new Promise(resolve => setTimeout(resolve, 5))
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-page-memoized', cwd))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(persistence.listCalls).toBe(2)
  })

  it('carries the store cursor to a later resolution and memoizes after it empties', async () => {
    const root = tmp('.science-runtime-reconcile-trigger-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, { reconcileRetryDelayMs: 1 },
    )
    contexts.push(harness.ctx)
    await harness.ctx.plugin(TestPersistence)
    const cursor = {
      pending: [{ kind: 'version' as const, versionId: VersionId('pending-version') }],
      completedVersionIds: [],
      completedDanglingEventIds: [],
    }
    const reconcile = vi.spyOn(harness.ctx.scienceArtifactStore, 'reconcileProject')
      .mockResolvedValueOnce({
        checkedVersions: 1, outcomes: [], reconstructed: [], truncated: true, errors: [], cursor,
      })
      .mockResolvedValueOnce({
        checkedVersions: 1, outcomes: [], reconstructed: [], truncated: false, errors: [],
      })
    const cwd = mkdtempSync(join(process.cwd(), '.science-runtime-reconcile-ws-'))
    roots.push(cwd)

    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-store-page-1', cwd))
    await vi.waitFor(() => { expect(reconcile).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 5))
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-store-page-2', cwd))
    await vi.waitFor(() => { expect(reconcile).toHaveBeenCalledTimes(2) })
    expect(reconcile.mock.calls[1]?.[3]).toBe(cursor)

    await new Promise(resolve => setTimeout(resolve, 5))
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-store-page-memoized', cwd))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('does not memoize a completed store cursor when an earlier page reported an item error', async () => {
    const root = tmp('.science-runtime-reconcile-trigger-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, { reconcileRetryDelayMs: 1 },
    )
    contexts.push(harness.ctx)
    await harness.ctx.plugin(TestPersistence)
    const cursor = {
      pending: [{ kind: 'version' as const, versionId: VersionId('pending-after-error') }],
      completedVersionIds: [],
      completedDanglingEventIds: [],
    }
    const reconcile = vi.spyOn(harness.ctx.scienceArtifactStore, 'reconcileProject')
      .mockResolvedValueOnce({
        checkedVersions: 1, outcomes: [], reconstructed: [], truncated: true,
        errors: ['forced first-page item error'], cursor,
      })
      .mockResolvedValue({
        checkedVersions: 1, outcomes: [], reconstructed: [], truncated: false, errors: [],
      })
    const cwd = mkdtempSync(join(process.cwd(), '.science-runtime-reconcile-ws-'))
    roots.push(cwd)

    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-error-page-1', cwd))
    await vi.waitFor(() => { expect(reconcile).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 5))
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-error-page-2', cwd))
    await vi.waitFor(() => { expect(reconcile).toHaveBeenCalledTimes(2) })
    await new Promise(resolve => setTimeout(resolve, 5))
    await bindFakePython(harness.runtime, createScienceSession(harness.ctx, 'reconcile-error-retry', cwd))
    await vi.waitFor(() => { expect(reconcile).toHaveBeenCalledTimes(3) })
  })

  it('reconciliation failure never blocks or fails the Science operation that triggered it', async () => {
    const root = tmp('.science-runtime-reconcile-trigger-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    await harness.ctx.plugin(TestPersistence)
    const warnSpy = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => {})
    vi.spyOn(harness.ctx.scienceArtifactStore, 'reconcileProject').mockRejectedValueOnce(new Error('forced reconcile failure'))

    const cwd = mkdtempSync(join(process.cwd(), '.science-runtime-reconcile-ws-'))
    roots.push(cwd)
    const session = createScienceSession(harness.ctx, 'reconcile-trigger-failure', cwd)
    await expect(bindFakePython(harness.runtime, session)).resolves.toBeUndefined()

    await vi.waitFor(() => {
      expect(warnSpy.mock.calls.some(call => String(call[0]).includes('project reconciliation failed and was skipped'))).toBe(true)
    })
  })

  it('skips reconciliation entirely, without error, when no sessionPersistence service is mounted', async () => {
    const root = tmp('.science-runtime-reconcile-trigger-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    expect(harness.ctx.get('sessionPersistence')).toBeUndefined()

    const cwd = mkdtempSync(join(process.cwd(), '.science-runtime-reconcile-ws-'))
    roots.push(cwd)
    const session = createScienceSession(harness.ctx, 'reconcile-trigger-no-persistence', cwd)
    await expect(bindFakePython(harness.runtime, session)).resolves.toBeUndefined()
  })

  it('logs both a skipped-session warning and a truncated warning through ctx.logger.warn, wired from the collect step through to the trigger', async () => {
    const root = tmp('.science-runtime-reconcile-trigger-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createControlledRuntimeHarness(
      root, { fake: { pythonPrefix: prefix } }, 10_000, undefined, { reconcileMaxSessions: 1 },
    )
    contexts.push(harness.ctx)
    await harness.ctx.plugin(TestPersistence)
    const persistence = harness.ctx.sessionPersistence as unknown as TestPersistence
    const warnSpy = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => {})

    const cwd = mkdtempSync(join(process.cwd(), '.science-runtime-reconcile-ws-'))
    roots.push(cwd)
    // Two sessions match this project's workspace; reconcileMaxSessions: 1
    // admits only the first (insertion order), which is also unreadable —
    // exercising both the onWarning-wired skipped-session path and the
    // sessions-truncated warning in the same call.
    persistence.setDurable({ meta: header('reconcile-trigger-broken', cwd), events: [] })
    persistence.inspectFailureFor.add(SessionId('reconcile-trigger-broken'))
    persistence.setDurable({
      meta: header('reconcile-trigger-second', cwd),
      events: [artifactSavedEvent(1, { artifactId: 'a1', versionId: 'v1', version: 1, logicalName: 'x.png', sha256: 'a'.repeat(64), title: 'x', seenAt: 1 })],
    })

    const session = createScienceSession(harness.ctx, 'reconcile-trigger-warnings', cwd)
    await bindFakePython(harness.runtime, session)

    await vi.waitFor(() => {
      const messages = warnSpy.mock.calls.map(call => String(call[0]))
      expect(messages.some(message => message.includes('unreadable session log'))).toBe(true)
      expect(messages.some(message => message.includes('was truncated'))).toBe(true)
    })
  })
})
