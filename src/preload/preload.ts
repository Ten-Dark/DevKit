import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppSettings, ProjectMarkdownOptions, ProjectMarkdownStats, UpdaterInfo } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  openDirectory: () => ipcRenderer.invoke('openDirectory'),
  readFile: (filePath: string) => ipcRenderer.invoke('readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('writeFile', filePath, content),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copyToClipboard', text),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('saveSettings', settings),
  resetSettings: () => ipcRenderer.invoke('resetSettings'),
  getAppVersion: () => ipcRenderer.invoke('getAppVersion'),
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url),
  walkDirectory: (dirPath: string) => ipcRenderer.invoke('walkDirectory', dirPath),
  readFileContent: (filePath: string) => ipcRenderer.invoke('readFileContent', filePath),
  generateProjectMarkdown: (
    dirPath: string,
    options: ProjectMarkdownOptions,
    operationId?: string,
  ) =>
    ipcRenderer.invoke('generateProjectMarkdown', dirPath, options, operationId),
  abortOperation: (operationId: string) => ipcRenderer.invoke('abortOperation', operationId),
  onProjectMarkdownProgress: (
    callback: (payload: { operationId: string; processed: number; total: number }) => void,
  ) => {
    const handler = (_event: IpcRendererEvent, payload: { operationId: string; processed: number; total: number }) => {
      callback(payload)
    }
    ipcRenderer.on('project-markdown-progress', handler)
    return () => ipcRenderer.removeListener('project-markdown-progress', handler)
  },
  selectOutputFile: () => ipcRenderer.invoke('selectOutputFile'),
  selectXMindFile: () => ipcRenderer.invoke('selectXMindFile'),
  convertXMindToMarkdown: (xmindPath: string) =>
    ipcRenderer.invoke('convertXMindToMarkdown', xmindPath),
  selectXMindOutputFile: () => ipcRenderer.invoke('selectXMindOutputFile'),
  updater: {
    getInfo: () => ipcRenderer.invoke('updater:getInfo'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatusChange: (callback: (payload: UpdaterInfo) => void) => {
      const handler = (_event: IpcRendererEvent, payload: UpdaterInfo) => {
        callback(payload)
      }
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    },
  },
})

declare global {
  interface Window {
    api: {
      openDirectory: () => Promise<string[]>
      readFile: (filePath: string) => Promise<string>
      writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>
      copyToClipboard: (text: string) => Promise<{ success: boolean }>
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>
      resetSettings: () => Promise<{ success: boolean }>
      getAppVersion: () => Promise<string>
      openExternal: (url: string) => Promise<{ success: boolean }>
      walkDirectory: (dirPath: string) => Promise<{ relativePath: string; size: number }[]>
      readFileContent: (filePath: string) => Promise<string | null>
      generateProjectMarkdown: (
        dirPath: string,
        options: ProjectMarkdownOptions,
        operationId?: string,
      ) => Promise<{ markdown: string; stats: ProjectMarkdownStats }>
      selectOutputFile: () => Promise<string | null>
      selectXMindFile: () => Promise<string | null>
      convertXMindToMarkdown: (xmindPath: string) => Promise<{
        markdown: string
        title: string
        topicCount: number
        depth: number
        sheetsCount?: number
        warnings?: string[]
        hyperlinkCount?: number
        markerCount?: number
      }>
      selectXMindOutputFile: () => Promise<string | null>
      abortOperation: (operationId: string) => Promise<{ success: boolean }>
      onProjectMarkdownProgress: (
        callback: (payload: { operationId: string; processed: number; total: number }) => void,
      ) => () => void
      updater: {
        getInfo: () => Promise<UpdaterInfo>
        check: () => Promise<UpdaterInfo>
        download: () => Promise<{ success: boolean }>
        install: () => Promise<{ success: boolean }>
        onStatusChange: (callback: (payload: UpdaterInfo) => void) => () => void
      }
    }
  }
}

