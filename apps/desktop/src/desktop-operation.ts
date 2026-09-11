/** Serial ownership of package installation, environment provisioning, and shutdown. */
export class DesktopOperation {
  #active: Promise<unknown> | undefined
  #control: AbortController | undefined
  #quitting = false

  /** Whether an installation or package transaction owns the desktop. */
  get busy(): boolean { return this.#active !== undefined }

  /** Reject overlapping work and hold ownership until every child has stopped.
   * @param action - Operation receiving the shutdown cancellation signal.
   * @returns The operation result.
   */
  run<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#quitting) return Promise.reject(new Error('desktop: application is quitting'))
    if (this.busy) return Promise.reject(new Error('desktop: another operation is running'))
    const control = new AbortController()
    this.#control = control
    const run = Promise.resolve().then(() => action(control.signal))
    const tracked = run.finally(() => {
      if (this.#active === tracked) {
        this.#active = undefined
        this.#control = undefined
      }
    })
    this.#active = tracked
    return tracked
  }

  /** Cancel the current operation; callers wait through shutdown for quiescence. */
  cancel(): void { this.#control?.abort() }

  /** Refuse new work, cancel provisioning, and wait for the current transaction. */
  async shutdown(): Promise<void> {
    this.#quitting = true
    this.cancel()
    await this.#active?.catch(() => undefined)
  }
}
