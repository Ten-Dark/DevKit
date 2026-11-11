import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { AppSettings } from '../renderer/types'

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
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
    return deepCloneSettings(DEFAULT_SETTINGS)
  } catch {
    return deepCloneSettings(DEFAULT_SETTINGS)
  }
}

export async function writeSettingsFile(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath()
  const tmpPath = settingsPath + '.tmp'
  const data = JSON.stringify(settings, null, 2)
  await fs.writeFile(tmpPath, data, 'utf-8')
  await fs.rename(tmpPath, settingsPath)
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('getSettings', async () => {
    return await readSettingsFile()
  })

  ipcMain.handle(
    'saveSettings',
    async (_, settings: Partial<AppSettings>) => {
      const current = await readSettingsFile()
      const merged: AppSettings = { ...current, ...settings }
      await writeSettingsFile(merged)
      return { success: true }
    },
  )

  ipcMain.handle(
    'resetSettings',
    async () => {
      await writeSettingsFile(deepCloneSettings(DEFAULT_SETTINGS))
      return { success: true }
    },
  )

  ipcMain.handle('getAppVersion', async () => {
    return app.getVersion()
  })
}
