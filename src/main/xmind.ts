import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import type { Dirent } from 'fs'
import { createWriteStream } from 'fs'
import { Transform } from 'stream'
import * as yauzl from 'yauzl'
import { pipeline } from 'stream/promises'
import { parseTopicAsync, buildMarkdownAsync } from '../shared/utils/xmind.js'
import { mainWindow } from './window.js'
import { addAllowedOutputPath } from './security.js'
import { registerIpcHandler } from './ipc-registry.js'

export const MAX_EXTRACT_TOTAL_SIZE = 50 * 1024 * 1024 // 50 MB
export const MAX_EXTRACT_FILE_COUNT = 5000

const activeXMindOperations = new Map<string, { controller: AbortController; senderId: number }>()

type XMindProgressPayload = {
  operationId: string
  phase: 'extracting' | 'converting'
  stage?: 'sheets' | 'parsing' | 'rendering'
  processed: number
  total: number
  processedEntries: number
  totalEntries: number
}

export interface ZipEntryInfo {
  filename: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  flags: number
  crc32: number
  offset: number
  externalFileAttributes: number
  isDirectory: boolean
}


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

interface ValidatedZipEntry extends ZipEntryInfo {
  entry: yauzl.Entry
}

const ZIP_OPEN_OPTIONS: yauzl.Options = {
  autoClose: false,
  lazyEntries: true,
  decodeStrings: true,
  // Actual byte counts are enforced by the extraction Transform before disk writes.
  validateEntrySizes: false,
  strictFileNames: false,
}

function normalizeZipError(error: unknown): Error {
  const original = error instanceof Error ? error : new Error(String(error))
  if (/invalid relative path|absolute path/i.test(original.message)) {
    return new Error(`Unsafe ZIP entry path: ${original.message}`, { cause: original })
  }
  if (/end of central directory|comment length|unexpected eof|not a zip|file data overflows|invalid local file header|invalid central directory/i.test(original.message)) {
    return new Error(`Invalid ZIP archive: ${original.message}`, { cause: original })
  }
  return original
}
async function openZipFile(filePath: string): Promise<yauzl.ZipFile> {
  try {
    return await yauzl.openPromise(filePath, ZIP_OPEN_OPTIONS)
  } catch (error) {
    throw normalizeZipError(error)
  }
}

