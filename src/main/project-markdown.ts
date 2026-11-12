import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { Dirent } from 'fs'
import { isIgnored, parseGitignore, gitignoreMatcher } from '../shared/utils/ignore.js'
import { getLanguage, getFence, renderTree } from '../shared/utils/markdown.js'
import type { ProjectMarkdownOptions } from '../shared/types.js'
import { mainWindow } from './window.js'
import {
  isPathAllowed,
  isUnderBase,
  addAllowedBaseDir,
  addAllowedOutputPath,
  resolveRealPathUnderBase,
} from './security.js'
import { registerIpcHandler } from './ipc-registry.js'

export const abortControllers = new Map<string, AbortController>()

export const BINARY_SCAN_BYTES = 8000
export const DEFAULT_MAX_FILE_SIZE_KB = 1024
export const MAX_TOTAL_OUTPUT_CHARS = 5_000_000

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff])

function detectEncoding(buffer: Buffer): { encoding: string; content: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: 'utf-8', content: buffer.subarray(3).toString('utf-8') }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { encoding: 'utf-16le', content: buffer.subarray(2).toString('utf-16le') }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // UTF-16 BE: swap 16-bit words to convert to LE for Node.js Buffer.
    const swapped = Buffer.alloc(buffer.length - 2)
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1]
      swapped[i - 1] = buffer[i]
    }
    return { encoding: 'utf-16be', content: swapped.toString('utf16le') }
  }
  return { encoding: 'utf-8', content: buffer.toString('utf-8') }
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(BINARY_SCAN_BYTES)
    const { bytesRead } = await handle.read(buf, 0, BINARY_SCAN_BYTES, 0)

    // Files with a valid BOM are text, even if they contain null bytes (UTF-16).
    if (bytesRead >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      return false
    }
    if (bytesRead >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      return false
    }
    if (bytesRead >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      return false
    }

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
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return
  }
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (signal?.aborted) {
      return
    }
    if (isIgnored(entry.name)) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkDir(full, base, results, signal)
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

async function walkDirectoryRaw(
  dirPath: string,
  signal?: AbortSignal,
): Promise<{ relativePath: string; size: number }[]> {
  const results: { relativePath: string; size: number }[] = []
  await walkDir(dirPath, dirPath, results, signal)
  return results
}

async function readFileContentRaw(filePath: string): Promise<string | null> {
  if (await isBinaryFile(filePath)) {
    return null
  }
  const buffer = await fs.readFile(filePath)
  const { content } = detectEncoding(buffer)
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function registerProjectMarkdownHandlers(): void {
  registerIpcHandler('walkDirectory', async (_, dirPath: string) => {
    if (!isPathAllowed(dirPath)) {
      throw new Error('Access denied: path is not in an allowed directory')
    }
    let realDir: string
    try {
      realDir = await fs.realpath(dirPath).catch(() => path.resolve(dirPath))
    } catch {
      throw new Error('Directory not found: ' + dirPath)
    }
    const stat = await fs.stat(realDir).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      throw new Error('Path is not a directory: ' + dirPath)
    }
    const results: { relativePath: string; size: number }[] = []
    await walkDir(realDir, realDir, results)
    results.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    return results
  })

  registerIpcHandler('readFileContent', async (_, filePath: string) => {
    const realPath = await resolveRealPathUnderBase(filePath)
    if (await isBinaryFile(realPath)) {
      return null
    }
    const buffer = await fs.readFile(realPath)
    const { content } = detectEncoding(buffer)
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  })

  registerIpcHandler(
    'abortOperation',
    (_, operationId: string) => {
      const controller = abortControllers.get(operationId)
      if (!controller) {
        return { success: false }
      }
      controller.abort()
      abortControllers.delete(operationId)
      return { success: true }
    },
  )

  registerIpcHandler(
    'generateProjectMarkdown',
    async (
      event,
      dirPath: string,
      options: ProjectMarkdownOptions,
      operationId?: string,
    ) => {
      const resolvedDir = path.resolve(dirPath)

      // Validate directory exists and is a directory (C4)
      let realDir: string
      try {
        realDir = await fs.realpath(resolvedDir)
      } catch {
        throw new Error('Directory not found: ' + resolvedDir)
      }
      const stat = await fs.stat(realDir).catch(() => null)
      if (!stat || !stat.isDirectory()) {
        throw new Error('Path is not a directory: ' + resolvedDir)
      }

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
        let files = await walkDirectoryRaw(realDir, controller?.signal)
        assertNotAborted()

        if (respectGitignore) {
          try {
            const gitignorePath = path.join(realDir, '.gitignore')
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
        let truncated = false

        for (const file of files) {
          assertNotAborted()
          processed += 1
          event.sender.send('project-markdown-progress', {
            operationId: operationId!,
            processed,
            total,
          })

          if (file.size > maxFileSizeBytes) {
            skippedCount++
            continue
          }

          const fullPath = path.join(realDir, file.relativePath)
          if (!isUnderBase(fullPath, realDir)) {
            skippedCount++
            continue
          }

          let content: string | null
          try {
            content = await readFileContentRaw(fullPath)
          } catch {
            skippedCount++
            continue
          }
          if (content === null) {
            skippedCount++
            continue
          }

          if (totalChars + content.length > MAX_TOTAL_OUTPUT_CHARS) {
            truncated = true
            break
          }
          totalChars += content.length

          included.push({ ...file, content })
        }

        included.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

        const projectName = path.basename(realDir) || 'Project'
        const lines: string[] = []

        lines.push(`# ${projectName}`)
        lines.push('')
        lines.push(`Generated from \`${realDir}\``)
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

        if (truncated) {
          lines.push('## Notice')
          lines.push('')
          lines.push(
            `Output was truncated at ${MAX_TOTAL_OUTPUT_CHARS} characters. Some files were omitted.`,
          )
          lines.push('')
        }

        return {
          markdown: lines.join('\n'),
          stats: { fileCount: included.length, skippedCount, totalChars, truncated },
        }
      } finally {
        if (controller) {
          abortControllers.delete(operationId!)
        }
      }
    },
  )

  registerIpcHandler('selectOutputFile', async () => {
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
}
