import { _electron as electron, test, expect } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

type UpdateInfo = {
  status: string
  currentVersion: string
  availableVersion?: string
  downloadProgress?: number
}

type AppWindow = Window & {
  api: {
    getSettings: () => Promise<Record<string, unknown>>
    saveSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>
    getAppVersion: () => Promise<string>
    updater: {
      getInfo: () => Promise<UpdateInfo>
      check: () => Promise<UpdateInfo>
      download: () => Promise<{ success: boolean; error?: string }>
      install: () => Promise<{ success: boolean; error?: string }>
      onStatusChange: (callback: (info: UpdateInfo) => void) => () => void
    }
  }
}

const installerV1 = process.env.DEVTOOLBOX_UPDATER_E2E_INSTALLER
const feedSource = process.env.DEVTOOLBOX_UPDATER_E2E_FEED_DIR

async function waitUntil<T>(read: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for updater E2E condition.`)
}

function findProcessId(executablePath: string): number | null {
  const escaped = executablePath.replace(/'/g, "''")
  const script = `$p = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq '${escaped}' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1; if ($p) { $p.ProcessId }`
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim()
  const pid = Number(output)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

test.describe('Packaged Windows updater lifecycle', () => {
  test.describe.configure({ mode: 'serial' })

  test('updates an installed NSIS build from a local generic feed and preserves user settings', async () => {
    test.setTimeout(300_000)
    test.skip(!installerV1 || !feedSource, 'Requires isolated v1 NSIS installer and local v2 update feed artifacts.')

    const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devtoolbox-f09-updater-'))
    const installDir = path.join(testRoot, 'installed-app')
    const appDataDir = path.join(testRoot, 'appdata')
    const localAppDataDir = path.join(testRoot, 'localappdata')
    const feedDir = path.join(testRoot, 'feed')
    await fs.mkdir(installDir, { recursive: true })
    await fs.mkdir(appDataDir, { recursive: true })
    await fs.mkdir(localAppDataDir, { recursive: true })
    await fs.cp(feedSource!, feedDir, { recursive: true })
    const metadata = await fs.readFile(path.join(feedDir, 'latest.yml'), 'utf8')
    const metadataPath = metadata.match(/^path:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
    if (metadataPath && !(await fs.stat(path.join(feedDir, metadataPath)).catch(() => false))) {
      const sourceInstaller = (await fs.readdir(feedDir)).find((name) => name.endsWith('.exe') && name.includes('Setup'))
      if (!sourceInstaller) throw new Error('The v2 NSIS installer referenced by latest.yml is missing.')
      await fs.copyFile(path.join(feedDir, sourceInstaller), path.join(feedDir, metadataPath))
      const sourceBlockmap = path.join(feedDir, sourceInstaller + '.blockmap')
      if (await fs.stat(sourceBlockmap).catch(() => false)) {
        await fs.copyFile(sourceBlockmap, path.join(feedDir, metadataPath + '.blockmap'))
      }
    }

    let server: http.Server | undefined
    let appV1: Awaited<ReturnType<typeof electron.launch>> | undefined
    let appV2: Awaited<ReturnType<typeof electron.launch>> | undefined
    let restartedPid: number | null = null
    const appExe = path.join(installDir, 'Dev Toolbox.exe')

    try {
      execFileSync(installerV1!, ['/S', `/D=${installDir}`], {
        windowsHide: true,
        timeout: 120_000,
        stdio: 'pipe',
      })
      await fs.access(appExe)

      server = http.createServer(async (request, response) => {
        try {
          const relative = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname.slice(1))
          const target = path.resolve(feedDir, relative || 'latest.yml')
          if (target !== feedDir && !target.startsWith(feedDir + path.sep)) {
            response.writeHead(403).end()
            return
          }
          const data = await fs.readFile(target)
          response.writeHead(200, {
            'content-length': data.byteLength,
            'content-type': target.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
            'cache-control': 'no-store',
          })
          if (request.method === 'HEAD') response.end()
          else response.end(data)
        } catch {
          response.writeHead(404).end()
        }
      })
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Local update feed failed to bind.')
      const feedUrl = `http://127.0.0.1:${address.port}/`

      const runtimeEnv = {
        ...process.env,
        NODE_ENV: 'production',
        DEVKIT_UPDATER_TEST_MODE: '1',
        DEVKIT_UPDATER_TEST_FEED_URL: feedUrl,
        APPDATA: appDataDir,
        LOCALAPPDATA: localAppDataDir,
      }

      appV1 = await electron.launch({ executablePath: appExe, env: runtimeEnv })
      const windowV1 = await appV1.firstWindow()
      await windowV1.waitForLoadState('domcontentloaded')
      const versionBefore = await windowV1.evaluate(() => (window as AppWindow).api.getAppVersion())
      expect(versionBefore).toBe('1.0.1')

      const saved = await windowV1.evaluate(() =>
        (window as AppWindow).api.saveSettings({ maxFileSizeKB: 2048, includeTree: false }),
      )
      expect(saved.success).toBe(true)

      await windowV1.evaluate(() => {
        const api = (window as AppWindow).api
        const target = window as unknown as { __updaterUnsubscribe?: () => void; __updaterStatuses?: string[]; __updaterProgress?: number[] }
        target.__updaterStatuses = []
        target.__updaterProgress = []
        target.__updaterUnsubscribe = api.updater.onStatusChange((info) => {
          target.__updaterStatuses?.push(info.status)
          if (info.downloadProgress !== undefined) target.__updaterProgress?.push(info.downloadProgress)
        })
      })
      const check = await windowV1.evaluate(() => (window as AppWindow).api.updater.check())
      expect(check.status).toBe('update-available')
      expect(check.availableVersion).toBe('1.0.2')

      const download = await windowV1.evaluate(() => (window as AppWindow).api.updater.download())
      expect(download).toMatchObject({ success: true })
      const downloaded = await windowV1.evaluate(() => (window as AppWindow).api.updater.getInfo())
      expect(downloaded.status).toBe('downloaded')
      expect(downloaded.downloadProgress).toBe(100)
      const observed = await windowV1.evaluate(() => {
        const target = window as unknown as { __updaterStatuses?: string[]; __updaterProgress?: number[] }
        return { statuses: target.__updaterStatuses ?? [], progress: target.__updaterProgress ?? [] }
      })
      expect(observed.statuses).toContain('downloading')
      expect(observed.statuses).toContain('downloaded')
      expect(observed.progress.some((value) => value > 0)).toBe(true)

      const install = await windowV1.evaluate(() => (window as AppWindow).api.updater.install())
      expect(install.success).toBe(true)
      const oldProcess = appV1.process()
      if (oldProcess.exitCode === null && oldProcess.signalCode === null) {
        await Promise.race([
          new Promise<void>((resolve) => oldProcess.once('exit', () => resolve())),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Old app process did not exit after quitAndInstall.')), 120_000)),
        ])
      }

      restartedPid = await waitUntil(async () => findProcessId(appExe), 120_000)
      expect(restartedPid).toBeGreaterThan(0)

      appV2 = await electron.launch({ executablePath: appExe, env: runtimeEnv })
      const windowV2 = await appV2.firstWindow()
      await windowV2.waitForLoadState('domcontentloaded')
      const [versionAfter, persistedSettings] = await windowV2.evaluate(async () => {
        const api = (window as AppWindow).api
        return [await api.getAppVersion(), await api.getSettings()]
      })
      expect(versionAfter).toBe('1.0.2')
      expect(persistedSettings.maxFileSizeKB).toBe(2048)
      expect(persistedSettings.includeTree).toBe(false)

      await windowV2.evaluate(() => {
        ;(window as unknown as { __updaterUnsubscribe?: () => void }).__updaterUnsubscribe?.()
      })
    } finally {
      await appV2?.close().catch(() => undefined)
      await appV1?.close().catch(() => undefined)
      if (restartedPid) {
        execFileSync('taskkill.exe', ['/PID', String(restartedPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      }
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
      const uninstaller = path.join(installDir, 'Uninstall Dev Toolbox.exe')
      if (await fs.stat(uninstaller).catch(() => false)) {
        execFileSync(uninstaller, ['/S'], { windowsHide: true, timeout: 60_000, stdio: 'ignore' })
      }
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})
