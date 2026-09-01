/**
 * Minimal usage telemetry: three metadata-only events (`app.launch`,
 * `environment.installed`, `environment.install-failed`), dual-written
 * independently to every configured endpoint, fire-and-forget. See
 * `README.md`'s "Usage telemetry" section for the product contract.
 */

import { randomUUID } from 'node:crypto'

/** Platform/arch vocabulary this application ships for; matches `DesktopPlatform` in `environment-declaration.ts`. */
export type TelemetryPlatform = 'darwin'
export type TelemetryArch = 'arm64' | 'x64'

/** Fields identical across every event, filled in by {@link TelemetryReporter.report}. */
interface TelemetryEnvelope {
  readonly eventId: string
  readonly anonymousId: string
  readonly timestamp: string
  readonly appVersion: string
  readonly platform: TelemetryPlatform
  readonly arch: TelemetryArch
  readonly schemaVersion: 1
}

/**
 * The event-specific fields a caller supplies to {@link TelemetryReporter.report}.
 * A closed union: content is never included, only metadata about a launch or
 * a provisioning run's outcome.
 */
export type TelemetryEventInput =
  | { readonly event: 'app.launch' }
  | {
    readonly event: 'environment.installed'
    /** The package source that succeeded (`tuna`/`ustc`/`official`, or a custom declaration's chosen source id). */
    readonly sourceId: string
    readonly durationMs: number
    readonly environmentId: 'general' | 'custom'
  }
  | {
    readonly event: 'environment.install-failed'
    /** The package source that was being tried when the run failed or was cancelled. */
    readonly sourceId: string
    /** The last `ProvisioningProgress.phase` (`provisioning.ts`) observed before failure. */
    readonly phase: string
    readonly cancelled: boolean
  }

/** One complete telemetry event as sent over the wire. */
export type TelemetryEvent = TelemetryEnvelope & TelemetryEventInput

/** The envelope fields constant for the lifetime of one desktop process. */
export interface TelemetryReporterContext {
  readonly anonymousId: string
  readonly appVersion: string
  readonly platform: TelemetryPlatform
  readonly arch: TelemetryArch
}

/** A `fetch`-shaped function, injected so the reporter is unit-testable without network. */
export type TelemetryFetch = (input: string, init: RequestInit) => Promise<Response>

export interface TelemetryReporterOptions {
  /** Every receiver to dual-write to; an empty array means telemetry is off and `report` is a no-op. */
  readonly endpoints: readonly string[]
  readonly context: TelemetryReporterContext
  /** Defaults to the global `fetch`. */
  readonly fetch?: TelemetryFetch
  /** Clock for `timestamp` and `eventId` generation ordering; defaults to `Date.now`. */
  readonly now?: () => number
  /** `eventId` generator; defaults to `crypto.randomUUID`. */
  readonly randomUUID?: () => string
  /** Per-endpoint request timeout; defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS}. */
  readonly requestTimeoutMs?: number
}

/** Short enough that a hanging receiver never meaningfully delays process shutdown, long enough for a slow mobile network. */
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

/**
 * Resolve which endpoints an event should actually be sent to: none, when
 * `DSH_TELEMETRY_DISABLED` is set to any non-empty value — the same
 * interpretation `resolveTelemetryPatch` (`apps/cli/src/profile-boot.ts`)
 * applies to the Host's own telemetry switch, so one environment variable
 * turns off both. Otherwise every endpoint from the parsed
 * `telemetry.json`, unchanged.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param configuredEndpoints - the endpoints from `telemetry.json`.
 * @returns the endpoints {@link TelemetryReporter} should dual-write to.
 */
export function resolveTelemetryEndpoints(
  disabledEnv: string | undefined,
  configuredEndpoints: readonly string[],
): readonly string[] {
  return (disabledEnv ?? '') === '' ? configuredEndpoints : []
}

/**
 * Sends each event to every configured endpoint independently: no failover,
 * no stop-at-first-success, no retry queue. A receiver a given user cannot
 * reach loses only that user's events for the events they were offline or
 * blocked for — accepted for this version rather than adding an offline
 * buffer (see the Agent Note this package's README section links).
 */
export class TelemetryReporter {
  readonly #endpoints: readonly string[]
  readonly #context: TelemetryReporterContext
  readonly #fetch: TelemetryFetch
  readonly #now: () => number
  readonly #randomUUID: () => string
  readonly #requestTimeoutMs: number

  constructor(options: TelemetryReporterOptions) {
    this.#endpoints = options.endpoints
    this.#context = options.context
    this.#fetch = options.fetch ?? fetch
    this.#now = options.now ?? Date.now
    this.#randomUUID = options.randomUUID ?? randomUUID
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  /**
   * Report one event. Every endpoint is sent to independently and every
   * per-endpoint failure (network error, non-2xx response, timeout) is
   * swallowed silently — this method never rejects and never delays a
   * caller who does not await it. Callers in `main.ts` deliberately do not
   * await this (`void telemetry.report(...)`), matching the product
   * requirement that telemetry never block or surface an error to the user.
   * @param input - the event-specific fields; envelope fields are filled in here.
   */
  async report(input: TelemetryEventInput): Promise<void> {
    if (this.#endpoints.length === 0) return
    const event: TelemetryEvent = {
      eventId: this.#randomUUID(),
      anonymousId: this.#context.anonymousId,
      timestamp: new Date(this.#now()).toISOString(),
      appVersion: this.#context.appVersion,
      platform: this.#context.platform,
      arch: this.#context.arch,
      schemaVersion: 1,
      ...input,
    }
    const body = JSON.stringify(event)
    await Promise.allSettled(this.#endpoints.map(async endpoint => this.#send(endpoint, body)))
  }

  async #send(endpoint: string, body: string): Promise<void> {
    try {
      await this.#fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      })
    } catch {
      // Swallowed: an unreachable, slow, or erroring receiver must never
      // surface to the caller. A user offline at launch is simply not
      // counted that day — no retry queue or offline buffer in this version.
    }
  }
}
