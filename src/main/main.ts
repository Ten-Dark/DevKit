import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import type { Dirent } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { isIgnored, parseGitignore, gitignoreMatcher } from '../renderer/utils/ignore'
import { getLanguage, getFence, renderTree } from '../renderer/utils/markdown'
import { parseTopic, buildMarkdown } from '../renderer/utils/xmind'

let mainWindow: BrowserWindow | null = null

// Maps operation id -> AbortController for cancellable long-running tasks.
const abortControllers = new Map<string, AbortController>()

// Directories/paths that the user has explicitly selected via dialogs.
// Used to confine direct IPC file access to user-chosen locations only.
const allowedBaseDirs = new Set<string>()
const allowedOutputPaths = new Set<string>()

function addAllowedBaseDir(dirPath: string): void {
  allowedBaseDirs.add(path.resolve(dirPath))
}

function addAllowedOutputPath(filePath: string): void {
  allowedOutputPaths.add(path.resolve(filePath))
}

function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  if (allowedOutputPaths.has(resolved)) {
    return true
  }
  for (const base of allowedBaseDirs) {
    if (isUnderBase(resolved, base)) {
      return true
    }
  }
  return false
}

// ------------------------------------------------------------------- settings -----

const SETTINGS_FILE_NAME = 'settings.json'

function getSettingsPath(): string {
  // Use the user data directory so settings survive between installs and
  // are stored per-user, per-machine.
  const userData = app.getPath('userData')
  return path.join(userData, SETTINGS_FILE_NAME)
}

interface AppSettings {
  favorites: string[]
  recents: string[]
  theme: 'dark'
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  favorites: [],
  recents: [],
  theme: 'dark',
  maxFileSizeKB: 1024,
  includeTree: true,
  respectGitignore: true,
}

function deepCloneSettings(s: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(s))
}

async function readSettingsFile(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
    return deepCloneSettings(DEFAULT_SETTINGS)
  } catch {
    return deepCloneSettings(DEFAULT_SETTINGS)
  }
}

async function writeSettingsFile(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath()
  const tmpPath = settingsPath + '.tmp'
  const data = JSON.stringify(settings, null, 2)
  // Atomic write: write to temp file then rename.
  await fs.writeFile(tmpPath, data, 'utf-8')
  await fs.rename(tmpPath, settingsPath)
}

ipcMain.handle('getSettings', async () => {
  return await readSettingsFile()
})

ipcMain.handle(
  'saveSettings',
  async (_, settings: Partial<AppSettings>) => {
    const current = await readSettingsFile()
    const merged: AppSettings = { ...current, ...settings }
    await writeSettingsFile(merged)
    return { success: true }
  },
)

ipcMain.handle(
  'resetSettings',
  async () => {
    await writeSettingsFile(deepCloneSettings(DEFAULT_SETTINGS))
    return { success: true }
  },
)

ipcMain.handle('getAppVersion', async () => {
  return app.getVersion()
})

// ------------------------------------------------------------------- window -----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ---------------------------------------------------------------- security helpers -----

const execFileAsync = promisify(execFile)

