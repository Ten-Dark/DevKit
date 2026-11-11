import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openDirectory: () => ipcRenderer.invoke('openDirectory'),
  readFile: (filePath: string) => ipcRenderer.invoke('readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('writeFile', filePath, content),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copyToClipboard', text),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('saveSettings', settings),
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url),
  walkDirectory: (dirPath: string) => ipcRenderer.invoke('walkDirectory', dirPath),
  readFileContent: (filePath: string) => ipcRenderer.invoke('readFileContent', filePath),
  generateProjectMarkdown: (dirPath: string, options: ProjectMarkdownOptions) =>
    ipcRenderer.invoke('generateProjectMarkdown', dirPath, options),
  selectOutputFile: () => ipcRenderer.invoke('selectOutputFile'),
  selectXMindFile: () => ipcRenderer.invoke('selectXMindFile'),
  convertXMindToMarkdown: (xmindPath: string) =>
    ipcRenderer.invoke('convertXMindToMarkdown', xmindPath),
  selectXMindOutputFile: () => ipcRenderer.invoke('selectXMindOutputFile'),
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
      walkDirectory: (dirPath: string) => Promise<{ relativePath: string; size: number }[]>
      readFileContent: (filePath: string) => Promise<string | null>
      generateProjectMarkdown: (
        dirPath: string,
        options: ProjectMarkdownOptions,
      ) => Promise<string>
      selectOutputFile: () => Promise<string | null>
      selectXMindFile: () => Promise<string | null>
      convertXMindToMarkdown: (xmindPath: string) => Promise<{
        markdown: string
        title: string
        topicCount: number
        depth: number
      }>
      selectXMindOutputFile: () => Promise<string | null>
    }
  }
}

interface ProjectMarkdownOptions {
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}
