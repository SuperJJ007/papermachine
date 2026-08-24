/** Owns the single active Host process tree and its watchdog across repeated window launches. */

import type { ChildProcess } from 'node:child_process'
import { HostProcessSupervisor, type HostCommand, type HostExit, type HostProcessSupervisorOptions } from './host-process.ts'

/** Constructs one Host supervisor; overridable so tests can inject a fake. */
export type SupervisorFactory = (command: HostCommand, options: HostProcessSupervisorOptions) => HostProcessSupervisor

/** Spawns the watchdog child that collects the Host process tree if Electron itself dies. */
export type WatchdogSpawn = (hostPid: number) => ChildProcess

/** Options for one {@link HostLifecycle}. */
export interface HostLifecycleOptions {
  /** Milliseconds the Host supervisor allows for cooperative shutdown before escalating to SIGKILL. */
  readonly graceMs: number
  /** Spawns the watchdog child for a ready Host pid. */
  readonly spawnWatchdog: WatchdogSpawn
  /** Constructs the Host supervisor; defaults to `HostProcessSupervisor`'s own constructor. */
  readonly createSupervisor?: SupervisorFactory
}

/**
 * On darwin, closing the last window does not quit the app, and `activate`
 * launches a fresh Host: without a single owner across those launches, the
 * previous Host process tree and watchdog leak with nobody stopping them.
 * Every {@link launch} therefore stops whatever it previously started first.
 */
export class HostLifecycle {
  #supervisor: HostProcessSupervisor | undefined
  #watchdog: ChildProcess | undefined
  readonly #graceMs: number
  readonly #spawnWatchdog: WatchdogSpawn
  readonly #createSupervisor: SupervisorFactory

  constructor(options: HostLifecycleOptions) {
    this.#graceMs = options.graceMs
    this.#spawnWatchdog = options.spawnWatchdog
    this.#createSupervisor = options.createSupervisor
      ?? ((command, supervisorOptions) => new HostProcessSupervisor(command, supervisorOptions))
  }

  /** The active Host supervisor, set for the duration of and after a successful {@link launch}. */
  get supervisor(): HostProcessSupervisor | undefined {
    return this.#supervisor
  }

  #stopWatchdog(): void {
    this.#watchdog?.kill('SIGTERM')
    this.#watchdog = undefined
  }

  /** Stop the currently active Host and its watchdog, if any. */
  async stop(): Promise<void> {
    this.#stopWatchdog()
    const supervisor = this.#supervisor
    this.#supervisor = undefined
    await supervisor?.stop()
  }

  /**
   * Stop any prior Host, then launch a fresh one and resolve once ready. The
   * watchdog starts only after readiness, so a Host that exits before
   * becoming ready never leaves an orphaned watchdog child.
   * @param command - complete Host launch specification.
   * @param onUnexpectedExit - called only when a ready Host terminates unexpectedly; the watchdog is stopped first.
   * @returns the private loopback URL the ready Host reported.
   */
  async launch(command: HostCommand, onUnexpectedExit: (exit: HostExit) => void): Promise<URL> {
    await this.stop()
    const supervisor = this.#createSupervisor(command, {
      graceMs: this.#graceMs,
      onUnexpectedExit: (exit) => {
        this.#stopWatchdog()
        onUnexpectedExit(exit)
      },
    })
    this.#supervisor = supervisor
    const ready = supervisor.start()
    // Attached synchronously so a rejection on the hostPid-undefined path
    // below is never reported as an unhandled rejection; the `await ready`
    // reached on every other path still propagates the same rejection.
    ready.catch(() => {})
    const hostPid = supervisor.pid
    if (hostPid === undefined) throw new Error('desktop host: child has no process id')
    const url = await ready
    this.#watchdog = this.#spawnWatchdog(hostPid)
    return url
  }
}
