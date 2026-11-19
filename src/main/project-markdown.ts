import { dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { Dirent } from 'fs'
import { isIgnored, createGitignoreRuleSet, isGitignored, type GitignoreRuleSet } from '../shared/utils/ignore.js'
import {
  createProjectMarkdownDocumentPlan,
  finalizeProjectMarkdownDocument,
  getProjectMarkdownFileSectionLength,
  getProjectMarkdownLimitReason,
  getProjectMarkdownTreeCandidates,
  MAX_TOTAL_OUTPUT_CHARS,
} from '../shared/utils/project-markdown-policy.js'
import type { ProjectMarkdownIssue, ProjectMarkdownOptions } from '../shared/types.js'
import { mainWindow } from './window.js'
import {
  isPathAllowed,
  isUnderBase,
  addAllowedOutputPath,
  resolveRealPathUnderBase,
} from './security.js'
import { registerIpcHandler } from './ipc-registry.js'

export const abortControllers = new Map<string, AbortController>()

export const BINARY_SCAN_BYTES = 8000
export const DEFAULT_MAX_FILE_SIZE_KB = 1024

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
  issues: ProjectMarkdownIssue[],
  signal: AbortSignal | undefined,
  respectGitignore: boolean,
  inheritedRules: GitignoreRuleSet[],
): Promise<void> {
  if (signal?.aborted) return
  const activeRules = [...inheritedRules]
  let gitignoreReadFailed = false

  if (respectGitignore) {
    try {
      const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')
      activeRules.push(createGitignoreRuleSet(dir, content))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        gitignoreReadFailed = true
        const relativePath = path.relative(base, path.join(dir, '.gitignore')).split(path.sep).join('/')
        issues.push({ relativePath, reason: 'gitignore-read-error', kind: 'file' })
      }
    }
  }

  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    const relativePath = path.relative(base, dir).split(path.sep).join('/') || '.'
    issues.push({ relativePath, reason: 'directory-read-error', kind: 'directory' })
    return
  }

  for (const entry of entries) {
    if (signal?.aborted) return
    const full = path.join(dir, entry.name)
    const relativePath = path.relative(base, full).split(path.sep).join('/')
    if (isIgnored(entry.name)) {
      issues.push({ relativePath, reason: 'internal-ignore', kind: entry.isDirectory() ? 'directory' : 'file' })
      continue
    }
    if (entry.isSymbolicLink()) {
      issues.push({ relativePath, reason: 'symlink', kind: 'file' })
      continue
    }
    if (entry.isDirectory()) {
      if (respectGitignore && isGitignored(full, true, activeRules)) {
        issues.push({ relativePath, reason: 'gitignore', kind: 'directory' })
        continue
      }
      await walkDir(full, base, results, issues, signal, respectGitignore, activeRules)
      continue
    }
    if (entry.isFile()) {
      if (gitignoreReadFailed && entry.name === '.gitignore') continue
      if (respectGitignore && isGitignored(full, false, activeRules)) {
        issues.push({ relativePath, reason: 'gitignore', kind: 'file' })
        continue
      }
      try {
        if (await isBinaryFile(full)) {
          issues.push({ relativePath, reason: 'binary', kind: 'file' })
          continue
        }
        const stat = await fs.stat(full)
        results.push({ relativePath, size: stat.size })
      } catch {
        issues.push({ relativePath, reason: 'read-error', kind: 'file' })
      }
      continue
    }
    issues.push({ relativePath, reason: 'unsupported-entry', kind: 'file' })
  }
}

async function walkDirectoryRaw(
  dirPath: string,
  options: { signal?: AbortSignal; respectGitignore?: boolean } = {},
): Promise<{ rootPath: string; files: { relativePath: string; size: number }[]; issues: ProjectMarkdownIssue[] }> {
  const files: { relativePath: string; size: number }[] = []
  const issues: ProjectMarkdownIssue[] = []
  await walkDir(dirPath, dirPath, files, issues, options.signal, options.respectGitignore ?? false, [])
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return { rootPath: dirPath, files, issues }
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
  registerIpcHandler('walkDirectory', async (_, dirPath: string, options?: { respectGitignore?: boolean }) => {
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
    return walkDirectoryRaw(realDir, { respectGitignore: options?.respectGitignore ?? false })
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
        const scan = await walkDirectoryRaw(realDir, { signal: controller?.signal, respectGitignore })
        assertNotAborted()
        const issues: ProjectMarkdownIssue[] = [...scan.issues]
        const total = scan.files.length + issues.length
        let processed = issues.length
        const included: { relativePath: string; size: number; content: string; sectionChars: number }[] = []
        let totalChars = 0
        // Known per-file size exclusions must not inflate the tree reservation.
        // Other scan-time exclusions are already absent from scan.files.
        const treeCandidates = getProjectMarkdownTreeCandidates(scan.files, maxFileSizeBytes)
        const plan = createProjectMarkdownDocumentPlan(
          path.basename(scan.rootPath) || 'Project',
          scan.rootPath,
          treeCandidates,
          includeTree,
          MAX_TOTAL_OUTPUT_CHARS,
        )

        for (let index = 0; index < scan.files.length; index += 1) {
          assertNotAborted()
          const file = scan.files[index]
          processed += 1
          event.sender.send('project-markdown-progress', { operationId: operationId!, processed, total })

          if (file.size > maxFileSizeBytes) {
            issues.push({ relativePath: file.relativePath, reason: 'max-file-size', kind: 'file' })
            continue
          }

          const fullPath = path.join(realDir, file.relativePath)
          if (!isUnderBase(fullPath, realDir)) {
            issues.push({ relativePath: file.relativePath, reason: 'read-error', kind: 'file' })
            continue
          }

          let content: string | null
          try {
            content = await readFileContentRaw(fullPath)
          } catch {
            issues.push({ relativePath: file.relativePath, reason: 'read-error', kind: 'file' })
            continue
          }
          if (content === null) {
            issues.push({ relativePath: file.relativePath, reason: 'binary', kind: 'file' })
            continue
          }

          const sectionChars = getProjectMarkdownFileSectionLength(file.relativePath, content)
          const limitReason = getProjectMarkdownLimitReason(
            file,
            maxFileSizeBytes,
            totalChars,
            sectionChars,
            plan.fileSectionBudget,
          )
          if (limitReason) {
            const outputLimitReached = limitReason === 'output-limit'
            issues.push({ relativePath: file.relativePath, reason: limitReason, kind: 'file' })
            if (outputLimitReached) {
              for (let omittedIndex = index + 1; omittedIndex < scan.files.length; omittedIndex += 1) {
                const omitted = scan.files[omittedIndex]
                issues.push({
                  relativePath: omitted.relativePath,
                  reason: omitted.size > maxFileSizeBytes ? 'max-file-size' : 'output-limit',
                  kind: 'file',
                })
                processed += 1
              }
              break
            }
            continue
          }
          totalChars += sectionChars
          included.push({ ...file, content, sectionChars })
        }
        if (operationId) {
          event.sender.send('project-markdown-progress', { operationId, processed: Math.min(processed, total), total })
        }
        included.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        assertNotAborted()
        const finalized = finalizeProjectMarkdownDocument(plan, included, issues, options?.maxFileSizeKB ?? DEFAULT_MAX_FILE_SIZE_KB)
        return {
          markdown: finalized.markdown,
          stats: finalized.stats,
          scannedFiles: scan.files,
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