async function readZipEntries(zipfile: yauzl.ZipFile): Promise<ValidatedZipEntry[]> {
  if (zipfile.entryCount > MAX_EXTRACT_FILE_COUNT) {
    throw new Error(
      `ZIP entry count exceeds limit (${zipfile.entryCount} > ${MAX_EXTRACT_FILE_COUNT})`,
    )
  }

  const entries: ValidatedZipEntry[] = []
  const seenNames = new Set<string>()
  let totalUncompressed = 0n

  for await (const entry of zipfile.eachEntry()) {
    if (entries.length >= MAX_EXTRACT_FILE_COUNT) {
      throw new Error(
        `ZIP entry count exceeds limit (${entries.length + 1} > ${MAX_EXTRACT_FILE_COUNT})`,
      )
    }

    const filename = entry.fileName
    const normalizedName = normalizePathSeparators(filename)
    if (isZipSlipPath(filename)) {
      throw new Error(`Unsafe ZIP entry path (path traversal or absolute): '${filename}'`)
    }

    const isDirectory = normalizedName.endsWith('/') ||
      (entry.externalFileAttributes & 0x10) !== 0 ||
      (entry.externalFileAttributes >>> 28) === 0x4
    const duplicateKey = normalizedName.replace(/\/+$/, '').normalize('NFC').toLowerCase()
    if (seenNames.has(duplicateKey)) {
      throw new Error(`Duplicate ZIP entry: '${filename}'`)
    }
    seenNames.add(duplicateKey)

    if ((entry.externalFileAttributes >>> 28) === 0xA) {
      throw new Error(`Invalid ZIP archive: symlink entry detected: '${filename}'`)
    }

    const unixFileType = (entry.externalFileAttributes >>> 28) & 0xF
    if (unixFileType !== 0 && unixFileType !== 0x4 && unixFileType !== 0x8) {
      throw new Error(`Invalid ZIP archive: unsupported special filesystem entry: '${filename}'`)
    }

    if (entry.isEncrypted()) {
      throw new Error(`Invalid ZIP archive: encrypted entry is not supported: '${filename}'`)
    }
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new Error(`Invalid ZIP archive: unsupported compression method ${entry.compressionMethod}`)
    }
    if (!entry.canDecodeFileData()) {
      throw new Error(`Invalid ZIP archive: unsupported or encrypted entry: '${filename}'`)
    }

    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
        !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) {
      throw new Error(`Invalid ZIP archive: unsafe entry size for '${filename}'`)
    }
    if (entry.uncompressedSize > MAX_EXTRACT_TOTAL_SIZE) {
      throw new Error(
        `ZIP entry '${filename}' uncompressed size exceeds limit (${entry.uncompressedSize} bytes)`,
      )
    }
    if (isDirectory && (entry.compressedSize !== 0 || entry.uncompressedSize !== 0)) {
      throw new Error(`Invalid ZIP archive: directory entry contains data: '${filename}'`)
    }

    totalUncompressed += BigInt(entry.uncompressedSize)
    if (totalUncompressed > BigInt(MAX_EXTRACT_TOTAL_SIZE)) {
      throw new Error(
        `ZIP total uncompressed size exceeds limit (${totalUncompressed} > ${BigInt(MAX_EXTRACT_TOTAL_SIZE)} bytes)`,
      )
    }

    // Let yauzl parse and bounds-check the local header; do not hand-parse ZIP records.
    const localHeader = await zipfile.readLocalFileHeaderPromise(entry)
    if (
      localHeader.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
      localHeader.compressionMethod !== entry.compressionMethod ||
      localHeader.fileName.toString('utf8') !== filename
    ) {
      throw new Error('Invalid ZIP archive: local/central metadata mismatch: ' + filename)
    }
    entries.push({
      filename,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      compressionMethod: entry.compressionMethod,
      flags: entry.generalPurposeBitFlag,
      crc32: entry.crc32,
      offset: entry.relativeOffsetOfLocalHeader,
      externalFileAttributes: entry.externalFileAttributes,
      isDirectory,
      entry,
    })
  }

  return entries
}

export async function validateZipCentralDirectory(
  filePath: string,
): Promise<ZipEntryInfo[]> {
  const zipfile = await openZipFile(filePath)
  try {
    const entries = await readZipEntries(zipfile)
    return entries.map(({ entry: _entry, ...info }) => info)
  } catch (error) {
    throw normalizeZipError(error)
  } finally {
    zipfile.close()
  }
}

export async function validateExtractedDirectory(extractRoot: string): Promise<void> {
  let totalExtractedSize = 0n
  let fileCount = 0
  const pendingDirectories = [extractRoot]

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop()!
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name)
      const stat = await fs.lstat(entryPath)

      if (stat.isSymbolicLink()) {
        throw new Error(`Extracted archive contains a symbolic link: '${entry.name}'`)
      }
      if (stat.isDirectory()) {
        pendingDirectories.push(entryPath)
        continue
      }
      if (!stat.isFile()) {
        throw new Error(`Extracted archive contains an unsupported filesystem entry: '${entry.name}'`)
      }

      fileCount++
      if (fileCount > MAX_EXTRACT_FILE_COUNT) {
        throw new Error(
          `Extracted file count exceeds limit (${fileCount} > ${MAX_EXTRACT_FILE_COUNT})`,
        )
      }
      totalExtractedSize += BigInt(stat.size)
      if (totalExtractedSize > BigInt(MAX_EXTRACT_TOTAL_SIZE)) {
        throw new Error(
          `Extracted data size exceeds limit (${totalExtractedSize} > ${BigInt(MAX_EXTRACT_TOTAL_SIZE)} bytes)`,
        )
      }
    }
  }
}

const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let value = i
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) ? (value >>> 1) ^ 0xEDB88320 : value >>> 1
  }
  CRC32_TABLE[i] = value >>> 0
}

async function ensureSafeDirectory(extractRoot: string, directoryPath: string): Promise<void> {
  const relative = path.relative(extractRoot, directoryPath)
  if (relative.length === 0) return
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe extraction directory: '${directoryPath}'`)
  }

  let current = extractRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      await fs.mkdir(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Unsafe extraction directory (symlink or non-directory): '${current}'`)
    }
  }
}

