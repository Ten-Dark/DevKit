import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppSettings, ProjectDirectoryScan, ProjectMarkdownOptions, ProjectMarkdownResult, UpdaterActionResult, UpdaterInfo } from '../shared/types'

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
  walkDirectory: (dirPath: string, options?: { respectGitignore?: boolean }) => ipcRenderer.invoke('walkDirectory', dirPath, options),
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
  convertXMindToMarkdown: (xmindPath: string, operationId: string) =>
    ipcRenderer.invoke('convertXMindToMarkdown', xmindPath, operationId),
  cancelXMindConversion: (operationId: string) =>
    ipcRenderer.invoke('cancelXMindConversion', operationId),
  onXMindConversionProgress: (callback: (payload: { operationId: string; phase: 'extracting' | 'converting'; stage?: 'sheets' | 'parsing' | 'rendering'; processed: number; total: number; processedEntries: number; totalEntries: number }) => void) => {
    const handler = (_event: IpcRendererEvent, payload: { operationId: string; phase: 'extracting' | 'converting'; stage?: 'sheets' | 'parsing' | 'rendering'; processed: number; total: number; processedEntries: number; totalEntries: number }) => callback(payload)
    ipcRenderer.on('xmind-conversion-progress', handler)
    return () => ipcRenderer.removeListener('xmind-conversion-progress', handler)
  },
  selectXMindOutputFile: () => ipcRenderer.invoke('selectXMindOutputFile'),
  updater: {
    getInfo: () => ipcRenderer.invoke('updater:getInfo'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: (): Promise<UpdaterActionResult> => ipcRenderer.invoke('updater:download'),
    cancelDownload: (): Promise<UpdaterActionResult> => ipcRenderer.invoke('updater:cancelDownload'),
    install: (): Promise<UpdaterActionResult> => ipcRenderer.invoke('updater:install'),
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
      walkDirectory: (dirPath: string, options?: { respectGitignore?: boolean }) => Promise<ProjectDirectoryScan>
      readFileContent: (filePath: string) => Promise<string | null>
      generateProjectMarkdown: (
        dirPath: string,
        options: ProjectMarkdownOptions,
        operationId?: string,
      ) => Promise<ProjectMarkdownResult>
      selectOutputFile: () => Promise<string | null>
      selectXMindFile: () => Promise<string | null>
      convertXMindToMarkdown: (xmindPath: string, operationId: string) => Promise<{
        markdown: string
        title: string
        topicCount: number
        depth: number
        sheetsCount?: number
        warnings?: string[]
        hyperlinkCount?: number
        markerCount?: number
      }>
      cancelXMindConversion: (operationId: string) => Promise<{ success: boolean }>
      onXMindConversionProgress: (callback: (payload: { operationId: string; phase: 'extracting' | 'converting'; stage?: 'sheets' | 'parsing' | 'rendering'; processed: number; total: number; processedEntries: number; totalEntries: number }) => void) => () => void
      selectXMindOutputFile: () => Promise<string | null>
      abortOperation: (operationId: string) => Promise<{ success: boolean }>
      onProjectMarkdownProgress: (
        callback: (payload: { operationId: string; processed: number; total: number }) => void,
      ) => () => void
      updater: {
        getInfo: () => Promise<UpdaterInfo>
        check: () => Promise<UpdaterInfo>
        download: () => Promise<UpdaterActionResult>
        cancelDownload: () => Promise<UpdaterActionResult>
        install: () => Promise<UpdaterActionResult>
        onStatusChange: (callback: (payload: UpdaterInfo) => void) => () => void
      }
    }
  }
}

