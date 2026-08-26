import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { HostLifecycle, type SupervisorFactory } from '../src/host-lifecycle.ts'
import type { HostCommand, HostProcessSupervisor } from '../src/host-process.ts'

function fakeCommand(): HostCommand {
  return { executable: 'node', args: [], cwd: '.', env: {} }
}

/** A minimal `HostProcessSupervisor` fake with spyable `start`/`stop`. */
function fakeSupervisor(pid: number): { supervisor: HostProcessSupervisor; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(async () => {})
  const supervisor = {
    pid,
    start: vi.fn(async () => new URL('http://127.0.0.1:1')),
    stop,
  } as unknown as HostProcessSupervisor
  return { supervisor, stop }
}

function fakeWatchdog(): ChildProcess {
  const watchdog = new EventEmitter() as unknown as ChildProcess & { kill: (signal: string) => boolean }
  watchdog.kill = () => true
  return watchdog
}

describe('HostLifecycle', () => {
  it('stops the first supervisor before the second launch creates its replacement (close -> re-activate)', async () => {
    const first = fakeSupervisor(111)
    const second = fakeSupervisor(222)
    const order: string[] = []
    first.stop.mockImplementation(() => { order.push('first.stop') })
    const createSupervisor: SupervisorFactory = vi.fn()
      .mockImplementationOnce(() => { order.push('create first'); return first.supervisor })
      .mockImplementationOnce(() => { order.push('create second'); return second.supervisor })
    const lifecycle = new HostLifecycle({ graceMs: 50, spawnWatchdog: fakeWatchdog, createSupervisor })

    await lifecycle.launch(fakeCommand(), () => {})
    expect(lifecycle.supervisor).toBe(first.supervisor)

    await lifecycle.launch(fakeCommand(), () => {})
    expect(lifecycle.supervisor).toBe(second.supervisor)

    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['create first', 'first.stop', 'create second'])
  })

  it('stops the active watchdog before a replacement launch starts a new one', async () => {
    const first = fakeSupervisor(111)
    const second = fakeSupervisor(222)
    const watchdogs: ChildProcess[] = []
    const spawnWatchdog = vi.fn(() => {
      const watchdog = fakeWatchdog()
      watchdogs.push(watchdog)
      return watchdog
    })
    const createSupervisor: SupervisorFactory = vi.fn()
      .mockImplementationOnce(() => first.supervisor)
      .mockImplementationOnce(() => second.supervisor)
    const lifecycle = new HostLifecycle({ graceMs: 50, spawnWatchdog, createSupervisor })

    await lifecycle.launch(fakeCommand(), () => {})
    const firstWatchdog = watchdogs[0]!
    const kill = vi.spyOn(firstWatchdog, 'kill')

    await lifecycle.launch(fakeCommand(), () => {})
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    expect(watchdogs).toHaveLength(2)
  })

  it('never starts a watchdog for a Host that exits before readiness, and reports no unhandled rejection', async () => {
    const failure = new Error('desktop host: exited before readiness (1)')
    const supervisor = {
      pid: 111,
      start: vi.fn(async () => { throw failure }),
      stop: vi.fn(async () => {}),
    } as unknown as HostProcessSupervisor
    const spawnWatchdog = vi.fn(fakeWatchdog)
    const lifecycle = new HostLifecycle({
      graceMs: 50,
      spawnWatchdog,
      createSupervisor: () => supervisor,
    })

    const onUnhandledRejection = vi.fn()
    process.once('unhandledRejection', onUnhandledRejection)
    await expect(lifecycle.launch(fakeCommand(), () => {})).rejects.toBe(failure)
    // Let a microtask turn pass so a genuinely unhandled rejection would surface.
    await new Promise(resolve => setTimeout(resolve, 0))
    process.removeListener('unhandledRejection', onUnhandledRejection)

    expect(spawnWatchdog).not.toHaveBeenCalled()
    expect(onUnhandledRejection).not.toHaveBeenCalled()
  })

  it('throws without starting a watchdog when the Host reports no process id', async () => {
    const supervisor = {
      pid: undefined,
      start: vi.fn(async () => new Promise<URL>(() => {})),
      stop: vi.fn(async () => {}),
    } as unknown as HostProcessSupervisor
    const spawnWatchdog = vi.fn(fakeWatchdog)
    const lifecycle = new HostLifecycle({ graceMs: 50, spawnWatchdog, createSupervisor: () => supervisor })

    await expect(lifecycle.launch(fakeCommand(), () => {})).rejects.toThrow('desktop host: child has no process id')
    expect(spawnWatchdog).not.toHaveBeenCalled()
  })

  it('memoizes concurrent stop() calls: a second concurrent call resolves only once the underlying Host process is actually confirmed gone', async () => {
    // A real HostProcessSupervisor over a real child, rather than the
    // fakeSupervisor stub above: the defect this test pins is in the timing
    // between two concurrent stop() callers and the real supervisor.stop()
    // completion, which a stub that resolves on a microtask cannot exercise
    // (mirrors the real-process pattern in host-process.spec.ts).
    const lifecycle = new HostLifecycle({ graceMs: 1000, spawnWatchdog: fakeWatchdog })
    await lifecycle.launch({
      executable: process.execPath,
      // The 50ms delay before exit gives an unmemoized second stop() call —
      // which would see #supervisor already cleared by the first and resolve
      // on a bare microtask — a wide, non-flaky window to be observably
      // wrong in.
      args: ['--eval', "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 50)); console.log('dsh web: http://127.0.0.1:43123'); setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: { ...process.env },
    }, () => {})
    const pid = lifecycle.supervisor?.pid
    if (pid === undefined) throw new Error('fixture host missing pid')

    const first = lifecycle.stop()
    const second = lifecycle.stop()
    await second
    expect(() => process.kill(pid, 0)).toThrow()
    await first
  })
})
