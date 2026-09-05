/** Narrow first-run bridge; it is exposed only to the packaged onboarding page. */

import { contextBridge, ipcRenderer } from 'electron'
import type { ProvisioningProgress } from './provisioning.ts'

/** One package source onboarding can offer, as summarised for the renderer. */
export interface OfferedSource {
  readonly id: string
  readonly name: string
}

/** One environment onboarding can offer to install, as summarised for the renderer. */
export interface OfferedEnvironment {
  readonly id: string
  readonly name: string
  readonly revision: string
  readonly packages: readonly string[]
  readonly estimatedDownloadBytes: number
  readonly requiredFreeBytes: number
  /** Package sources, in fallback order, this environment can be provisioned from. */
  readonly sources: readonly OfferedSource[]
  /** The source id the confirmation panel preselects, decided from system locale settings. */
  readonly defaultSourceId: string
}

/** The environment pointer already applied on this machine, if any. */
export interface CurrentEnvironment {
  readonly id: string
  readonly revision: string
  readonly status: 'applied' | 'stale'
  readonly prefix: string
}

/** The Harness home this launch resolved, and whether an install-location pointer file set it. */
export interface InstallLocation {
  readonly path: string
  readonly customized: boolean
}

/**
 * The outcome of a `chooseInstallLocation()` call: `cancelled` covers both
 * the directory picker being dismissed and the user declining a non-ASCII
 * warning; `rejected` names why the chosen directory cannot be a Harness
 * home (for example {@link HarnessHomeSpaceError}'s message); `restarting`
 * means the pointer file was written and the application is relaunching.
 */
export type ChooseInstallLocationResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'restarting' }

/** The application is relaunching to apply a just-written or just-cleared install-location pointer. */
export interface RestartingResult {
  readonly status: 'restarting'
}

/** Diagnostic facts for the failed-install report: version, platform, and where the Harness home actually is. */
export interface DesktopDiagnostics {
  readonly appVersion: string
  readonly platform: string
  readonly harnessHome: string
  readonly installLocationCustomized: boolean
}

export interface DesktopOnboardingBridge {
  /** Read the loud status message queued for the next onboarding load, if any (an invalid binding found at launch), consuming it. */
  onboardingStatus(): Promise<string | undefined>
  /** The environments this build can install: the shipped one, plus the user's own package set once authored. */
  environments(): Promise<readonly OfferedEnvironment[]>
  /** The applied environment shown at the top of onboarding, if one exists. */
  currentEnvironment(): Promise<CurrentEnvironment | undefined>
  /** Leave onboarding and relaunch the workspace against the current environment. */
  keepCurrentEnvironment(): Promise<void>
  /**
   * Download and verify a shipped environment by id, then bind and open the
   * workspace. `sourceId` is tried first; on failure the environment's
   * remaining sources are tried in their declared order.
   */
  provision(id: string, sourceId: string): Promise<void>
  /**
   * Download and verify the given package set, then bind and open the
   * workspace, with the same ordered-fallback source behavior as
   * {@link provision}.
   */
  provisionCustom(packages: readonly string[], sourceId: string): Promise<void>
  /** Abort the in-flight provisioning run, if any. */
  cancelProvisioning(): Promise<void>
  /** Subscribe to provisioning progress for the lifetime of the page. */
  onProvisioningProgress(listener: (progress: ProvisioningProgress) => void): void
  /** The currently resolved Harness home and whether an install-location pointer file set it. */
  installLocation(): Promise<InstallLocation>
  /**
   * Open a directory picker for a new install location; validates the
   * choice, warns on a non-ASCII path, and relaunches the application on
   * acceptance.
   */
  chooseInstallLocation(): Promise<ChooseInstallLocationResult>
  /** Clear the install-location pointer and relaunch the application against the default Harness home. */
  resetInstallLocation(): Promise<RestartingResult>
  /** Diagnostic facts for the failed-install report. */
  diagnostics(): Promise<DesktopDiagnostics>
}

const bridge: DesktopOnboardingBridge = {
  onboardingStatus: async () => ipcRenderer.invoke('desktop:onboarding-status') as Promise<string | undefined>,
  environments: async () => ipcRenderer.invoke('desktop:environments') as Promise<readonly OfferedEnvironment[]>,
  currentEnvironment: async () => ipcRenderer.invoke('desktop:current-environment') as Promise<CurrentEnvironment | undefined>,
  keepCurrentEnvironment: async () => ipcRenderer.invoke('desktop:keep-current-environment') as Promise<void>,
  provision: async (id, sourceId) => ipcRenderer.invoke('desktop:provision', id, sourceId) as Promise<void>,
  provisionCustom: async (packages, sourceId) => ipcRenderer.invoke('desktop:provision-custom', [...packages], sourceId) as Promise<void>,
  cancelProvisioning: async () => ipcRenderer.invoke('desktop:cancel-provisioning') as Promise<void>,
  onProvisioningProgress: (listener) => {
    ipcRenderer.on('desktop:provisioning-progress', (_event, progress: ProvisioningProgress) => { listener(progress) })
  },
  installLocation: async () => ipcRenderer.invoke('desktop:install-location') as Promise<InstallLocation>,
  chooseInstallLocation: async () => ipcRenderer.invoke('desktop:choose-install-location') as Promise<ChooseInstallLocationResult>,
  resetInstallLocation: async () => ipcRenderer.invoke('desktop:reset-install-location') as Promise<RestartingResult>,
  diagnostics: async () => ipcRenderer.invoke('desktop:diagnostics') as Promise<DesktopDiagnostics>,
}

contextBridge.exposeInMainWorld('desktopOnboarding', bridge)
