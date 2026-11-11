import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import type { Dirent } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
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

ipcMain.handle('openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  return result.filePaths
})

ipcMain.handle('readFile', async (_, filePath: string) => {
  const content = await fs.readFile(filePath, 'utf-8')
  return content
})

ipcMain.handle('writeFile', async (_, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf-8')
  return { success: true }
})

ipcMain.handle('copyToClipboard', async (_, text: string) => {
  clipboard.writeText(text)
  return { success: true }
})

ipcMain.handle('getSettings', async () => {
  return {}
})

ipcMain.handle('saveSettings', async (_, settings: Record<string, unknown>) => {
  return { success: true }
})

ipcMain.handle('openExternal', async (_, url: string) => {
  await shell.openExternal(url)
  return { success: true }
})

// --------------------------------------------------------------- XMind to Markdown -----

const execFileAsync = promisify(execFile)

function escapePsSingleQuoted(s: string): string {
  return s.replace(/'/g, "''")
}

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
      `Failed to extract .xmind archive: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return dest
}

async function findContentJson(dir: string): Promise<string | null> {
  let entries: import('fs').Dirent[]
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

interface XMindTopic {
  title: string
  notes: string
  children: XMindTopic[]
}

function jsonNotes(topic: unknown): string {
  const notes = (topic as { notes?: unknown } | null)?.notes
  if (!notes) return ''
  if (typeof notes === 'string') return notes
  if (notes && typeof notes === 'object') {
    const plain = (notes as { plain?: unknown }).plain
    if (plain && typeof plain === 'object') {
      const content = (plain as { content?: unknown }).content
      return typeof content === 'string' ? content : ''
    }
    if (typeof plain === 'string') return plain
  }
  return ''
}

function parseTopic(topic: unknown): XMindTopic {
  const t = topic as { title?: unknown; children?: unknown } | null
  return {
    title: typeof t?.title === 'string' ? t.title : '',
    notes: jsonNotes(t),
    children: Array.isArray(t?.children)
      ? (t.children as unknown[]).map(parseTopic)
      : [],
  }
}

function buildMarkdown(root: XMindTopic): { markdown: string; topicCount: number; depth: number } {
  const lines: string[] = [`# ${root.title || 'Root'}`]
  let topicCount = 0
  let maxDepth = 0

  function walk(node: XMindTopic, depth: number) {
    topicCount += 1
    if (depth > maxDepth) maxDepth = depth
    if (depth > 0) {
      const indent = '  '.repeat(depth)
      lines.push(`${indent}- ${node.title || ''}`)
      if (node.notes) {
        lines.push(`${'  '.repeat(depth + 1)}> ${node.notes}`)
      }
    }
    for (const child of node.children) {
      walk(child, depth + 1)
    }
  }

  for (const child of root.children) {
    walk(child, 1)
  }

  return { markdown: lines.join('\n') + '\n', topicCount, depth: maxDepth }
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
      throw new Error('content.json not found in .xmind archive')
    }
    const raw = await fs.readFile(contentPath, 'utf-8')
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error('content.json is not valid JSON')
    }
    const sheet = Array.isArray(data) ? data[0] : data
    if (!sheet || typeof sheet !== 'object' || !(sheet as { rootTopic?: unknown }).rootTopic) {
      throw new Error('rootTopic not found in content.json')
    }
    const root = parseTopic((sheet as { rootTopic: unknown }).rootTopic)
    const title = root.title || path.basename(xmindPath, '.xmind') || 'XMind'
    const { markdown, topicCount, depth } = buildMarkdown(root)
    return { markdown, title, topicCount, depth }
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
  return result.filePath
})

// --------------------------------------------------------------- Project to Markdown -----

const BINARY_SCAN_BYTES = 8000
const DEFAULT_MAX_FILE_SIZE_KB = 1024

