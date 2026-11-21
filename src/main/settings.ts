import { app } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type { AppSettings } from '../shared/types.js'
import { registerIpcHandler } from './ipc-registry.js'
import { ensureSafeDirectory, resolveWorkspacePaths } from './workspace.js'

export const SETTINGS_FILE_NAME = 'settings.json'
export const SETTINGS_SCHEMA_VERSION = 1

export function getLegacySettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME)
}

export function getSettingsPath(): string {
  return path.join(resolveWorkspacePaths().config, SETTINGS_FILE_NAME)
}

export const DEFAULT_SETTINGS: AppSettings = {
  favorites: [],
  recents: [],
  theme: 'dark',
  maxFileSizeKB: 1024,
  includeTree: true,
  respectGitignore: true,
}

export function deepCloneSettings(s: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(s))
}

function mergeSettings(parsed: unknown): AppSettings {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return deepCloneSettings(DEFAULT_SETTINGS)
  }

  const record = parsed as Record<string, unknown>
  if (
    Object.prototype.hasOwnProperty.call(record, 'schemaVersion') &&
    record.schemaVersion !== SETTINGS_SCHEMA_VERSION
  ) {
    throw new Error(`Unsupported settings schema version: ${String(record.schemaVersion)}`)
  }

  const settings = { ...record }
  delete settings.schemaVersion
  return { ...DEFAULT_SETTINGS, ...settings } as AppSettings
}

async function readSettingsAt(settingsPath: string): Promise<AppSettings> {
  await ensureSafeDirectory(path.dirname(settingsPath))
  let raw: string
  try {
    const fileStat = await fs.lstat(settingsPath)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error('Settings path must be a regular file.')
    }
    raw = await fs.readFile(settingsPath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return deepCloneSettings(DEFAULT_SETTINGS)
    }
    throw error
  }

  return mergeSettings(JSON.parse(raw) as unknown)
}

export async function readSettingsFile(): Promise<AppSettings> {
  return readSettingsAt(getSettingsPath())
}

async function writeSettingsFile(settings: AppSettings, targetPath = getSettingsPath()): Promise<void> {
  await ensureSafeDirectory(path.dirname(targetPath))
  try {
    const targetStat = await fs.lstat(targetPath)
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new Error('Settings destination must be a regular file.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const tmpPath = path.join(
    path.dirname(targetPath),
    `${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  const data = JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ...settings }, null, 2)

  try {
    // Keep the temporary file beside the destination so rename stays on the
    // same volume. wx prevents accidental reuse even in the unlikely event of
    // a generated-name collision.
    await fs.writeFile(tmpPath, data, { encoding: 'utf-8', flag: 'wx' })
    // On Windows, rename within the same volume replaces the destination
    // atomically. If it fails, the previous settings.json remains untouched.
    await fs.rename(tmpPath, targetPath)
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined)
    throw error
  }
}

/**
 * Copies legacy userData/settings.json into the DevKit workspace config.
 * The source is intentionally retained; migration never deletes user data.
 */
export async function migrateLegacySettings(): Promise<{ migrated: boolean; sourcePath: string; targetPath: string }> {
  const sourcePath = getLegacySettingsPath()
  const targetPath = getSettingsPath()
  await ensureSafeDirectory(path.dirname(targetPath))

  try {
    const targetStat = await fs.lstat(targetPath)
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new Error('Workspace settings path must be a regular file.')
    }
    await readSettingsAt(targetPath)
    return { migrated: false, sourcePath, targetPath }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let legacyRaw: string
  try {
    const sourceStat = await fs.lstat(sourcePath)
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error('Legacy settings source must be a regular file.')
    }
    legacyRaw = await fs.readFile(sourcePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { migrated: false, sourcePath, targetPath }
    }
    throw error
  }

  // Parse before writing. A corrupt legacy file is preserved and prevents
  // startup migration rather than silently replacing user preferences.
  const settings = mergeSettings(JSON.parse(legacyRaw) as unknown)
  await writeSettingsFile(settings, targetPath)
  return { migrated: true, sourcePath, targetPath }
}

// All settings mutations must pass through this queue. The operation itself,
// including read-modify-write, runs inside the queue so it always reads the
// latest committed state. The tail is kept fulfilled after failures, while
// each caller still receives its own operation's result or rejection.
let settingsWriteQueue: Promise<void> = Promise.resolve()

function enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsWriteQueue.then(operation)
  settingsWriteQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export function registerSettingsHandlers(): void {
  registerIpcHandler('getSettings', async () => {
    return await readSettingsFile()
  })

  registerIpcHandler(
    'saveSettings',
    async (_, settings: Partial<AppSettings>) =>
      enqueueSettingsWrite(async () => {
        const current = await readSettingsFile()
        const merged: AppSettings = { ...current, ...settings }
        await writeSettingsFile(merged)
        return { success: true }
      }),
  )

  registerIpcHandler(
    'resetSettings',
    async () =>
      enqueueSettingsWrite(async () => {
        await writeSettingsFile(deepCloneSettings(DEFAULT_SETTINGS))
        return { success: true }
      }),
  )

  registerIpcHandler('getAppVersion', async () => {
    return app.getVersion()
  })
}
