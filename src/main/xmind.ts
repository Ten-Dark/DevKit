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

export interface ZipEntryInfo {
  filename: string
  compressedSize: number
  uncompressedSize: number
  offset: number
}

export function escapePsSingleQuoted(s: string): string {
  return s.replace(/'/g, "''")
}

const ZIP64_EOCD_SIGNATURE = 0x06064b50
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50
const ZIP_END_CENTRAL_DIR_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50

// Windows reserved filenames (case-insensitive)
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

function isWindowsReservedName(filename: string): boolean {
  const base = filename.replace(/\\/g, '/').split('/').pop() || ''
  const nameWithoutExt = base.split('.')[0]
  return WINDOWS_RESERVED_NAMES.has(nameWithoutExt.toUpperCase())
}

function normalizePathSeparators(filename: string): string {
  return filename.replace(/\\/g, '/')
}

function isZipSlipPath(filename: string): boolean {
  const normalized = normalizePathSeparators(filename)

  // Empty filename
  if (normalized.length === 0) {
    return true
  }

  // Absolute Unix path
  if (normalized.startsWith('/')) {
    return true
  }

  // Windows drive-absolute (C:\...) or drive-relative (C:...)
  if (/^[A-Za-z]:[\/\\]/.test(normalized)) {
    return true
  }
  if (/^[A-Za-z]:/.test(normalized)) {
    return true
  }

  // UNC path (\\server\share\...)
  if (normalized.startsWith('//')) {
    return true
  }

  // Dot and dot-dot components
  const parts = normalized.split('/')
  for (const part of parts) {
    if (part === '..' || part === '.') {
      return true
    }
  }

  // Windows reserved filename
  if (isWindowsReservedName(normalized)) {
    return true
  }

  return false
}

function readUInt32LESafe(buf: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buf.length) {
    throw new Error('Invalid ZIP archive: integer read would exceed buffer bounds')
  }
  return buf.readUInt32LE(offset)
}

function readUInt16LESafe(buf: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buf.length) {
    throw new Error('Invalid ZIP archive: integer read would exceed buffer bounds')
  }
  return buf.readUInt16LE(offset)
}

