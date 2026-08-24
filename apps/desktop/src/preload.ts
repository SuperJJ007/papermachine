/** Narrow first-run bridge; it is exposed only to the packaged onboarding page. */

import { contextBridge, ipcRenderer } from 'electron'
import type { ProvisioningProgress } from './provisioning.ts'

export interface DesktopEnvironmentChoice {
  readonly id: string
  readonly name: string
  readonly revision: string
  readonly estimatedDownloadBytes: number
  readonly requiredFreeBytes: number
}

export interface DesktopOnboardingBridge {
  environments(): Promise<readonly DesktopEnvironmentChoice[]>
  provision(id: string): Promise<void>
  cancel(): Promise<void>
  onProgress(listener: (progress: ProvisioningProgress) => void): () => void
}

const bridge: DesktopOnboardingBridge = {
  environments: async () => ipcRenderer.invoke('desktop:environments') as Promise<readonly DesktopEnvironmentChoice[]>,
  provision: async id => ipcRenderer.invoke('desktop:provision', id) as Promise<void>,
  cancel: async () => ipcRenderer.invoke('desktop:cancel-provisioning') as Promise<void>,
  onProgress: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, progress: ProvisioningProgress): void => { listener(progress) }
    ipcRenderer.on('desktop:provisioning-progress', handle)
    return () => { ipcRenderer.removeListener('desktop:provisioning-progress', handle) }
  },
}

contextBridge.exposeInMainWorld('desktopOnboarding', bridge)
