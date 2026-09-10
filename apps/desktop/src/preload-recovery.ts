/** Startup recovery exposes only fixed shell actions, never raw filesystem or IPC access. */
import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('paperMachineRecovery', {
  state: () => ipcRenderer.invoke('papermachine:recovery-state'),
  choose: () => ipcRenderer.invoke('papermachine:recovery-choose'),
  reset: () => ipcRenderer.invoke('papermachine:recovery-reset'),
  restart: () => ipcRenderer.invoke('papermachine:recovery-restart'),
  copy: () => ipcRenderer.invoke('papermachine:recovery-copy'),
  quit: () => ipcRenderer.invoke('papermachine:recovery-quit'),
})
