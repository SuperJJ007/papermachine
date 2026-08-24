/** Narrow first-run bridge; it is exposed only to the packaged onboarding page. */

import { contextBridge, ipcRenderer } from 'electron'
import type { CondaCandidate } from './detection.ts'
import type { BindRequest } from './environment-binding.ts'

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
}

const bridge: DesktopOnboardingBridge = {
  onboardingStatus: async () => ipcRenderer.invoke('desktop:onboarding-status') as Promise<string | undefined>,
  detect: async () => ipcRenderer.invoke('desktop:detect') as Promise<readonly CondaCandidate[]>,
  bind: async request => ipcRenderer.invoke('desktop:bind', request) as Promise<void>,
}

contextBridge.exposeInMainWorld('desktopOnboarding', bridge)
