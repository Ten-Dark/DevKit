import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import type { Dirent } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { parseTopic, buildMarkdown } from '../shared/utils/xmind.js'
import { mainWindow } from './window.js'
import { addAllowedOutputPath } from './security.js'
import { registerIpcHandler } from './ipc-registry.js'

export const execFileAsync = promisify(execFile)

export const MAX_EXTRACT_TOTAL_SIZE = 50 * 1024 * 1024 // 50 MB
export const MAX_EXTRACT_FILE_COUNT = 5000

export function escapePsSingleQuoted(s: string): string {
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
      `Failed to extract .xmind archive (corrupted or unsupported zip): ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // P9: Validate extracted archive safety
  let totalSize = 0
  let fileCount = 0

  async function validateDir(dir: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await validateDir(full)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full)
          totalSize += stat.size
          fileCount += 1
          if (totalSize > MAX_EXTRACT_TOTAL_SIZE) {
            throw new Error(
              `Extracted archive exceeds size limit (${MAX_EXTRACT_TOTAL_SIZE} bytes)`,
            )
          }
          if (fileCount > MAX_EXTRACT_FILE_COUNT) {
            throw new Error(
              `Extracted archive exceeds file count limit (${MAX_EXTRACT_FILE_COUNT} files)`,
            )
          }
        } catch {
          // stat failures are treated as unsafe
          throw new Error(`Cannot stat extracted file: ${full}`)
        }
      }
    }
  }

  await validateDir(dest)

  return dest
}

function isPathSafe(extractRoot: string, targetPath: string): boolean {
  const relative = path.relative(extractRoot, targetPath)
  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

async function findContentJson(dir: string): Promise<string | null> {
  // P7: Prefer content.json in the archive root.
  const rootContent = path.join(dir, 'content.json')
  try {
    const stat = await fs.stat(rootContent).catch(() => null)
    if (stat?.isFile()) {
      return rootContent
    }
  } catch {
    // fall through to recursive search
  }

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

export function registerXMindHandlers(): void {
  registerIpcHandler('selectXMindFile', async () => {
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

  registerIpcHandler('convertXMindToMarkdown', async (_, xmindPath: string) => {
    let tempDir: string | null = null
    try {
      tempDir = await extractXMindToTemp(xmindPath)
      const contentPath = await findContentJson(tempDir)
      if (!contentPath) {
        throw new Error(
          'content.json not found in .xmind archive (missing or corrupted archive)',
        )
      }
      // P9: Ensure content.json is under the extraction root (Zip Slip protection)
      if (!isPathSafe(tempDir, contentPath)) {
        throw new Error('Unsafe content.json path in archive')
      }
      const raw = await fs.readFile(contentPath, 'utf-8')
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        throw new Error('content.json is not valid JSON')
      }

      // P8: Convert all sheets, not just the first.
      const warnings: string[] = []
      const sheetResults: Array<{
        sheetIndex: number
        markdown: string
        title: string
        topicCount: number
        depth: number
        hyperlinkCount: number
        markerCount: number
      }> = []

      const sheets: unknown[] = Array.isArray(data) ? data : [data]

      for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i]
        if (
          !sheet ||
          typeof sheet !== 'object' ||
          !(sheet as { rootTopic?: unknown }).rootTopic
        ) {
          warnings.push(
            `Sheet ${i + 1}: rootTopic not found, skipping.`,
          )
          continue
        }
        const root = parseTopic((sheet as { rootTopic: unknown }).rootTopic)
        const sheetTitle =
          root.title || path.basename(xmindPath).replace(/\.xmind$/i, '') || 'XMind'
        const { markdown, topicCount, depth, hyperlinkCount, markerCount } =
          buildMarkdown(root)
        sheetResults.push({
          sheetIndex: i,
          markdown,
          title: sheetTitle,
          topicCount,
          depth,
          hyperlinkCount,
          markerCount,
        })
      }

      if (sheetResults.length === 0) {
        throw new Error('No valid sheets found in content.json')
      }

      if (sheets.length > 1) {
        warnings.push(
          `Multiple sheets detected (${sheets.length}), all sheets converted.`,
        )
      }

      // Combine all sheets into a single markdown document.
      const combinedLines: string[] = []
      let totalTopicCount = 0
      let maxDepth = 0
      let totalHyperlinks = 0
      let totalMarkers = 0

      for (const result of sheetResults) {
        if (sheetResults.length > 1) {
          combinedLines.push(`## ${result.title}`)
          combinedLines.push('')
        }
        combinedLines.push(result.markdown.replace(/\n+$/, ''))
        combinedLines.push('')
        totalTopicCount += result.topicCount
        if (result.depth > maxDepth) maxDepth = result.depth
        totalHyperlinks += result.hyperlinkCount
        totalMarkers += result.markerCount
      }

      const firstTitle = sheetResults[0]?.title || path.basename(xmindPath).replace(/\.xmind$/i, '') || 'XMind'

      return {
        markdown: combinedLines.join('\n'),
        title: firstTitle,
        topicCount: totalTopicCount,
        depth: maxDepth,
        sheetsCount: sheets.length,
        warnings,
        hyperlinkCount: totalHyperlinks,
        markerCount: totalMarkers,
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

  registerIpcHandler('selectXMindOutputFile', async () => {
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
}
