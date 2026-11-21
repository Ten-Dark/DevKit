import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import { bootstrapWorkspace, resolveWorkspacePaths, WORKSPACE_MANIFEST_FILE_NAME } from './workspace.js'
import { DEFAULT_SETTINGS, getLegacySettingsPath, getSettingsPath, migrateLegacySettings } from './settings.js'
import { RuntimeCore } from './core/runtime-core.js'
import type { ServiceDefinition } from './core/contracts.js'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => '1.0.3'),
  },
  ipcMain: { handle: vi.fn() },
}))

let tempDir: string
let runtime: RuntimeCore

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-stage1-integration-'))
  vi.mocked(app.getPath).mockReturnValue(tempDir)
  runtime = new RuntimeCore({ readinessTimeoutMs: 1_000, readinessPollIntervalMs: 50 })
})

afterEach(async () => {
  const service = await runtime.registry.get('integration-api').catch(() => undefined)
  if (service) await runtime.processManager.stop(service).catch(() => undefined)
  await fs.rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('Stage 1 workspace-to-runtime integration', () => {
  it('bootstraps, migrates settings, registers and manages a service inside the owned workspace', async () => {
    const legacySettings = { ...DEFAULT_SETTINGS, sidebarCollapsed: true }
    await fs.writeFile(getLegacySettingsPath(), JSON.stringify(legacySettings), 'utf8')

    const workspace = await bootstrapWorkspace({ userDataPath: tempDir, appVersion: '1.0.3' })
    const migration = await migrateLegacySettings()
    await runtime.initialize()

    expect(workspace.manifest.owner).toBe('devkit')
    expect(workspace.manifest.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(migration.migrated).toBe(true)
    expect(JSON.parse(await fs.readFile(getSettingsPath(), 'utf8'))).toMatchObject({
      schemaVersion: 1,
      sidebarCollapsed: true,
    })
    expect(JSON.parse(await fs.readFile(getLegacySettingsPath(), 'utf8'))).toEqual(legacySettings)

    const paths = resolveWorkspacePaths()
    const service: ServiceDefinition = {
      id: 'integration-api',
      name: 'Integration API',
      version: '1.0.0',
      adapterId: 'process.local',
      owner: { kind: 'managed', resourceId: 'integration-api' },
      capabilities: ['status', 'health', 'start', 'stop', 'restart', 'logs'],
      platforms: ['win32'],
      dependencies: [],
      config: {
        executablePath: process.execPath,
        workingDirectory: tempDir,
        args: ['-e', 'setInterval(() => {}, 1000)'],
      },
    }

    await runtime.registerService(service)
    const plan = await runtime.getStartPlan(service.id)
    expect(plan.toStart).toEqual([service.id])

    const result = await runtime.executeStartPlan(service.id, plan.toStart)
    expect(result.services[0].snapshot.state).toBe('running')
    await runtime.stopService(service.id)

    await expect(fs.access(path.join(paths.root, WORKSPACE_MANIFEST_FILE_NAME))).resolves.toBeUndefined()
    await expect(fs.access(path.join(paths.registry, 'services.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(paths.registry, 'process-instances.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(paths.events, 'runtime.jsonl'))).resolves.toBeUndefined()
  })
})