async function extractZipEntry(
  zipfile: yauzl.ZipFile,
  dest: string,
  entry: ValidatedZipEntry,
  counters: { totalBytes: bigint },
  signal?: AbortSignal,
  onProgress?: (processedBytes: number) => void,
): Promise<void> {
  signal?.throwIfAborted()
  const normalizedName = normalizePathSeparators(entry.filename).replace(/\/+$/, '')
  const targetPath = path.resolve(dest, ...normalizedName.split('/').filter(Boolean))
  if (!isPathSafe(dest, targetPath)) {
    throw new Error(`Unsafe ZIP entry path: '${entry.filename}'`)
  }

  if (entry.isDirectory) {
    await ensureSafeDirectory(dest, targetPath)
    return
  }

  await ensureSafeDirectory(dest, path.dirname(targetPath))

  let entryBytes = 0n
  let crc = 0xFFFFFFFF
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const chunkBytes = BigInt(chunk.length)
      const nextEntryBytes = entryBytes + chunkBytes
      const nextTotalBytes = counters.totalBytes + chunkBytes

      if (nextTotalBytes > BigInt(MAX_EXTRACT_TOTAL_SIZE)) {
        callback(new Error(`ZIP extraction exceeded the ${MAX_EXTRACT_TOTAL_SIZE}-byte limit while writing data`))
        return
      }
      if (nextEntryBytes > BigInt(entry.uncompressedSize)) {
        callback(new Error(`ZIP entry '${entry.filename}' expanded beyond its declared size`))
        return
      }

      entryBytes = nextEntryBytes
      counters.totalBytes = nextTotalBytes
      onProgress?.(Number(counters.totalBytes))
      for (const byte of chunk) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xFF]
      }
      callback(null, chunk)
    },
  })

  const source = await zipfile.openReadStreamPromise(entry.entry)
  const output = createWriteStream(targetPath, { flags: 'wx' })
  if (signal) {
    await pipeline(source, limiter, output, { signal })
  } else {
    await pipeline(source, limiter, output)
  }

  if (entryBytes !== BigInt(entry.uncompressedSize)) {
    throw new Error(
      `ZIP entry '${entry.filename}' size mismatch: expected ${entry.uncompressedSize}, got ${entryBytes}`,
    )
  }
  const actualCrc = (crc ^ 0xFFFFFFFF) >>> 0
  if (actualCrc !== entry.crc32) {
    throw new Error(`Invalid ZIP archive: CRC32 mismatch for '${entry.filename}'`)
  }
}

