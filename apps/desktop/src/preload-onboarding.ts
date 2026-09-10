/** Narrow bridge for the shell-owned environment page. */
import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('paperMachineSetup', {
  state: () => ipcRenderer.invoke('papermachine:setup-state'),
  install: (source: string, packages?: readonly string[]) => ipcRenderer.invoke('papermachine:setup-install', source, packages),
  cancel: () => ipcRenderer.invoke('papermachine:setup-cancel'),
  continue: () => ipcRenderer.invoke('papermachine:setup-continue'),
  resetHome: () => ipcRenderer.invoke('papermachine:setup-reset-home'),
  chooseHome: () => ipcRenderer.invoke('papermachine:setup-home'),
  progress: (listener: (message: string) => void) => {
    const handler = (_event: unknown, message: string): void => { listener(message) }
    ipcRenderer.on('papermachine:setup-progress', handler)
    return () => { ipcRenderer.removeListener('papermachine:setup-progress', handler) }
  },
})
