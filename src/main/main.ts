import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { McpWorkersClient } from './integrations/mcpworkers-client.js'
import { McpWorkersManagerRuntime, MCPWORKERS_MANAGER_SERVICE } from './integrations/mcpworkers-manager-runtime.js'
import { createMcpWorkersManagerAdapter } from './integrations/mcpworkers-manager-adapter.js'
import { McpWorkersManagerRuntimeConfigStore } from './integrations/mcpworkers-manager-config.js'
import { createWindow } from './window.js'
import { migrateLegacySettings, registerSettingsHandlers } from './settings.js'
import { registerWindowHandlers } from './window.js'
import { registerXMindHandlers } from './xmind.js'
import { registerProjectMarkdownHandlers } from './project-markdown.js'
import { registerUpdaterHandlers, startPeriodicCheck, stopPeriodicCheck } from './updater/index.js'
import { bootstrapWorkspace } from './workspace.js'
import { RuntimeCore } from './core/runtime-core.js'
import { registerRuntimeHandlers } from './core/runtime-ipc.js'
import { McpHubManager } from './mcp/mcp-hub.js'
import { WindowsProcessControlProvider } from './core/windows-process-control-provider.js'
import { registerMcpHandlers } from './mcp/mcp-ipc.js'
import { LocalIntegrationsManager } from './integrations/local-integrations.js'
import { MultiAggregatorManager } from './integrations/multiaggregator-manager.js'
import { registerLocalIntegrationHandlers, registerMcpWorkersHandlers } from './integrations/integration-ipc.js'
import { ObsidianVaultStorageProvider } from './storage/storage-manager.js'
import { KarakeepStorageProvider } from './storage/karakeep-provider.js'
import { registerStorageHandlers } from './storage/storage-ipc.js'
import { SecretProviderRegistry } from './secrets/secret-provider.js'
import { KeePassXCProvider } from './secrets/keepassxc-provider.js'

