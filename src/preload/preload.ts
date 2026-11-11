import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openDirectory: () => ipcRenderer.invoke('openDirectory'),
  readFile: (filePath: string) => ipcRenderer.invoke('readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('writeFile', filePath, content),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copyToClipboard', text),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('saveSettings', settings),
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url)
})

declare global {
  interface Window {
    api: {
      openDirectory: () => Promise<string[]>
      readFile: (filePath: string) => Promise<string>
      writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>
      copyToClipboard: (text: string) => Promise<{ success: boolean }>
      getSettings: () => Promise<Record<string, unknown>>
      saveSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>
      openExternal: (url: string) => Promise<{ success: boolean }>
    }
  }
}
