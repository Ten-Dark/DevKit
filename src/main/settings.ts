import { app } from 'electron'
import path from 'path'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import type { AppSettings } from '../shared/types.js'
import { registerIpcHandler } from './ipc-registry.js'

export const SETTINGS_FILE_NAME = 'settings.json'

export function getSettingsPath(): string {
  const userData = app.getPath('userData')
  return path.join(userData, SETTINGS_FILE_NAME)
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

export async function readSettingsFile(): Promise<AppSettings> {
  let raw: string
  try {
    raw = await fs.readFile(getSettingsPath(), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return deepCloneSettings(DEFAULT_SETTINGS)
    }
    throw error
  }

  const parsed: unknown = JSON.parse(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { ...DEFAULT_SETTINGS, ...parsed }
  }
  return deepCloneSettings(DEFAULT_SETTINGS)
}

async function writeSettingsFile(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath()
  const tmpPath = path.join(
    path.dirname(settingsPath),
    `${path.basename(settingsPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  const data = JSON.stringify(settings, null, 2)

  try {
    // Keep the temporary file beside the destination so rename stays on the
    // same volume. wx prevents accidental reuse even in the unlikely event of
    // a generated-name collision.
    await fs.writeFile(tmpPath, data, { encoding: 'utf-8', flag: 'wx' })
    // On Windows, rename within the same volume replaces the destination
    // atomically. If it fails, the previous settings.json remains untouched.
    await fs.rename(tmpPath, settingsPath)
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined)
    throw error
  }
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
