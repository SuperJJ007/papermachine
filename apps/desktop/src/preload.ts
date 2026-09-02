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
}

contextBridge.exposeInMainWorld('desktopOnboarding', bridge)
