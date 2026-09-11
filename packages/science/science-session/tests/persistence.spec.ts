/** Science vocabulary survives native V3 storage and refuses unsafe historical migration. */

import { Context } from '@deepseek-ai/cordis'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { generationLogPath } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { compressZstdFrame } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyScienceArtifactNotes, replayScience } from '../src/index.ts'
import type { ScienceArtifactNotesProjection } from '../src/index.ts'
import { appendFixtureEvents, ARTIFACT_ID } from './fixtures.ts'

const scienceTypes = [
  'science/mode-bound', 'science/environment-bound', 'science/kernel-state',
  'science/run-started', 'science/run-finished', 'science/artifact-saved',
  'science/outcome-published', 'science/artifact-note-added', 'science/artifact-note-removed',
]

let root: string
let ctx: Context
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'science-session-format-'))
  ctx = new Context()
})
afterEach(async () => {
  try {
    await ctx.fiber.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

describe.each(['none', 'zstd'] as const)('Science session storage (%s)', (compression) => {
  it('reopens captured underscore and Unicode identities without rewriting historical events', async () => {
    await ctx.plugin(JsonlSessionPersistence, { root, compression })
    const id = SessionId('science-logical-name-roundtrip')
    const header: SessionHeader = { id, version: 3, createdAt: 1000, isSeeded: false, agentPreset: 'science' }
    const original = Session.create(id, [], header)
    appendFixtureEvents(original)
    const events = original.snapshotEvents().map(event => event.type === 'science/artifact-saved'
      ? { ...event, data: { ...event.data, artifact: { ...event.data.artifact,
        logicalName: event.data.artifact.artifactId === ARTIFACT_ID ? '_probe/p.csv' : '中文 数据/结果.csv' } } }
      : event)
    const writer = await ctx.sessionPersistence.create(header)
    await writer.append(events)
    await writer.close()
    const reader = await ctx.sessionPersistence.open(id, 'read')
    try {
      const restored = await reader.read()
      expect(restored.events).toEqual(events)
      expect(replayScience(restored.events)?.artifacts.map(artifact => artifact.logicalName)).toContain('_probe/p.csv')
    } finally {
      await reader.close()
    }
  })

  it('reopens all nine required V3 events and retains both projections and sequence references', async () => {
    await ctx.plugin(JsonlSessionPersistence, { root, compression })
    const id = SessionId('science-v3-roundtrip')
    const header: SessionHeader = { id, version: 3, createdAt: 1000, isSeeded: false, agentPreset: 'science' }
    const session = Session.create(id, [], header)
    appendFixtureEvents(session)
    const added = session.append('science/artifact-note-added', {
      version: 1, artifactId: ARTIFACT_ID, artifactVersion: 1, text: 'Keep the axis label', createdAt: 2000,
    })
    const writer = await ctx.sessionPersistence.create(header)
    try {
      await writer.append(session.snapshotEvents())
    } finally {
      await writer.close()
    }
    const reopened = await ctx.sessionPersistence.open(id, 'write')
    try {
      const restored = await reopened.read()
      expect(restored.events).toEqual(session.snapshotEvents())
      expect(restored.events.reduce<ScienceArtifactNotesProjection>(applyScienceArtifactNotes, []))
        .toMatchObject([{ seq: added.seq, text: 'Keep the axis label' }])
      const removed = session.append('science/artifact-note-removed', {
        version: 1, artifactId: ARTIFACT_ID, noteSeq: added.seq, removedAt: 2100,
      })
      await reopened.append([removed])
    } finally {
      await reopened.close()
    }
    const reader = await ctx.sessionPersistence.open(id, 'read')
    try {
      const restored = await reader.read()
      expect(reader.header.version).toBe(3)
      expect(restored.events).toEqual(session.snapshotEvents())
      expect(replayScience(restored.events)).toEqual(replayScience(session.snapshotEvents()))
      expect(restored.events.reduce<ScienceArtifactNotesProjection>(applyScienceArtifactNotes, [])).toEqual([])
      const science = restored.events.filter(event => event.type.startsWith('science/'))
      expect(science.map(event => event.type)).toEqual(scienceTypes)
      for (const event of science) {
        expect(KNOWN_SESSION_EVENT_TYPES.has(event.type)).toBe(true)
        expect(event).not.toHaveProperty('ignorable')
      }
    } finally {
      await reader.close()
    }
    const path = generationLogPath(root, undefined, id, 3, compression)
    expect(await readdir(dirname(path))).toContain(compression === 'none' ? 'session.v3.jsonl' : 'session.v3.jsonl.zstd')
  })

  it.each(scienceTypes.flatMap(type => [false, true].map(ignorable => ({ type, ignorable }))))(
    'refuses V0 $type (ignorable=$ignorable) without publishing a successor', async ({ type, ignorable }) => {
      await ctx.plugin(JsonlSessionPersistence, { root, compression })
      const id = SessionId('science-v0-refusal')
      const rows = [
        { type: 'session', version: 0, id, createdAt: 1000, delegationDepth: 0 },
        { type, seq: 0, time: 1001, data: { version: 1 }, ...(ignorable ? { ignorable: true } : {}) },
      ]
      const jsonl = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n')
      const bytes = compression === 'zstd'
        ? Buffer.concat(await Promise.all(rows.map(row => compressZstdFrame(JSON.stringify(row) + '\n'))))
        : jsonl
      const path = generationLogPath(root, undefined, id, 0, compression)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
      const before = await stat(path)
      for (const access of ['read', 'write'] as const) {
        const opened = ctx.sessionPersistence.open(id, access).then(async (handle) => { await handle.close() })
        await expect(opened).rejects.toThrow(`format v0 contains unknown historical event type ${JSON.stringify(type)}`)
        expect(await readFile(path)).toEqual(bytes)
        expect(await stat(path)).toMatchObject({ dev: before.dev, ino: before.ino, size: before.size })
        expect((await readdir(dirname(path))).filter(name => name.endsWith('.jsonl') || name.endsWith('.zstd')))
          .toEqual([compression === 'none' ? 'session.jsonl' : 'session.jsonl.zstd'])
      }
    },
  )
})