const DEFAULT_IGNORE_PATTERNS = [
  // dependencies & build output
  'node_modules', 'bower_components', 'vendor', '.pnpm-store',
  'dist', 'build', 'out', '.next', '.nuxt', '.output', 'target', 'bin', 'obj',
  '.gradle', '.terraform',
  // caches
  '.cache', '.parcel-cache', '.turbo', 'coverage', '.nyc_output',
  '__pycache__', '.pytest_cache', '.mypy_cache',
  // vcs & editors
  '.git', '.svn', '.hg', '.vs', '.vscode', '.idea',
  // python envs
  '.venv', 'venv', 'env',
  // secrets & local env
  '.env', '.env.*',
  // lockfiles
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock', '*.lock',
  // minified / generated
  '*.min.js', '*.min.css', '*.map',
  // binaries & media
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.bmp', '*.svg', '*.pdf',
  '*.zip', '*.gz', '*.7z', '*.rar', '*.exe', '*.dll', '*.bin',
  '*.woff', '*.woff2', '*.ttf', '*.eot', '*.mp3', '*.mp4', '*.mov',
  '*.psd', '*.sqlite', '*.db', 'thumbs.db', '.DS_Store'
]

const LANG_MAP: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'jsx',
  '.ts': 'typescript', '.tsx': 'tsx', '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.json': 'json', '.jsonc': 'jsonc', '.xml': 'xml', '.svg': 'xml',
  '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.ini': 'ini', '.cfg': 'ini',
  '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.csv': 'csv',
  '.sql': 'sql', '.py': 'python', '.rb': 'ruby', '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin', '.go': 'go', '.rs': 'rust',
  '.php': 'php', '.cs': 'csharp', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.c': 'c', '.h': 'c', '.hpp': 'cpp', '.swift': 'swift', '.m': 'objectivec',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
  '.ps1': 'powershell', '.psm1': 'powershell', '.psd1': 'powershell',
  '.bat': 'bat', '.cmd': 'bat', '.dockerfile': 'dockerfile',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro', '.lua': 'lua',
  '.graphql': 'graphql', '.gql': 'graphql', '.r': 'r', '.dart': 'dart',
  '.ex': 'elixir', '.exs': 'elixir', '.clj': 'clojure', '.hs': 'haskell',
  '.tf': 'hcl', '.proto': 'protobuf', '.gradle': 'groovy', '.groovy': 'groovy'
}

const NAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile', makefile: 'makefile', '.gitignore': 'gitignore',
  '.gitattributes': 'gitattributes', '.env': 'bash', '.editorconfig': 'ini',
  '.npmrc': 'ini', '.prettierrc': 'json', '.eslintrc': 'json', '.babelrc': 'json'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function makeMatcher(pattern: string): RegExp {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') {
      re += '.*'
    } else if (ch === '?') {
      re += '.'
    } else {
      re += escapeRegExp(ch)
    }
  }
  return new RegExp(`^${re}$`, 'i')
}

const IGNORE_MATCHERS = DEFAULT_IGNORE_PATTERNS.map(makeMatcher)

function isIgnored(name: string): boolean {
  return IGNORE_MATCHERS.some((matcher) => matcher.test(name))
}

function parseGitignore(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function gitignoreMatcher(patterns: string[]) {
  const matchers = patterns.map((p) => {
    const negated = p.startsWith('!')
    const pattern = negated ? p.slice(1) : p
    return { negated, matcher: makeMatcher(pattern) }
  })
  return (relPath: string) => {
    const parts = relPath.split('/')
    let ignored = false
    for (const { negated, matcher } of matchers) {
      const matches = matcher.test(relPath) || parts.some((part) => matcher.test(part))
      if (matches) {
        ignored = !negated
      } else if (negated) {
        ignored = false
      }
    }
    return ignored
  }
}

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

function getLanguage(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext && LANG_MAP[ext]) {
    return LANG_MAP[ext]
  }
  const low = name.toLowerCase()
  if (NAME_MAP[low]) {
    return NAME_MAP[low]
  }
  return ''
}