export async function extractXMindToTemp(
  xmindPath: string,
  options: { signal?: AbortSignal; onProgress?: (processedBytes: number, totalBytes: number, processedEntries: number, totalEntries: number) => void } = {},
): Promise<string> {
  let zipfile: yauzl.ZipFile | null = null
  let dest: string | null = null

  try {
    zipfile = await openZipFile(xmindPath)
    const entries = await readZipEntries(zipfile)
    options.signal?.throwIfAborted()
    dest = await fs.mkdtemp(path.join(os.tmpdir(), 'xmind-md-'))

    const counters = { totalBytes: 0n }
    const totalBytes = entries.reduce((total, entry) => total + BigInt(entry.uncompressedSize), 0n)
    options.onProgress?.(0, Number(totalBytes), 0, entries.length)
    let processedEntries = 0
    for (const entry of entries) {
      options.signal?.throwIfAborted()
      await extractZipEntry(zipfile, dest, entry, counters, options.signal, (processedBytes) => {
        options.onProgress?.(processedBytes, Number(totalBytes), processedEntries, entries.length)
      })
      processedEntries += 1
      options.onProgress?.(Number(counters.totalBytes), Number(totalBytes), processedEntries, entries.length)
    }
    await validateExtractedDirectory(dest)
    return dest
  } catch (err) {
    if (dest) await fs.rm(dest, { recursive: true, force: true }).catch(() => {})
    if (options.signal?.aborted) {
      throw new Error('Operation aborted', { cause: err })
    }
    throw new Error(
      `Failed to extract .xmind archive (corrupted or unsupported zip): ${normalizeZipError(err).message}`,
      { cause: err },
    )
  } finally {
    zipfile?.close()
  }
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

  registerIpcHandler('cancelXMindConversion', (event, operationId: string) => {
    const operation = activeXMindOperations.get(operationId)
    if (!operation || operation.senderId !== event.sender.id) return { success: false }
    operation.controller.abort()
    return { success: true }
  })

  registerIpcHandler('convertXMindToMarkdown', async (event, xmindPath: string, requestedOperationId?: string) => {
    const operationId = requestedOperationId || randomUUID()
    if (typeof operationId !== 'string' || operationId.length === 0 || operationId.length > 128) {
      throw new Error('Invalid XMind operation ID')
    }
    if (activeXMindOperations.has(operationId)) {
      throw new Error('XMind operation ID is already active')
    }
    const controller = new AbortController()
    activeXMindOperations.set(operationId, { controller, senderId: event.sender.id })
    const sendProgress = (payload: Omit<XMindProgressPayload, 'operationId'>) => {
      if (controller.signal.aborted || event.sender.isDestroyed()) return
      try {
        event.sender.send('xmind-conversion-progress', { operationId, ...payload } satisfies XMindProgressPayload)
      } catch {
        // The renderer may have navigated away or its WebContents may be closing.
      }
    }
    let tempDir: string | null = null
    try {
      sendProgress({ phase: 'extracting', processed: 0, total: 0, processedEntries: 0, totalEntries: 0 })
      tempDir = await extractXMindToTemp(xmindPath, {
        signal: controller.signal,
        onProgress: (processed, total, processedEntries, totalEntries) => sendProgress({ phase: 'extracting', processed, total, processedEntries, totalEntries }),
      })
      controller.signal.throwIfAborted()
      const contentPath = await findContentJson(tempDir)
      controller.signal.throwIfAborted()
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
      controller.signal.throwIfAborted()
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        throw new Error('content.json is not valid JSON')
      }
      controller.signal.throwIfAborted()

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
      sendProgress({ phase: 'converting', stage: 'sheets', processed: 0, total: sheets.length, processedEntries: 0, totalEntries: 0 })

      for (let i = 0; i < sheets.length; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        controller.signal.throwIfAborted()
        const sheet = sheets[i]
        if (
          !sheet ||
          typeof sheet !== 'object' ||
          !(sheet as { rootTopic?: unknown }).rootTopic
        ) {
          warnings.push('Sheet ' + (i + 1) + ': rootTopic not found, skipping.')
          sendProgress({ phase: 'converting', stage: 'sheets', processed: i + 1, total: sheets.length, processedEntries: 0, totalEntries: 0 })
          continue
        }
        const parsed = await parseTopicAsync((sheet as { rootTopic: unknown }).rootTopic, {
          signal: controller.signal,
          onProgress: (processed) => sendProgress({ phase: 'converting', stage: 'parsing', processed, total: 0, processedEntries: 0, totalEntries: 0 }),
        })
        const root = parsed.root
        const sheetTitle =
          root.title || path.basename(xmindPath).replace(/\.xmind$/i, '') || 'XMind'
        sendProgress({ phase: 'converting', stage: 'rendering', processed: 0, total: parsed.topicCount, processedEntries: 0, totalEntries: 0 })
        const { markdown, topicCount, depth, hyperlinkCount, markerCount } =
          await buildMarkdownAsync(root, {
            signal: controller.signal,
            onProgress: (processed) => sendProgress({ phase: 'converting', stage: 'rendering', processed, total: parsed.topicCount, processedEntries: 0, totalEntries: 0 }),
          })
        sheetResults.push({
          sheetIndex: i,
          markdown,
          title: sheetTitle,
          topicCount,
          depth,
          hyperlinkCount,
          markerCount,
        })
        sendProgress({ phase: 'converting', stage: 'sheets', processed: i + 1, total: sheets.length, processedEntries: 0, totalEntries: 0 })
      }

      controller.signal.throwIfAborted()
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
      if (controller.signal.aborted) throw new Error('Operation aborted', { cause: err })
      throw new Error(
        err instanceof Error ? err.message : 'Failed to convert XMind file to Markdown',
        { cause: err },
      )
    } finally {
      activeXMindOperations.delete(operationId)
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
