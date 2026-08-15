import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import * as ScienceInvariant from '../src/invariant.ts'
import {
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from '../src/index.ts'
import {
  FINGERPRINT,
  appendFixtureEvents,
} from './fixtures.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-science-session'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ScienceInvariant)
  return ctx
}

function appendMode(session: Session): number {
  return session.append('science/mode-bound', {
    version: 1,
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r3' },
  }).time
}

function appendLegalChain(session: Session): void {
  appendFixtureEvents(session)
}

describe('Science stream invariant', () => {
  it('rejects step, request, and tool activity before mode binding without committing it', async () => {
    const ctx = await setup()
    const cases: Array<readonly [string, (session: Session) => void]> = [
      ['step', (session) => {
        session.append('step/start', { turn: 1, step: 1 })
      }],
      ['request', (session) => {
        session.append('request/header', {
          header: { config: { provider: 'test', model: 'test-model' } },
          reason: 'initial',
        })
      }],
      ['tool', (session) => {
        session.append('tool/call', {
          turn: 1,
          step: 1,
          callId: CallId('call-before-mode'),
          name: 'run_python',
          arguments: '{}',
        })
      }],
    ]

    for (const [name, append] of cases) {
      const session = ctx.sessions.create(SessionId(`science-invariant-${name}-before-mode`), {
        meta: { agentPreset: 'science' },
      })
      expect(() => { append(session) }, name).toThrow(expect.objectContaining<Partial<InvariantError>>({
        code: 'INVARIANT',
        packageName: PACKAGE_NAME,
      }))
      expect(session.events, name).toEqual([])

      appendMode(session)
      expect(session.events.map(event => event.type), name).toEqual(['science/mode-bound'])
    }

    const accepted = ctx.sessions.create(SessionId('science-invariant-header-after-mode'), {
      meta: { agentPreset: 'science' },
    })
    appendMode(accepted)
    expect(() => accepted.append('request/header', {
      header: { config: { provider: 'test', model: 'test-model' } },
      reason: 'initial',
    })).not.toThrow()
  })

  it('seeds sessions that predate invariant installation', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('science-invariant-late-seed'), {
      meta: { agentPreset: 'science' },
    })
    appendLegalChain(session)
    const before = session.seq

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceInvariant)

    expect(() => { appendMode(session) }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: PACKAGE_NAME,
    }))
    expect(session.seq).toBe(before)
  })

  it('rejects a Science event in a standard session before commit', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('science-invariant-standard'))

    expect(() => {
      appendMode(session)
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: PACKAGE_NAME,
    }))
    expect(session.seq).toBe(0)
    expect(session.events).toEqual([])
  })

  it('accepts a fully typed six-event Science chain', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('science-invariant-valid'), {
      meta: { agentPreset: 'science' },
    })

    expect(() => {
      appendLegalChain(session)
    }).not.toThrow()
    expect(session.events.filter(event => event.type.startsWith('science/')).map(event => event.type)).toEqual([
      'science/mode-bound',
      'science/environment-bound',
      'science/run-started',
      'science/run-finished',
      'science/chart-saved',
      'science/outcome-published',
    ])
  })

  it('rejects a Science fact after the authorizing call step ended without committing it', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('science-invariant-call-after-step'), {
      meta: { agentPreset: 'science' },
    })
    const modeTime = appendMode(session)
    session.append('science/environment-bound', {
      version: 1,
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('profile-1'),
        configuredAt: modeTime,
        validatedAt: modeTime,
        status: 'applied',
        python: {
          language: 'python',
          configuredPrefix: '/opt/science',
          canonicalPrefix: '/opt/science',
          executable: '/opt/science/bin/python',
          executableIdentity: 'dev:1-ino:2',
          languageVersion: '3.13.5',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: FINGERPRINT,
          capability: 'available',
        },
      },
    })
    session.append('step/start', { turn: 1, step: 1 })
    const request = session.append('request/header', {
      header: { config: { provider: 'test', model: 'test-model' } },
      reason: 'initial',
    })
    const callId = CallId('call-after-step')
    const call = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'run_python',
      arguments: '{}',
    })
    session.append('step/end', { turn: 1, step: 1 })
    const before = session.seq

    expect(() => session.append('science/run-started', {
      version: 1,
      run: {
        runId: ScienceRunId('run-after-step'),
        language: 'python',
        toolCallId: callId,
        requestHeaderSeq: request.seq,
        environmentRevision: 1,
        environmentFingerprint: FINGERPRINT,
        startedAt: call.time,
        codeSha256: 'c'.repeat(64),
        scratchKey: ScienceScratchKey('d'.repeat(64)),
        runDirectoryRef: 'runs/run-after-step/',
        status: 'running',
      },
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: PACKAGE_NAME,
    }))
    expect(session.seq).toBe(before)
  })

  it('does not advance staged fold state after a rejected append', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('science-invariant-transactional'), {
      meta: { agentPreset: 'science' },
    })
    const modeTime = appendMode(session)
    const before = session.seq

    expect(() => session.append('science/environment-bound', {
      version: 1,
      environment: {
        revision: 2,
        profileId: ScienceEnvironmentProfileId('profile-2'),
        configuredAt: modeTime,
        validatedAt: modeTime,
        status: 'invalid',
        python: {
          language: 'python',
          configuredPrefix: '/missing',
          canonicalPrefix: '/missing',
          executable: '/missing/bin/python',
          executableIdentity: 'missing',
          languageVersion: 'unknown',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: FINGERPRINT,
          capability: 'invalid',
          reason: 'missing interpreter',
        },
        failureReason: 'missing interpreter',
      },
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: PACKAGE_NAME,
    }))
    expect(session.seq).toBe(before)

    expect(() => session.append('science/environment-bound', {
      version: 1,
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('profile-1'),
        configuredAt: modeTime,
        validatedAt: modeTime,
        status: 'applied',
        python: {
          language: 'python',
          configuredPrefix: '/opt/science',
          canonicalPrefix: '/opt/science',
          executable: '/opt/science/bin/python',
          executableIdentity: 'dev:1-ino:2',
          languageVersion: '3.13.5',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: FINGERPRINT,
          capability: 'available',
        },
      },
    })).not.toThrow()
    expect(session.seq).toBe(before + 1)
  })
})
