/**
 * Select an existing machine-store test certificate without changing certificate trust.
 * @param environment - Local packaging environment.
 * @returns SHA-256 signing hook.
 */
export function createLocalWindowsSigner(environment: NodeJS.ProcessEnv):
  (configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>