// Acquire the process lock before registering IPC handlers or initializing
// persistent state. A second launch must not race workspace/config mutations.
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  let runtimeInitialized = false
  let mcpHub: McpHubManager | undefined
  let secretProviders: SecretProviderRegistry | undefined
  let mcpWorkersClient: McpWorkersClient | undefined
  let mcpWorkersManagerRuntime: McpWorkersManagerRuntime | undefined
  let mcpWorkersManagerConfig: McpWorkersManagerRuntimeConfigStore | undefined
  let allowQuitAfterMcpCleanup = false

  app.on('second-instance', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow) {
      if (runtimeInitialized) createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  registerSettingsHandlers()
  registerWindowHandlers()
  registerXMindHandlers()
  registerProjectMarkdownHandlers()
  registerUpdaterHandlers()

  // ------------------------------------------------------------------- diagnostics -----

  function logStartupError(err: unknown): void {
    const timestamp = new Date().toISOString()
    console.error('[' + timestamp + '] Electron main process startup error:')
    if (err instanceof Error) {
      console.error('  Message: ' + err.message)
      console.error('  Stack: ' + err.stack)
    } else {
      console.error('  Error: ' + String(err))
    }
  }

  app.whenReady().then(async () => {
    try {
      await bootstrapWorkspace()
      await migrateLegacySettings()
      const runtime = new RuntimeCore()
      await runtime.initialize()
      registerRuntimeHandlers(runtime)
      const mcpProcessControl = process.platform === 'win32' ? new WindowsProcessControlProvider() : undefined
      mcpHub = new McpHubManager(undefined, {}, mcpProcessControl)
      await mcpHub.initialize()
      registerMcpHandlers(mcpHub)
      const localIntegrations = new LocalIntegrationsManager()
      const multiAggregator = new MultiAggregatorManager()
      await Promise.all([localIntegrations.initialize(), multiAggregator.initialize()])
      registerLocalIntegrationHandlers(localIntegrations, multiAggregator)

      const storage = new ObsidianVaultStorageProvider()
      secretProviders = new SecretProviderRegistry()
      if (process.platform === 'win32') {
        try {
          const cliPath = execFileSync('where.exe', ['keepassxc-cli'], { encoding: 'utf8', windowsHide: true })
            .split(/\r?\n/).map((value) => value.trim()).find(Boolean)
          if (cliPath) secretProviders.register(new KeePassXCProvider({ cliPath }))
        } catch {
          // Provider remains unavailable when KeePassXC CLI is not installed or not on PATH.
        }
      }

      mcpWorkersClient = new McpWorkersClient({
        secretProviders,
        storePath: path.join(app.getPath('userData'), 'mcpworkers-connection.json'),
      })
      mcpWorkersManagerConfig = new McpWorkersManagerRuntimeConfigStore(
        path.join(app.getPath('userData'), 'mcpworkers-manager-runtime.json'),
      )
      const managerDataRootCandidates = [
        process.env.DEVKIT_MCPWORKERS_DATA_ROOT,
        !app.isPackaged ? path.resolve(app.getAppPath(), '..', 'MCPWorkers', '.mcpworkers') : null,
        path.join(app.getPath('home'), 'Projects', 'MCPWorkers', '.mcpworkers'),
      ].filter((candidate): candidate is string => Boolean(candidate))
      await mcpWorkersManagerConfig.initialize(managerDataRootCandidates)
      mcpWorkersManagerRuntime = new McpWorkersManagerRuntime({
        processManager: runtime.processManager,
        client: mcpWorkersClient,
        resolveLaunchSpec: async () => {
          if (process.platform !== 'win32') return null

          const managerEntry = app.isPackaged
            ? path.join(process.resourcesPath, 'mcpworkers-manager', 'manager.mjs')
            : path.join(app.getAppPath(), 'dist-electron', 'mcpworkers-manager', 'manager.mjs')
          const configuredDataRoot = mcpWorkersManagerConfig?.getDataRoot()
          const environmentDataRoot = process.env.DEVKIT_MCPWORKERS_DATA_ROOT
          const developmentDataRoot = app.isPackaged
            ? undefined
            : path.resolve(app.getAppPath(), '..', 'MCPWorkers', '.mcpworkers')
          const dataRoot = configuredDataRoot || environmentDataRoot || developmentDataRoot
          if (!dataRoot) return null

          try {
            const [entryStat, rootStat] = await Promise.all([
              fs.lstat(managerEntry),
              fs.lstat(dataRoot),
            ])
            if (entryStat.isSymbolicLink() || !entryStat.isFile()
              || rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null

            const registryDirectory = path.join(dataRoot, 'registry')
            const registryPath = path.join(registryDirectory, 'registry.json')
            const authDirectory = path.join(dataRoot, 'auth')
            const authTokenPath = path.join(authDirectory, 'daemon.token')
            const [registryDirectoryStat, registryStat, authDirectoryStat, authTokenStat] = await Promise.all([
              fs.lstat(registryDirectory),
              fs.lstat(registryPath),
              fs.lstat(authDirectory).catch(() => null),
              fs.lstat(authTokenPath).catch(() => null),
            ])
            if (!registryDirectoryStat.isDirectory() || registryDirectoryStat.isSymbolicLink()
              || !registryStat.isFile() || registryStat.isSymbolicLink()
              || (authDirectoryStat && (!authDirectoryStat.isDirectory() || authDirectoryStat.isSymbolicLink()))
              || (authTokenStat && (!authTokenStat.isFile() || authTokenStat.isSymbolicLink()))) return null
          } catch {
            return null
          }

          return {
            executablePath: process.execPath,
            args: [managerEntry, 'serve'],
            workingDirectory: path.dirname(managerEntry),
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              MCPWORKERS_DATA_ROOT: path.resolve(dataRoot),
            },
          }
        },
      })
      runtime.adapterRegistry.register(createMcpWorkersManagerAdapter(mcpWorkersManagerRuntime))
      const existingManagerService = await runtime.registry.get(MCPWORKERS_MANAGER_SERVICE.id)
      if (!existingManagerService) {
        await runtime.registerService(MCPWORKERS_MANAGER_SERVICE)
      } else if (existingManagerService.adapterId !== MCPWORKERS_MANAGER_SERVICE.adapterId) {
        throw new Error('The registered MCPWorkers Manager service uses an incompatible Runtime adapter.')
      }
      registerMcpWorkersHandlers(mcpWorkersClient, {
        managerRuntime: mcpWorkersManagerRuntime,
        managerConfig: mcpWorkersManagerConfig,
      })

      const karakeep = new KarakeepStorageProvider(undefined, secretProviders)
      await Promise.all([storage.initialize(), karakeep.initialize()])
      registerStorageHandlers(storage, karakeep)

      runtimeInitialized = true
      createWindow()
      void mcpWorkersManagerRuntime.startOrAttach().then((state) => {
        if (state.state === 'blocked' || state.state === 'unavailable') {
          console.warn('[DevKit MCPWorkers] ' + state.detail)
        }
      }).catch((error: unknown) => {
        console.error('[DevKit MCPWorkers] Runtime startup failed:', error)
      })
      startPeriodicCheck(6)
    } catch (err) {
      logStartupError(err)
      // Do not expose a partially initialized workspace to the renderer.
      app.quit()
      return
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        try {
          createWindow()
        } catch (err) {
          logStartupError(err)
        }
      }
    })
  }).catch((err: unknown) => {
    logStartupError(err)
    app.quit()
  })

  app.on('before-quit', (event) => {
    stopPeriodicCheck()
    mcpWorkersClient?.dispose()
    void secretProviders?.dispose()
    if (allowQuitAfterMcpCleanup) return
    event.preventDefault()
    void Promise.all([
      mcpHub?.closeAll() ?? Promise.resolve(),
      mcpWorkersManagerRuntime?.shutdown() ?? Promise.resolve(),
    ])
      .catch((error: unknown) => console.error('[DevKit Runtime] Could not complete managed shutdown:', error))
      .finally(() => {
        allowQuitAfterMcpCleanup = true
        app.quit()
      })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

// Log uncaught exceptions in the main process
process.on('uncaughtException', (err) => {
  const timestamp = new Date().toISOString()
  console.error('[' + timestamp + '] Electron main process uncaught exception:')
  console.error(err)
})

process.on('unhandledRejection', (reason) => {
  const timestamp = new Date().toISOString()
  console.error('[' + timestamp + '] Electron main process unhandled rejection:')
  console.error('  Reason: ' + String(reason))
})