function escapePsSingleQuoted(s: string): string {
  return s.replace(/'/g, "''")
}

function isUnderBase(targetPath: string, basePath: string): boolean {
  const relative = path.relative(basePath, targetPath)
  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

function validatePathWithinBase(filePath: string, basePath: string): void {
  const resolvedTarget = path.resolve(filePath)
  const resolvedBase = path.resolve(basePath)
  if (!isUnderBase(resolvedTarget, resolvedBase)) {
    throw new Error('Access denied: path is outside the allowed directory')
  }
}

// ---------------------------------------------------------------- XMind to Markdown -----

async function extractXMindToTemp(xmindPath: string): Promise<string> {
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'xmind-md-'))
  const command = `Expand-Archive -LiteralPath '${escapePsSingleQuoted(xmindPath)}' -DestinationPath '${escapePsSingleQuoted(dest)}' -Force`
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { maxBuffer: 50 * 1024 * 1024 },
    )
  } catch (err) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {})
    throw new Error(
      `Failed to extract .xmind archive (corrupted or unsupported zip): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return dest
}

async function findContentJson(dir: string): Promise<string | null> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findContentJson(full)
      if (found) return found
    } else if (entry.name === 'content.json') {
      return full
    }
  }
  return null
}


ipcMain.handle('selectXMindFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select XMind File',
    filters: [{ name: 'XMind', extensions: ['xmind'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) {
    return null
  }
  return result.filePaths[0]
})

ipcMain.handle('convertXMindToMarkdown', async (_, xmindPath: string) => {
  let tempDir: string | null = null
  try {
    tempDir = await extractXMindToTemp(xmindPath)
    const contentPath = await findContentJson(tempDir)
    if (!contentPath) {
      throw new Error(
        'content.json not found in .xmind archive (missing or corrupted archive)',
      )
    }
    const raw = await fs.readFile(contentPath, 'utf-8')
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error('content.json is not valid JSON')
    }

    let sheetsCount = 1
    const warnings: string[] = []
    let sheet: unknown
    if (Array.isArray(data)) {
      sheetsCount = data.length
      if (sheetsCount > 1) {
        warnings.push(
          `Multiple sheets detected (${sheetsCount}), only the first sheet was converted.`,
        )
      }
      sheet = data[0]
    } else {
      sheet = data
    }
    if (
      !sheet ||
      typeof sheet !== 'object' ||
      !(sheet as { rootTopic?: unknown }).rootTopic
    ) {
      throw new Error('rootTopic not found in content.json')
    }
    const root = parseTopic((sheet as { rootTopic: unknown }).rootTopic)
    const title = root.title || path.basename(xmindPath, '.xmind') || 'XMind'
    const { markdown, topicCount, depth, hyperlinkCount, markerCount } =
      buildMarkdown(root)
    return {
      markdown,
      title,
      topicCount,
      depth,
      sheetsCount,
      warnings,
      hyperlinkCount,
      markerCount,
    }
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : 'Failed to convert XMind file to Markdown',
    )
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
})

ipcMain.handle('selectXMindOutputFile', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Markdown File',
    defaultPath: 'xmind.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (result.canceled || !result.filePath) {
    return null
  }
  addAllowedOutputPath(result.filePath)
  return result.filePath
})

// ---------------------------------------------------------------- Project to Markdown -----

const BINARY_SCAN_BYTES = 8000
const DEFAULT_MAX_FILE_SIZE_KB = 1024
// Hard cap on total output size to prevent runaway markdown generation.
const MAX_TOTAL_OUTPUT_CHARS = 5_000_000

async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(BINARY_SCAN_BYTES)
    const { bytesRead } = await handle.read(buf, 0, BINARY_SCAN_BYTES, 0)
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0x00) {
        return true
      }
    }
    return false
  } finally {
    await handle.close()
  }
}

async function walkDir(
  dir: string,
  base: string,
  results: { relativePath: string; size: number }[],
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (isIgnored(entry.name)) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkDir(full, base, results)
    } else if (entry.isFile()) {
      if (await isBinaryFile(full)) {
        continue
      }
      try {
        const stat = await fs.stat(full)
        results.push({
          relativePath: path.relative(base, full).split(path.sep).join('/'),
          size: stat.size,
        })
      } catch {
        // skip files that cannot be stat'ed
      }
    }
  }
}

interface ProjectMarkdownOptions {
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}

async function walkDirectoryRaw(dirPath: string): Promise<{ relativePath: string; size: number }[]> {
  const results: { relativePath: string; size: number }[] = []
  await walkDir(dirPath, dirPath, results)
  return results
}

async function readFileContentRaw(filePath: string): Promise<string | null> {
  if (await isBinaryFile(filePath)) {
    return null
  }
  const content = await fs.readFile(filePath, 'utf-8')
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

ipcMain.handle('openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  for (const p of result.filePaths) {
    addAllowedBaseDir(p)
  }
  return result.filePaths
})

ipcMain.handle('readFile', async (_, filePath: string) => {
  if (!isPathAllowed(filePath)) {
    throw new Error('Access denied: path is not in an allowed directory')
  }
  const content = await fs.readFile(filePath, 'utf-8')
  return content
})

ipcMain.handle('writeFile', async (_, filePath: string, content: string) => {
  if (!isPathAllowed(filePath)) {
    throw new Error('Access denied: path is not in an allowed directory')
  }
  await fs.writeFile(filePath, content, 'utf-8')
  return { success: true }
})

ipcMain.handle('copyToClipboard', async (_, text: string) => {
  clipboard.writeText(text)
  return { success: true }
})

ipcMain.handle('openExternal', async (_, url: string) => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Access denied: only http:// and https:// URLs are allowed')
    }
  } catch {
    throw new Error('Access denied: invalid URL')
  }
  await shell.openExternal(url)
  return { success: true }
})

ipcMain.handle('walkDirectory', async (_, dirPath: string) => {
  if (!isPathAllowed(dirPath)) {
    throw new Error('Access denied: path is not in an allowed directory')
  }
  const results: { relativePath: string; size: number }[] = []
  await walkDir(dirPath, dirPath, results)
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return results
})

ipcMain.handle('readFileContent', async (_, filePath: string) => {
  if (!isPathAllowed(filePath)) {
    throw new Error('Access denied: path is not in an allowed directory')
  }
  if (await isBinaryFile(filePath)) {
    return null
  }
  const content = await fs.readFile(filePath, 'utf-8')
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
})

ipcMain.handle(
  'abortOperation',
  (_, operationId: string) => {
    const controller = abortControllers.get(operationId)
    if (controller) {
      controller.abort()
      abortControllers.delete(operationId)
    }
    return { success: true }
  },
)

ipcMain.handle(
  'generateProjectMarkdown',
  async (
    event,
    dirPath: string,
    options: ProjectMarkdownOptions,
    operationId?: string,
  ) => {
    const resolvedDir = path.resolve(dirPath)
    const maxFileSizeBytes = (options?.maxFileSizeKB ?? DEFAULT_MAX_FILE_SIZE_KB) * 1024
    const includeTree = options?.includeTree ?? true
    const respectGitignore = options?.respectGitignore ?? false

    let controller: AbortController | undefined
    if (operationId) {
      controller = new AbortController()
      abortControllers.set(operationId, controller)
    }
    const assertNotAborted = () => {
      if (controller?.signal.aborted) {
        throw new Error('Operation aborted')
      }
    }

    try {
      let files = await walkDirectoryRaw(resolvedDir)
      assertNotAborted()

      if (respectGitignore) {
        try {
          const gitignorePath = path.join(resolvedDir, '.gitignore')
          const content = await fs.readFile(gitignorePath, 'utf-8')
          const patterns = parseGitignore(content)
          const shouldIgnore = gitignoreMatcher(patterns)
          files = files.filter((f) => !shouldIgnore(f.relativePath))
        } catch {
          // no .gitignore present; proceed with all walked files
        }
      }
      assertNotAborted()

      const total = files.length
      let processed = 0
      const included: { relativePath: string; size: number; content: string }[] = []
      let totalChars = 0
      let skippedCount = 0

      for (const file of files) {
        assertNotAborted()
        processed += 1
        event.sender.send('project-markdown-progress', {
          operationId: operationId!,
          processed,
          total,
        })

        // Enforce per-file size limit
        if (file.size > maxFileSizeBytes) {
          skippedCount++
          continue
        }

        const fullPath = path.join(resolvedDir, file.relativePath)
        // Safety: never read outside the selected directory.
        if (!isUnderBase(fullPath, resolvedDir)) {
          skippedCount++
          continue
        }

        const content = await readFileContentRaw(fullPath)
        if (content === null) {
          skippedCount++
          continue
        }

        // Enforce total output size cap.
        if (totalChars + content.length > MAX_TOTAL_OUTPUT_CHARS) {
          break
        }
        totalChars += content.length

        included.push({ ...file, content })
      }

      included.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

      const projectName = path.basename(resolvedDir) || 'Project'
      const lines: string[] = []

      lines.push(`# ${projectName}`)
      lines.push('')
      lines.push(`Generated from \`${resolvedDir}\``)
      lines.push('')

      if (includeTree) {
        lines.push('## Structure')
        lines.push('')
        lines.push('```text')
        lines.push(renderTree(included.map((f) => f.relativePath)))
        lines.push('```')
        lines.push('')
        lines.push('---')
        lines.push('')
      }

      lines.push('## Files')
      lines.push('')

      for (const file of included) {
        assertNotAborted()
        const lang = getLanguage(file.relativePath)
        const fence = getFence(file.content)
        lines.push(`## ${file.relativePath}`)
        lines.push('')
        lines.push(`${fence}${lang}`)
        lines.push(file.content.trimEnd())
        lines.push(fence)
        lines.push('')
      }

      return {
        markdown: lines.join('\n'),
        stats: { fileCount: included.length, skippedCount, totalChars },
      }
    } finally {
      if (controller) {
        abortControllers.delete(operationId!)
      }
    }
  },
)

ipcMain.handle('selectOutputFile', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Project Markdown',
    defaultPath: 'project.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (result.canceled || !result.filePath) {
    return null
  }
  addAllowedOutputPath(result.filePath)
  return result.filePath
})