function getFence(text: string): string {
  let max = 0
  let run = 0
  for (const ch of text) {
    if (ch === '`') {
      run += 1
      if (run > max) {
        max = run
      }
    } else {
      run = 0
    }
  }
  return '`'.repeat(Math.max(3, max + 1))
}

interface TreeNode {
  dirs: Record<string, TreeNode>
  files: string[]
}

function renderTree(relativePaths: string[]): string {
  const root: TreeNode = { dirs: {}, files: [] }

  for (const rel of [...relativePaths].sort()) {
    const parts = rel.split('/')
    let node: TreeNode = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      if (isLast) {
        if (!node.files.includes(part)) {
          node.files.push(part)
        }
      } else {
        if (!node.dirs[part]) {
          node.dirs[part] = { dirs: {}, files: [] }
        }
        node = node.dirs[part]
      }
    }
  }

  const lines: string[] = []

  function renderNode(node: TreeNode, prefix: string) {
    const dirs = Object.keys(node.dirs).sort()
    const files = node.files.slice().sort()
    const entries: { kind: 'dir' | 'file'; name: string }[] = [
      ...dirs.map((name) => ({ kind: 'dir' as const, name })),
      ...files.map((name) => ({ kind: 'file' as const, name })),
    ]
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const isLast = i === entries.length - 1
      const connector = isLast ? '└── ' : '├── '
      lines.push(`${prefix}${connector}${entry.name}`)
      if (entry.kind === 'dir') {
        const extension = isLast ? '    ' : '│   '
        renderNode(node.dirs[entry.name], prefix + extension)
      }
    }
  }

  renderNode(root, '')
  return lines.join('\n')
}

ipcMain.handle('walkDirectory', async (_, dirPath: string) => {
  const results: { relativePath: string; size: number }[] = []
  await walkDir(dirPath, dirPath, results)
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return results
})

ipcMain.handle('readFileContent', async (_, filePath: string) => {
  if (await isBinaryFile(filePath)) {
    return null
  }
  const content = await fs.readFile(filePath, 'utf-8')
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
})

ipcMain.handle('generateProjectMarkdown', async (_, dirPath: string, options: ProjectMarkdownOptions) => {
  const maxFileSizeBytes = (options?.maxFileSizeKB ?? DEFAULT_MAX_FILE_SIZE_KB) * 1024
  const includeTree = options?.includeTree ?? true
  const respectGitignore = options?.respectGitignore ?? false
  let files = await walkDirectoryRaw(dirPath)

  if (respectGitignore) {
    try {
      const gitignorePath = path.join(dirPath, '.gitignore')
      const content = await fs.readFile(gitignorePath, 'utf-8')
      const patterns = parseGitignore(content)
      const shouldIgnore = gitignoreMatcher(patterns)
      files = files.filter((f) => !shouldIgnore(f.relativePath))
    } catch {
      // no .gitignore present; proceed with all walked files
    }
  }

  const included: { relativePath: string; size: number; content: string }[] = []

  for (const file of files) {
    if (file.size > maxFileSizeBytes) {
      continue
    }
    const content = await readFileContentRaw(path.join(dirPath, file.relativePath))
    if (content === null) {
      continue
    }
    included.push({ ...file, content })
  }

  included.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  const projectName = path.basename(dirPath) || 'Project'
  const lines: string[] = []

  lines.push(`# ${projectName}`)
  lines.push('')
  lines.push(`Generated from \`${dirPath}\``)
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
    const lang = getLanguage(file.relativePath)
    const fence = getFence(file.content)
    lines.push(`## ${file.relativePath}`)
    lines.push('')
    lines.push(`${fence}${lang}`)
    lines.push(file.content.trimEnd())
    lines.push(fence)
    lines.push('')
  }

  return lines.join('\n')
})

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

ipcMain.handle('selectOutputFile', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Project Markdown',
    defaultPath: 'project.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (result.canceled || !result.filePath) {
    return null
  }
  return result.filePath
})

interface ProjectMarkdownOptions {
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}
