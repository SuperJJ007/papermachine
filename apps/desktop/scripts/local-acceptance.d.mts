/**
 * Resolve local packaging and reject other platforms or production updates.
 * @param env - Packaging environment.
 * @param platform - Target operating system.
 * @returns Whether to build a local-only application.
 */
export function isLocalAcceptance(env?: NodeJS.ProcessEnv, platform?: string): boolean

/**
 * Ad-hoc sign a writable seed executable before its pnpm digest is recomputed.
 * @param path - Writable Mach-O copy.
 * @param identifier - Stable code identifier.
 * @returns Resolves after successful signing.
 */
export function signLocalSeedCode(path: string, identifier: string): Promise<void>

/**
 * Verify a local executable or application signature.
 * @param path - Seed executable or application bundle.
 */
export function verifyLocalCode(path: string): void
