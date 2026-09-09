/** Require native Windows generation of NSIS uninstallers. */

/**
 * Electron Builder artifactBuildStarted hook.
 * @param event - the artifact target selected by Electron Builder.
 * @returns nothing when this host can build the selected installer.
 */
export default function assertNativeInstaller(event: { targetPresentableName: string }): void

/**
 * Reject NSIS cross-compilation before the uninstaller generator runs.
 * @param target - Electron Builder's target name.
 * @param hostPlatform - the operating system running Electron Builder.
 * @returns nothing when the target does not require a different build host.
 */
export function assertNativeInstallerTarget(target: string, hostPlatform: NodeJS.Platform): void
