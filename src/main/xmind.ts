import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import type { Dirent } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { parseTopic, buildMarkdown } from '../renderer/utils/xmind.js'
import { mainWindow } from './window.js'
import { addAllowedOutputPath } from './security.js'

export const execFileAsync = promisify(execFile)

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

export function registerXMindHandlers(): void {
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
}
