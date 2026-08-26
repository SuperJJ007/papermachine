import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import * as ScienceInvariant from '../src/invariant.ts'
import {
  ScienceEnvironmentProfileId,
  ScienceArtifactId,
  ScienceRunId,
  ScienceScratchKey,
} from '../src/index.ts'
import {
  ARTIFACT_ID,
  FINGERPRINT,
  artifact,
  appendFixtureEvents,
  legalEvents,
  runStarted,
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

  it('accepts Science mode binding after a blank session switches its live preset to `science`, even though its frozen header still names the preset it was created with', async () => {
    // `resolveSessionPreset`'s newest-selection-wins rule, not the creation
    // header alone: a session recomposed to `science` while blank records
    // only an `agent-preset/selected` event, and this invariant's applicability
    // check must agree with `dsh-tool-science`'s `isScienceSession`, which
    // already resolves the same way.
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('science-invariant-standard-then-switched'), {
      meta: { agentPreset: 'standard' },
    })

    expect(() => { appendMode(session) }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: PACKAGE_NAME,
    }))
    expect(session.events).toEqual([])

    session.append('agent-preset/selected', { agentPreset: 'science' })
    expect(() => { appendMode(session) }).not.toThrow()
    expect(session.events.map(event => event.type)).toEqual(['agent-preset/selected', 'science/mode-bound'])
  })

  it('re-seeds a session that switched to `science` while blank without retroactively failing its history', async () => {
    // Exercises the seed/replay path (Host restart), not just the live
    // dispatch path the preceding test covers: a naive re-seed that resolved
    // the preset once for the whole log, instead of incrementally as of each
    // historical event, would carry `science` backward over events that
    // preceded the switch.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('science-invariant-late-seed-switched'), {
      meta: { agentPreset: 'standard' },
    })
    session.append('agent-preset/selected', { agentPreset: 'science' })
    appendLegalChain(session)
    const before = session.seq

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceInvariant)

    expect(() => { appendMode(session) }).toThrow(/bound only once/)
    expect(session.seq).toBe(before)
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

  it('accepts a fully typed seven-event Science chain', async () => {
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
      'science/kernel-state',
      'science/run-started',
      'science/run-finished',
      'science/artifact-saved',
      'science/outcome-published',
    ])
  })

  it('rejects unresolved artifact parents and run inputs before commit', async () => {
    const ctx = await setup()
    const parentSession = ctx.sessions.create(SessionId('science-invariant-parent'), {
      meta: { agentPreset: 'science' },
    })
    appendFixtureEvents(parentSession, legalEvents().slice(0, 8))
    const parentSeq = parentSession.seq
    expect(() => parentSession.append('science/artifact-saved', {
      version: 1,
      artifact: artifact({
        parent: { artifactId: ScienceArtifactId('missing-parent'), version: 1 },
        createdAt: parentSession.events.at(-1)!.time,
      }),
    })).toThrow(/does not identify a committed artifact version/)
    expect(parentSession.seq).toBe(parentSeq)

    const inputSession = ctx.sessions.create(SessionId('science-invariant-input'), {
      meta: { agentPreset: 'science' },
    })
    appendFixtureEvents(inputSession, legalEvents().slice(0, 9))
    const call = inputSession.append('tool/call', {
      turn: 2,
      step: 1,
      callId: CallId('call-input-run'),
      name: 'run_python',
      arguments: '{}',
    })
    const inputSeq = inputSession.seq
    // ARTIFACT_ID is known to this session's own log (committed by the
    // `legalEvents().slice(0, 9)` prefix above), so naming it at a version
    // that was never committed is a same-session inconsistency the fold
    // still catches — unlike an artifactId this session's log has never
    // recorded at all, which S3 accepts as a legitimate cross-session
    // reference (see science-session's fold.spec.ts).
    expect(() => inputSession.append('science/run-started', {
      version: 1,
      run: runStarted({
        runId: ScienceRunId('input-run'),
        toolCallId: call.data.callId,
        startedAt: call.time,
        runDirectoryRef: 'runs/input-run/',
        inputs: [{ artifactId: ARTIFACT_ID, version: 99, path: 'input.png' }],
      }),
    })).toThrow(/does not identify a committed artifact version/)
    expect(inputSession.seq).toBe(inputSeq)
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
          packages: [{ name: 'pip', version: '24.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
          capability: 'available',
        },
      },
    })
    session.append('science/kernel-state', {
      version: 1,
      kernel: {
        kernelEpoch: 1,
        language: 'python',
        state: 'started',
        environmentRevision: 1,
        environmentFingerprint: FINGERPRINT,
        at: modeTime,
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
        kernelEpoch: 1,
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
          packages: [{ name: 'pip', version: '24.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
          capability: 'available',
        },
      },
    })).not.toThrow()
    expect(session.seq).toBe(before + 1)
  })
})
