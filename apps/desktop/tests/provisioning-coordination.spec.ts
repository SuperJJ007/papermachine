import { describe, expect, it, vi } from 'vitest'
import { ProvisioningCoordinator, type ProvisioningCoordinatorEffects } from '../src/provisioning-coordination.ts'

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function fakeEffects(overrides: Partial<ProvisioningCoordinatorEffects> = {}): ProvisioningCoordinatorEffects {
  return {
    abort: vi.fn(),
    stopHost: vi.fn(async () => {}),
    openOnboarding: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('ProvisioningCoordinator', () => {
  it('change-discipline aborts an in-flight run, waits for it to unwind, stops the Host, then opens onboarding exactly once', async () => {
    const run = deferred()
    const effects = fakeEffects()
    const coordinator = new ProvisioningCoordinator(effects)
    void coordinator.trackRun(run.promise)

    const changeDiscipline = coordinator.changeDiscipline()
    await Promise.resolve()
    expect(effects.abort).toHaveBeenCalledTimes(1)
    expect(effects.openOnboarding).not.toHaveBeenCalled()

    run.resolve()
    await changeDiscipline
    expect(effects.stopHost).toHaveBeenCalledTimes(1)
    expect(effects.openOnboarding).toHaveBeenCalledTimes(1)
  })

  it('coalesces a double-click into one openOnboarding call rather than queuing a second', async () => {
    const onboarding = deferred()
    const effects = fakeEffects({ openOnboarding: vi.fn(() => onboarding.promise) })
    const coordinator = new ProvisioningCoordinator(effects)

    const first = coordinator.changeDiscipline()
    await Promise.resolve()
    const second = coordinator.changeDiscipline()

    onboarding.resolve()
    await Promise.all([first, second])
    expect(effects.abort).toHaveBeenCalledTimes(1)
    expect(effects.openOnboarding).toHaveBeenCalledTimes(1)
  })

  it('activate waits for an in-flight run to unwind before reopening', async () => {
    const run = deferred()
    const coordinator = new ProvisioningCoordinator(fakeEffects())
    void coordinator.trackRun(run.promise)
    const reopen = vi.fn(async () => {})

    const activate = coordinator.activate(reopen)
    await Promise.resolve()
    await Promise.resolve()
    expect(reopen).not.toHaveBeenCalled()

    run.resolve()
    await activate
    expect(reopen).toHaveBeenCalledTimes(1)
  })

  it('quitting blocks a subsequent workspace open', async () => {
    const coordinator = new ProvisioningCoordinator(fakeEffects())
    await coordinator.beforeQuit()

    const open = vi.fn(async () => {})
    await coordinator.openWorkspaceUnlessQuitting(open)
    expect(open).not.toHaveBeenCalled()
  })

  it('runs the workspace open when quit has not begun', async () => {
    const coordinator = new ProvisioningCoordinator(fakeEffects())
    const open = vi.fn(async () => {})
    await coordinator.openWorkspaceUnlessQuitting(open)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('before-quit aborts provisioning and stops the Host alongside awaiting the run', async () => {
    const run = deferred()
    const effects = fakeEffects()
    const coordinator = new ProvisioningCoordinator(effects)
    void coordinator.trackRun(run.promise)

    const beforeQuit = coordinator.beforeQuit()
    expect(coordinator.quitting).toBe(true)
    expect(effects.abort).toHaveBeenCalledTimes(1)

    run.resolve()
    await beforeQuit
    expect(effects.stopHost).toHaveBeenCalledTimes(1)
  })

  it('awaitRun resolves even when the tracked run rejects, without surfacing an unhandled rejection', async () => {
    const run = Promise.reject(new Error('desktop provisioning: cancelled'))
    const coordinator = new ProvisioningCoordinator(fakeEffects())
    const tracked = coordinator.trackRun(run)
    tracked.catch(() => {})

    await expect(coordinator.awaitRun()).resolves.toBeUndefined()
  })
})
