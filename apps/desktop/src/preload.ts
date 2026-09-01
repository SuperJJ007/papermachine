/** Narrow first-run bridge; it is exposed only to the packaged onboarding page. */

import { contextBridge, ipcRenderer } from 'electron'
import type { CondaCandidate } from './detection.ts'
import type { BindRequest } from './environment-binding.ts'
import type { ProvisioningProgress } from './provisioning.ts'

/** One environment onboarding can offer to install, as summarised for the renderer. */
export interface OfferedEnvironment {
  readonly id: string
  readonly name: string
  readonly revision: string
  readonly packages: readonly string[]
  readonly estimatedDownloadBytes: number
  readonly requiredFreeBytes: number
}

export interface DesktopOnboardingBridge {
  /** Read the loud status message queued for the next onboarding load, if any (an invalid binding found at launch), consuming it. */
  onboardingStatus(): Promise<string | undefined>
  /** Enumerate qualifying conda-family environments found on disk. */
  detect(): Promise<readonly CondaCandidate[]>
  /**
   * Bind the Python and/or R prefixes selected in onboarding's two groups
   * (each re-validated for the current TOCTOU) and open the workspace.
   */
  bind(request: BindRequest): Promise<void>
  /** The environments this build can install: the shipped one, plus the user's own package set once authored. */
  environments(): Promise<readonly OfferedEnvironment[]>
  /** Download and verify a shipped environment by id, then bind and open the workspace. */
  provision(id: string): Promise<void>
  /** Download and verify the given package set, then bind and open the workspace. */
  provisionCustom(packages: readonly string[]): Promise<void>
  /** Abort the in-flight provisioning run, if any. */
  cancelProvisioning(): Promise<void>
  /** Subscribe to provisioning progress for the lifetime of the page. */
  onProvisioningProgress(listener: (progress: ProvisioningProgress) => void): void
}

const bridge: DesktopOnboardingBridge = {
  onboardingStatus: async () => ipcRenderer.invoke('desktop:onboarding-status') as Promise<string | undefined>,
  detect: async () => ipcRenderer.invoke('desktop:detect') as Promise<readonly CondaCandidate[]>,
  bind: async request => ipcRenderer.invoke('desktop:bind', request) as Promise<void>,
  environments: async () => ipcRenderer.invoke('desktop:environments') as Promise<readonly OfferedEnvironment[]>,
  provision: async id => ipcRenderer.invoke('desktop:provision', id) as Promise<void>,
  provisionCustom: async packages => ipcRenderer.invoke('desktop:provision-custom', [...packages]) as Promise<void>,
  cancelProvisioning: async () => ipcRenderer.invoke('desktop:cancel-provisioning') as Promise<void>,
  onProvisioningProgress: (listener) => {
    ipcRenderer.on('desktop:provisioning-progress', (_event, progress: ProvisioningProgress) => { listener(progress) })
  },
}

contextBridge.exposeInMainWorld('desktopOnboarding', bridge)
