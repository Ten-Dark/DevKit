import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { Dirent } from 'fs'
import { isIgnored, parseGitignore, gitignoreMatcher } from '../renderer/utils/ignore'
import { getLanguage, getFence, renderTree } from '../renderer/utils/markdown'
import type { ProjectMarkdownOptions } from '../renderer/types'
import { mainWindow } from './window'
import {
  isPathAllowed,
  isUnderBase,
  addAllowedBaseDir,
  addAllowedOutputPath,
} from './security'

export const abortControllers = new Map<string, AbortController>()

export const BINARY_SCAN_BYTES = 8000
export const DEFAULT_MAX_FILE_SIZE_KB = 1024
export const MAX_TOTAL_OUTPUT_CHARS = 5_000_000

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

export function registerProjectMarkdownHandlers(): void {
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

          if (file.size > maxFileSizeBytes) {
            skippedCount++
            continue
          }

          const fullPath = path.join(resolvedDir, file.relativePath)
          if (!isUnderBase(fullPath, resolvedDir)) {
            skippedCount++
            continue
          }

          const content = await readFileContentRaw(fullPath)
          if (content === null) {
            skippedCount++
            continue
          }

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
}
