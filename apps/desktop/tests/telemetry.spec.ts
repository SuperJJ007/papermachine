import { describe, expect, it, vi } from 'vitest'
import { resolveTelemetryEndpoints, TelemetryReporter, type TelemetryFetch } from '../src/telemetry.ts'

const CONTEXT = {
  anonymousId: 'anon-1',
  appVersion: '1.2.3',
  platform: 'darwin' as const,
  arch: 'arm64' as const,
}

describe('resolveTelemetryEndpoints', () => {
  it('returns the configured endpoints unchanged when the disable switch is unset', () => {
    expect(resolveTelemetryEndpoints(undefined, ['https://a.example'])).toEqual(['https://a.example'])
  })

  it('disables on any non-empty DSH_TELEMETRY_DISABLED value, including falsy-looking strings', () => {
    for (const value of ['1', 'true', '0', 'false', 'anything']) {
      expect(resolveTelemetryEndpoints(value, ['https://a.example'])).toEqual([])
    }
  })

  it('stays enabled when the switch is the empty string', () => {
    expect(resolveTelemetryEndpoints('', ['https://a.example'])).toEqual(['https://a.example'])
  })
})

describe('TelemetryReporter', () => {
  it('sends the exact documented fields for app.launch, nothing else', async () => {
    const calls: [string, RequestInit][] = []
    const fetchStub: TelemetryFetch = async (url, init) => { calls.push([url, init]); return new Response(null, { status: 200 }) }
    const reporter = new TelemetryReporter({
      endpoints: ['https://a.example/events'],
      context: CONTEXT,
      fetch: fetchStub,
      now: () => Date.parse('2026-09-01T00:00:00.000Z'),
      randomUUID: () => 'event-uuid-1',
    })

    await reporter.report({ event: 'app.launch' })

    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]!
    expect(url).toBe('https://a.example/events')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({
      eventId: 'event-uuid-1',
      anonymousId: 'anon-1',
      event: 'app.launch',
      timestamp: '2026-09-01T00:00:00.000Z',
      appVersion: '1.2.3',
      platform: 'darwin',
      arch: 'arm64',
      schemaVersion: 1,
    })
  })

  it('reports the configured platform, including win32', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchStub: TelemetryFetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body as string) as Record<string, unknown>)
      return new Response(null, { status: 200 })
    }
    const reporter = new TelemetryReporter({
      endpoints: ['https://a.example/events'],
      context: { ...CONTEXT, platform: 'win32', arch: 'x64' },
      fetch: fetchStub,
      now: () => Date.parse('2026-09-01T00:00:00.000Z'),
      randomUUID: () => 'event-uuid-1',
    })

    await reporter.report({ event: 'app.launch' })

    expect(bodies[0]).toEqual(expect.objectContaining({ platform: 'win32', arch: 'x64' }))
  })

  it('sends the documented fields for environment.installed and environment.install-failed', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchStub: TelemetryFetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body as string) as Record<string, unknown>)
      return new Response(null, { status: 200 })
    }
    const reporter = new TelemetryReporter({
      endpoints: ['https://a.example/events'],
      context: CONTEXT,
      fetch: fetchStub,
      now: () => 0,
      randomUUID: () => 'event-uuid',
    })

    await reporter.report({ event: 'environment.installed', sourceId: 'tuna', durationMs: 4200, environmentId: 'general' })
    await reporter.report({ event: 'environment.install-failed', sourceId: 'ustc', phase: 'installing', cancelled: false })

    expect(bodies[0]).toEqual(expect.objectContaining({
      event: 'environment.installed', sourceId: 'tuna', durationMs: 4200, environmentId: 'general',
    }))
    expect(Object.keys(bodies[0]!).sort()).toEqual(
      ['anonymousId', 'appVersion', 'arch', 'durationMs', 'environmentId', 'event', 'eventId', 'platform', 'schemaVersion', 'sourceId', 'timestamp'],
    )
    expect(bodies[1]).toEqual(expect.objectContaining({
      event: 'environment.install-failed', sourceId: 'ustc', phase: 'installing', cancelled: false,
    }))
    expect(Object.keys(bodies[1]!).sort()).toEqual(
      ['anonymousId', 'appVersion', 'arch', 'cancelled', 'event', 'eventId', 'phase', 'platform', 'schemaVersion', 'sourceId', 'timestamp'],
    )
  })

  it('sends every configured endpoint independently, in full', async () => {
    const hit = new Set<string>()
    const fetchStub: TelemetryFetch = async (url) => { hit.add(url); return new Response(null, { status: 200 }) }
    const reporter = new TelemetryReporter({
      endpoints: ['https://a.example/events', 'https://b.example/events'],
      context: CONTEXT,
      fetch: fetchStub,
    })

    await reporter.report({ event: 'app.launch' })

    expect(hit).toEqual(new Set(['https://a.example/events', 'https://b.example/events']))
  })

  it('is a no-op with no endpoints configured (telemetry off)', async () => {
    const fetchStub = vi.fn<TelemetryFetch>(async () => new Response(null, { status: 200 }))
    const reporter = new TelemetryReporter({ endpoints: [], context: CONTEXT, fetch: fetchStub })

    await reporter.report({ event: 'app.launch' })

    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('a failing or hanging endpoint never affects delivery to, or the caller waiting on, the others', async () => {
    const delivered: string[] = []
    const fetchStub: TelemetryFetch = async (url, init) => {
      if (url === 'https://fails.example/events') throw new Error('boom')
      if (url === 'https://hangs.example/events') {
        // A real fetch rejects once its AbortSignal fires; this stub mimics
        // that instead of hanging the test forever waiting on a promise the
        // production timeout would actually have settled.
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        })
      }
      delivered.push(url)
      return new Response(null, { status: 200 })
    }
    const reporter = new TelemetryReporter({
      endpoints: ['https://fails.example/events', 'https://hangs.example/events', 'https://ok.example/events'],
      context: CONTEXT,
      fetch: fetchStub,
      requestTimeoutMs: 5,
    })

    await expect(reporter.report({ event: 'app.launch' })).resolves.toBeUndefined()

    expect(delivered).toEqual(['https://ok.example/events'])
  })

  it('never rejects even when every endpoint fails', async () => {
    const fetchStub: TelemetryFetch = async () => { throw new Error('network down') }
    const reporter = new TelemetryReporter({ endpoints: ['https://a.example/events'], context: CONTEXT, fetch: fetchStub })

    await expect(reporter.report({ event: 'app.launch' })).resolves.toBeUndefined()
  })

  it('flush resolves only once a slow in-flight report finishes sending', async () => {
    let resolveFetch: (() => void) | undefined
    const fetchStub: TelemetryFetch = async () => {
      await new Promise<void>((resolve) => { resolveFetch = resolve })
      return new Response(null, { status: 200 })
    }
    const reporter = new TelemetryReporter({ endpoints: ['https://a.example/events'], context: CONTEXT, fetch: fetchStub })

    void reporter.report({ event: 'app.launch' })

    let flushed = false
    const flush = reporter.flush().then(() => { flushed = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(flushed).toBe(false)

    resolveFetch?.()
    await flush
    expect(flushed).toBe(true)
  })

  it('flush resolves immediately when nothing is in flight', async () => {
    const reporter = new TelemetryReporter({
      endpoints: ['https://a.example/events'],
      context: CONTEXT,
      fetch: async () => new Response(null, { status: 200 }),
    })

    await expect(reporter.flush()).resolves.toBeUndefined()
  })
})
