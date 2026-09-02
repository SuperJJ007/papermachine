/**
 * Coordinates decisions that race one in-flight `desktop:provision` run:
 * a "Change Environment…" request, `activate`, and app quit all need to
 * wait for the same run to unwind rather than acting while it is still
 * resolving.
 */

/** Effects the coordinator drives; injected so its decisions are testable without Electron. */
export interface ProvisioningCoordinatorEffects {
  /** Abort the in-flight provisioning run, if any; a no-op when none is running. */
  readonly abort: () => void
  /** Stop the active Host before an install can modify its bound prefix, or during app shutdown. */
  readonly stopHost: () => Promise<void>
  /** Open the onboarding window. */
  readonly openOnboarding: () => Promise<void>
}

/**
 * Serializes the decisions around one in-flight provisioning run. A run is
 * tracked by reference: only the caller (the `desktop:provision` IPC
 * handler) knows when one starts, but every other caller here only needs to
 * know when it has unwound.
 */
export class ProvisioningCoordinator {
  #run: Promise<void> | undefined
  #changingDiscipline = false
  #quitting = false

  constructor(private readonly effects: ProvisioningCoordinatorEffects) {}

  /** Set once {@link beforeQuit} begins; checked by every "unless quitting" guard and by {@link changeDiscipline}. */
  get quitting(): boolean {
    return this.#quitting
  }

  /**
   * Track one provisioning run's lifetime for {@link awaitRun}. Returns
   * `run` unchanged so the caller still observes its real resolution or
   * rejection; only the internally held reference is a never-rejecting
   * shadow, so a failed run does not turn every waiter's `awaitRun` into an
   * unhandled rejection.
   * @param run - the promise driving one `desktop:provision` call.
   * @returns `run`, unchanged.
   */
  trackRun(run: Promise<void>): Promise<void> {
    const tracked = run.then(() => undefined, () => undefined)
    this.#run = tracked
    void tracked.finally(() => { if (this.#run === tracked) this.#run = undefined })
    return run
  }

  /** Wait for any run this coordinator is tracking to unwind; resolves immediately when none is in flight. */
  async awaitRun(): Promise<void> {
    await this.#run
  }

  /**
   * Handle a "Change Environment…" request: abort any in-flight run, wait
   * for it to actually unwind, then open onboarding while the Host continues
   * serving the current environment. A second
   * call while the first is still unwinding is a no-op — onboarding opens
   * once, driven by the first call's own completion, rather than queuing a
   * second `openOnboarding`. Quit can begin at any of the two awaits below
   * (`awaitRun`'s wait is the same up-to-several-second unwind `beforeQuit`
   * itself awaits); this method re-checks {@link quitting} after each one
   * and bails silently rather than opening a window during or after teardown.
   */
  async changeDiscipline(): Promise<void> {
    if (this.#changingDiscipline) return
    this.#changingDiscipline = true
    try {
      this.effects.abort()
      await this.awaitRun()
      if (this.#quitting) return
      await this.openOnboardingUnlessQuitting(this.effects.openOnboarding)
    } finally {
      this.#changingDiscipline = false
    }
  }

  /**
   * Stop the Host only after onboarding has received explicit install
   * confirmation. The Host may still own kernels and files below the prefix
   * provisioning is about to replace, so the install cannot begin until
   * teardown completes.
   */
  async prepareProvisioning(): Promise<void> {
    if (this.#quitting) throw new Error('desktop provisioning: application is quitting')
    await this.effects.stopHost()
  }

  /**
   * Wait for any in-flight run to unwind, then run `reopen`. Without this
   * wait, a caller racing a just-cancelled run could act while a fresh
   * provisioning attempt would immediately collide with the old one.
   * @param reopen - decides whether and how to reopen the initial surface; not this coordinator's concern.
   */
  async activate(reopen: () => Promise<void>): Promise<void> {
    await this.awaitRun()
    await reopen()
  }

  /**
   * Begin app shutdown: mark quitting, abort provisioning, then stop the
   * Host and wait for the run to unwind concurrently — the whole call is a
   * single wait for two independent teardowns, so a slow one does not
   * postpone the other's request.
   */
  async beforeQuit(): Promise<void> {
    this.#quitting = true
    this.effects.abort()
    await Promise.allSettled([this.effects.stopHost(), this.awaitRun()])
  }

  /**
   * Bail silently once quit has begun instead of running `open`; shared by
   * every public "unless quitting" guard below so the one check lives in
   * one place.
   */
  async #unlessQuitting(open: () => Promise<void>): Promise<void> {
    if (this.#quitting) return
    await open()
  }

  /**
   * Run `open` unless quit has already begun. Guards the one race
   * `beforeQuit` cannot itself prevent: a provisioning run reaching its own
   * `openWorkspace` call after `beforeQuit`'s `hostLifecycle.stop()` has
   * already run, which would otherwise start a fresh Host behind it.
   * @param open - opens the workspace window and launches its Host.
   */
  async openWorkspaceUnlessQuitting(open: () => Promise<void>): Promise<void> {
    await this.#unlessQuitting(open)
  }

  /**
   * Run `open` unless quit has already begun. Guards the onboarding surface
   * the same way {@link openWorkspaceUnlessQuitting} guards the workspace
   * surface: `openInitialSurface` (reached from startup or `activate`) and
   * `changeDiscipline`'s own onboarding open both race `beforeQuit`, and
   * neither may create a window once teardown has started.
   * @param open - opens the onboarding window.
   */
  async openOnboardingUnlessQuitting(open: () => Promise<void>): Promise<void> {
    await this.#unlessQuitting(open)
  }
}