async function validateZipCentralDirectory(
  filePath: string,
): Promise<ZipEntryInfo[]> {
  const fd = await fs.open(filePath, 'r')
  try {
    const stat = await fd.stat()
    const fileSize = stat.size

    if (fileSize < 22) {
      throw new Error(
        'Invalid ZIP archive: file too small to contain End of Central Directory record',
      )
    }

    // ZIP64 detection: search for ZIP64 EOCD Locator first, then ZIP64 EOCD.
    // If either is present, reject the archive explicitly.
    const eocdSearchSize = Math.min(fileSize, 65559)
    const eocdBuf = Buffer.alloc(eocdSearchSize)
    await fd.read(eocdBuf, 0, eocdSearchSize, fileSize - eocdSearchSize)

    for (let i = eocdBuf.length - 4; i >= 0; i--) {
      const sig = eocdBuf.readUInt32LE(i)
      if (sig === ZIP64_EOCD_LOCATOR_SIGNATURE) {
        throw new Error(
          'ZIP64 archives are not supported: ZIP64 End of Central Directory Locator found',
        )
      }
      if (sig === ZIP64_EOCD_SIGNATURE) {
        throw new Error(
          'ZIP64 archives are not supported: ZIP64 End of Central Directory record found',
        )
      }
    }

    // Search for standard EOCD signature 0x06054b50 from the end
    let eocdOffset = -1
    for (let i = eocdBuf.length - 4; i >= 0; i--) {
      if (eocdBuf.readUInt32LE(i) === ZIP_END_CENTRAL_DIR_SIGNATURE) {
        eocdOffset = fileSize - eocdSearchSize + i
        break
      }
    }

    if (eocdOffset === -1) {
      throw new Error(
        'Invalid ZIP archive: End of Central Directory record not found',
      )
    }

    // EOCD is 22 bytes
    if (eocdOffset + 22 > fileSize) {
      throw new Error(
        'Invalid ZIP archive: End of Central Directory record extends beyond file bounds',
      )
    }

    const eocdBuf2 = Buffer.alloc(22)
    await fd.read(eocdBuf2, 0, 22, eocdOffset)

    const diskNumber = readUInt16LESafe(eocdBuf2, 4)
    const cdStartDisk = readUInt16LESafe(eocdBuf2, 6)
    if (diskNumber !== 0 || cdStartDisk !== 0) {
      throw new Error(
        'Invalid ZIP archive: multi-disk archives are not supported',
      )
    }

    const entriesOnThisDisk = readUInt16LESafe(eocdBuf2, 8)
    const totalEntries = readUInt16LESafe(eocdBuf2, 10)
    if (entriesOnThisDisk !== totalEntries) {
      throw new Error(
        'Invalid ZIP archive: entry count mismatch between this disk and total',
      )
    }

    const centralDirSize = readUInt32LESafe(eocdBuf2, 12)
    const centralDirOffset = readUInt32LESafe(eocdBuf2, 16)

    // Bounds: CD offset must be within file
    if (centralDirOffset > fileSize) {
      throw new Error(
        'Invalid ZIP archive: central directory offset exceeds file size',
      )
    }

    // Bounds: CD offset + size must be within file
    if (
      centralDirOffset > fileSize - centralDirSize ||
      centralDirOffset + centralDirSize > fileSize
    ) {
      throw new Error(
        'Invalid ZIP archive: central directory extends beyond file bounds',
      )
    }

    // Read central directory
    const cdBuf = Buffer.alloc(centralDirSize)
    await fd.read(cdBuf, 0, centralDirSize, centralDirOffset)

    const entries: ZipEntryInfo[] = []
    const seenNames = new Set<string>()
    let cdPos = 0

    for (let i = 0; i < totalEntries; i++) {
      // Each CD entry header is at least 46 bytes
      if (cdPos + 46 > cdBuf.length) {
        throw new Error(
          'Invalid ZIP archive: central directory entry header truncated',
        )
      }

      if (cdBuf.readUInt32LE(cdPos) !== ZIP_CENTRAL_DIR_SIGNATURE) {
        throw new Error(
          'Invalid ZIP archive: central directory entry signature not found',
        )
      }

      const versionMadeBy = readUInt16LESafe(cdBuf, cdPos + 4)
      const versionNeeded = readUInt16LESafe(cdBuf, cdPos + 6)
      const flags = readUInt16LESafe(cdBuf, cdPos + 8)
      const compressionMethod = readUInt16LESafe(cdBuf, cdPos + 10)
      const filenameLength = readUInt16LESafe(cdBuf, cdPos + 28)
      const extraFieldLength = readUInt16LESafe(cdBuf, cdPos + 30)
      const fileCommentLength = readUInt16LESafe(cdBuf, cdPos + 32)
      const compressedSize = readUInt32LESafe(cdBuf, cdPos + 20)
      const uncompressedSize = readUInt32LESafe(cdBuf, cdPos + 24)
      const localHeaderOffset = readUInt32LESafe(cdBuf, cdPos + 42)
      const diskStart = readUInt16LESafe(cdBuf, cdPos + 34)
      const internalAttr = readUInt16LESafe(cdBuf, cdPos + 36)
      const externalAttr = readUInt32LESafe(cdBuf, cdPos + 38)

      // Reject ZIP64 markers in standard fields
      if (versionNeeded === 0xFFFF || compressedSize === 0xFFFFFFFF ||
          uncompressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF) {
        throw new Error(
          'Invalid ZIP archive: ZIP64 sentinel values found in standard ZIP fields',
        )
      }

      // Bounds: local header offset within file
      if (localHeaderOffset > fileSize) {
        throw new Error(
          `Invalid ZIP archive: local header offset for entry ${i} exceeds file size`,
        )
      }

      // Detect symlink entries via Unix external attributes (bit 11 = symlink)
      // Unix symlink: (S_IFLNK = 0xA000) << 16 | permissions
      const isSymlink = (externalAttr & 0xF0000000) === 0xA0000000
      if (isSymlink) {
        throw new Error(
          `Invalid ZIP archive: symlink entry detected: '${filename}'`,
        )
      }

      const filenameEnd = cdPos + 46 + filenameLength
      if (filenameEnd > cdBuf.length) {
        throw new Error(
          'Invalid ZIP archive: central directory filename truncated',
        )
      }

      const filename = cdBuf.subarray(cdPos + 46, filenameEnd).toString('utf-8')

      // Zip Slip / path traversal checks (before any disk write)
      if (isZipSlipPath(filename)) {
        throw new Error(
          `Unsafe ZIP entry path (path traversal or absolute): '${filename}'`,
        )
      }

      // Duplicate entry names (case-insensitive for Windows compatibility)
      const normalizedName = normalizePathSeparators(filename)
      const normalizedLower = normalizedName.toLowerCase()
      if (seenNames.has(normalizedLower)) {
        throw new Error(`Duplicate ZIP entry: '${filename}'`)
      }
      seenNames.add(normalizedLower)

      // Individual uncompressed size limit
      if (uncompressedSize > MAX_EXTRACT_TOTAL_SIZE) {
        throw new Error(
          `ZIP entry '${filename}' uncompressed size exceeds limit (${uncompressedSize} bytes)`,
        )
      }

      entries.push({
        filename,
        compressedSize,
        uncompressedSize,
        offset: localHeaderOffset,
      })

      cdPos += 46 + filenameLength + extraFieldLength + fileCommentLength
    }

    // Bounds: all entries must fit within central directory
    if (cdPos > cdBuf.length) {
      throw new Error(
        'Invalid ZIP archive: central directory entries extend beyond buffer',
      )
    }

    // Total uncompressed size limit
    let totalUncompressed = 0n
    for (const e of entries) {
      totalUncompressed += BigInt(e.uncompressedSize)
    }
    if (totalUncompressed > BigInt(MAX_EXTRACT_TOTAL_SIZE)) {
      throw new Error(
        `ZIP total uncompressed size exceeds limit (${totalUncompressed} > ${BigInt(MAX_EXTRACT_TOTAL_SIZE)} bytes)`,
      )
    }

    // Entry count limit
    if (entries.length > MAX_EXTRACT_FILE_COUNT) {
      throw new Error(
        `ZIP entry count exceeds limit (${entries.length} > ${MAX_EXTRACT_FILE_COUNT})`,
      )
    }

    return entries
  } finally {
    await fd.close()
  }
}

async function extractXMindToTemp(xmindPath: string): Promise<string> {
  // P9: Validate ZIP central directory BEFORE any extraction to disk
  await validateZipCentralDirectory(xmindPath)

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
