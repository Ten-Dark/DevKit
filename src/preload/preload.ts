import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import type { AppSettings, ProjectDirectoryScan, ProjectMarkdownOptions, ProjectMarkdownResult, UpdaterActionResult, UpdaterInfo } from '../shared/types'
import type { ServiceDefinition, ServiceRuntimeSnapshot } from '../main/core/contracts'
import type { DependencyPlan } from '../main/core/dependency-engine'
import type { RuntimeServiceDetails, RuntimeServiceItem, RuntimeStartResult } from '../main/core/runtime-core'
import type { McpConnectionInput, McpConnectionSummary, McpRegistryPage, McpRegistryServer } from '../shared/mcp'
import type { LocalIntegrationId, LocalIntegrationStatus } from '../main/integrations/local-integrations'
import type { StorageEntryMetadata, StorageListing, StorageSearchResult, StorageSourceSummary } from '../shared/storage.js'

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
  mcp: {
    listConnections: (): Promise<McpConnectionSummary[]> => ipcRenderer.invoke('mcp:listConnections'),
    searchRegistry: (query: string, cursor?: string): Promise<McpRegistryPage> => ipcRenderer.invoke('mcp:searchRegistry', query, cursor),
    getRegistryServer: (name: string, version?: string): Promise<McpRegistryServer> => ipcRenderer.invoke('mcp:getRegistryServer', name, version),
    addConnection: (input: McpConnectionInput): Promise<McpConnectionSummary> => ipcRenderer.invoke('mcp:addConnection', input),
    connect: (id: string): Promise<McpConnectionSummary | null> => ipcRenderer.invoke('mcp:connect', id),
    disconnect: (id: string): Promise<McpConnectionSummary> => ipcRenderer.invoke('mcp:disconnect', id),
    removeConnection: (id: string): Promise<boolean> => ipcRenderer.invoke('mcp:removeConnection', id),
    selectWorkingDirectory: (): Promise<string | null> => ipcRenderer.invoke('mcp:selectWorkingDirectory'),
  },
  integrations: {
    getStatuses: (): Promise<{ projectsRoot: string; integrations: LocalIntegrationStatus[] }> => ipcRenderer.invoke('integrations:getStatuses'),
    setProjectsRoot: (directory: string): Promise<string> => ipcRenderer.invoke('integrations:setProjectsRoot', directory),
    selectProjectsRoot: (): Promise<string | null> => ipcRenderer.invoke('integrations:selectProjectsRoot'),
    start: (id: LocalIntegrationId): Promise<LocalIntegrationStatus> => ipcRenderer.invoke('integrations:start', id),
    stop: (id: LocalIntegrationId): Promise<LocalIntegrationStatus> => ipcRenderer.invoke('integrations:stop', id),
  },
  storage: {
    getStatus: (): Promise<StorageSourceSummary | null> => ipcRenderer.invoke('storage:getStatus'),
    selectAndConnect: (): Promise<StorageSourceSummary | null> => ipcRenderer.invoke('storage:selectAndConnect'),
    disconnect: (): Promise<boolean> => ipcRenderer.invoke('storage:disconnect'),
    list: (relativePath?: string, limit?: number): Promise<StorageListing> => ipcRenderer.invoke('storage:list', relativePath, limit),
    search: (query: string, limit?: number): Promise<StorageSearchResult> => ipcRenderer.invoke('storage:search', query, limit),
    getMetadata: (relativePath: string): Promise<StorageEntryMetadata> => ipcRenderer.invoke('storage:getMetadata', relativePath),
  },
  runtime: {
    selectExecutable: (): Promise<string | null> => ipcRenderer.invoke('runtime:selectExecutable'),
    selectWorkingDirectory: (): Promise<string | null> => ipcRenderer.invoke('runtime:selectWorkingDirectory'),
    listServices: (): Promise<RuntimeServiceItem[]> => ipcRenderer.invoke('runtime:listServices'),
    getServiceDetails: (serviceId: string): Promise<RuntimeServiceDetails> =>
      ipcRenderer.invoke('runtime:getServiceDetails', serviceId),
    getStartPlan: (serviceId: string): Promise<DependencyPlan> =>
      ipcRenderer.invoke('runtime:getStartPlan', serviceId),
    registerService: (definition: ServiceDefinition): Promise<ServiceDefinition> =>
      ipcRenderer.invoke('runtime:registerService', definition),
    executeStartPlan: (serviceId: string, approvedServiceIds: string[]): Promise<RuntimeStartResult> =>
      ipcRenderer.invoke('runtime:executeStartPlan', serviceId, approvedServiceIds),
    stopService: (serviceId: string): Promise<ServiceRuntimeSnapshot> =>
      ipcRenderer.invoke('runtime:stopService', serviceId),
    restartService: (serviceId: string): Promise<ServiceRuntimeSnapshot> =>
      ipcRenderer.invoke('runtime:restartService', serviceId),
    acknowledgeUnobservableStopped: (serviceId: string): Promise<ServiceRuntimeSnapshot> =>
      ipcRenderer.invoke('runtime:acknowledgeUnobservableStopped', serviceId, true),
    unregisterService: (serviceId: string): Promise<boolean> =>
      ipcRenderer.invoke('runtime:unregisterService', serviceId),
    getRecentEvents: (limit = 100): Promise<string[]> =>
      ipcRenderer.invoke('runtime:getRecentEvents', limit),
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
      mcp: {
        listConnections: () => Promise<McpConnectionSummary[]>
        searchRegistry: (query: string, cursor?: string) => Promise<McpRegistryPage>
        getRegistryServer: (name: string, version?: string) => Promise<McpRegistryServer>
        addConnection: (input: McpConnectionInput) => Promise<McpConnectionSummary>
        connect: (id: string) => Promise<McpConnectionSummary | null>
        disconnect: (id: string) => Promise<McpConnectionSummary>
        removeConnection: (id: string) => Promise<boolean>
        selectWorkingDirectory: () => Promise<string | null>
      }
      integrations: {
        getStatuses: () => Promise<{ projectsRoot: string; integrations: LocalIntegrationStatus[] }>
        setProjectsRoot: (directory: string) => Promise<string>
        selectProjectsRoot: () => Promise<string | null>
        start: (id: LocalIntegrationId) => Promise<LocalIntegrationStatus>
        stop: (id: LocalIntegrationId) => Promise<LocalIntegrationStatus>
      }
      storage: {
        getStatus: () => Promise<StorageSourceSummary | null>
        selectAndConnect: () => Promise<StorageSourceSummary | null>
        disconnect: () => Promise<boolean>
        list: (relativePath?: string, limit?: number) => Promise<StorageListing>
        search: (query: string, limit?: number) => Promise<StorageSearchResult>
        getMetadata: (relativePath: string) => Promise<StorageEntryMetadata>
      }
      runtime: {
        selectExecutable: () => Promise<string | null>
        selectWorkingDirectory: () => Promise<string | null>
        listServices: () => Promise<RuntimeServiceItem[]>
        getServiceDetails: (serviceId: string) => Promise<RuntimeServiceDetails>
        getStartPlan: (serviceId: string) => Promise<DependencyPlan>
        registerService: (definition: ServiceDefinition) => Promise<ServiceDefinition>
        executeStartPlan: (serviceId: string, approvedServiceIds: string[]) => Promise<RuntimeStartResult>
        stopService: (serviceId: string) => Promise<ServiceRuntimeSnapshot>
        restartService: (serviceId: string) => Promise<ServiceRuntimeSnapshot>
        acknowledgeUnobservableStopped: (serviceId: string) => Promise<ServiceRuntimeSnapshot>
        unregisterService: (serviceId: string) => Promise<boolean>
        getRecentEvents: (limit?: number) => Promise<string[]>
      }
    }
  }
}

