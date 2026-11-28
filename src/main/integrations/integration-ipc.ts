import { dialog } from 'electron'
import { mainWindow } from '../window.js'
import type { LocalIntegrationId } from './local-integrations.js'
import { LocalIntegrationsManager } from './local-integrations.js'
import { MultiAggregatorManager } from './multiaggregator-manager.js'
import { McpWorkersClient } from './mcpworkers-client.js'
import { McpWorkersManagerRuntime } from './mcpworkers-manager-runtime.js'
import { McpWorkersManagerRuntimeConfigStore } from './mcpworkers-manager-config.js'
import { promptForSecureConsolePassword } from '../secrets/secure-console-prompt.js'
import { registerTrustedRuntimeIpcHandler } from '../core/secure-ipc.js'

function assertIntegrationId(value: unknown): asserts value is LocalIntegrationId {
  if (value !== 'multiaggregator') {
    throw new Error('Only the Multi-AI Aggregator desktop integration is managed through this interface. MCP lifecycle belongs to MCPWorkers.')
  }
}

export function registerLocalIntegrationHandlers(
  manager: LocalIntegrationsManager,
  multiAggregator: MultiAggregatorManager,
): void {
  registerTrustedRuntimeIpcHandler('integrations:getStatuses', async () => {
    const snapshot = await manager.getStatuses()
    const multiAggregatorStatus = await multiAggregator.getStatus()
    return { ...snapshot, integrations: [...snapshot.integrations, multiAggregatorStatus] }
  })

  registerTrustedRuntimeIpcHandler('integrations:setProjectsRoot', async (_event, directory: unknown) => {
    return manager.setProjectsRoot(directory)
  })

  registerTrustedRuntimeIpcHandler('integrations:selectProjectsRoot', async () => {
    const options = { properties: ['openDirectory'] as Array<'openDirectory'> }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  registerTrustedRuntimeIpcHandler('integrations:selectMultiAggregatorExecutable', async () => {
    const options = {
      title: 'Select Multi-AI Aggregator executable',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Multi-AI Aggregator', extensions: ['exe'] }],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return multiAggregator.setExecutable(result.filePaths[0])
  })

  registerTrustedRuntimeIpcHandler('integrations:clearMultiAggregatorExecutable', async () => {
    return multiAggregator.clearExecutable()
  })

  registerTrustedRuntimeIpcHandler('integrations:start', async (_event, id: unknown) => {
    assertIntegrationId(id)
    return multiAggregator.start()
  })

  registerTrustedRuntimeIpcHandler('integrations:stop', async (_event, id: unknown) => {
    assertIntegrationId(id)
    return multiAggregator.stop()
  })
}

export interface McpWorkersHandlerOptions {
  promptForPassword?: () => Promise<string>;
  managerRuntime?: McpWorkersManagerRuntime;
  managerConfig?: McpWorkersManagerRuntimeConfigStore;
}

export function registerMcpWorkersHandlers(
  client: McpWorkersClient,
  options: McpWorkersHandlerOptions = {},
): void {
  const promptForPassword = options.promptForPassword ?? promptForSecureConsolePassword;

  registerTrustedRuntimeIpcHandler('mcpworkers:getHealth', async () => client.getHealth())

  if (options.managerRuntime && options.managerConfig) {
    registerTrustedRuntimeIpcHandler('mcpworkers:getManagerRuntimeStatus', async () => {
      await options.managerRuntime!.refreshState()
      return {
        dataRoot: options.managerConfig!.getDataRoot(),
        runtime: options.managerRuntime!.getState(),
      }
    })
    registerTrustedRuntimeIpcHandler('mcpworkers:selectManagerDataRoot', async () => {
      const dialogOptions = {
        title: 'Choose the existing MCPWorkers storage folder',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory'] as Array<'openDirectory'>,
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      const selectedPath = result.canceled ? null : result.filePaths[0] ?? null
      if (!selectedPath) return null
      await options.managerConfig!.setDataRoot(selectedPath)
      const runtime = await options.managerRuntime!.refreshState()
      return {
        dataRoot: options.managerConfig!.getDataRoot(),
        runtime,
      }
    })
    registerTrustedRuntimeIpcHandler('mcpworkers:startManager', async () => options.managerRuntime!.startOrAttach())
    registerTrustedRuntimeIpcHandler('mcpworkers:stopManager', async () => options.managerRuntime!.shutdown())
  }
  registerTrustedRuntimeIpcHandler('mcpworkers:getConnectionStatus', async () => client.getConnectionStatus())
  registerTrustedRuntimeIpcHandler('mcpworkers:connect', async (_event, reference: unknown) => {
    const password = await promptForPassword()
    return client.connect(reference, password)
  })
  registerTrustedRuntimeIpcHandler('mcpworkers:unlock', async () => {
    const password = await promptForPassword()
    return client.unlock(password)
  })
  registerTrustedRuntimeIpcHandler('mcpworkers:disconnect', async () => client.disconnect())
  registerTrustedRuntimeIpcHandler('mcpworkers:getSnapshot', async () => client.getSnapshot())
  registerTrustedRuntimeIpcHandler('mcpworkers:checkHealth', async (_event, instanceId: unknown) => {
    if (typeof instanceId !== 'string') throw new Error('MCPWorkers Instance ID is required.')
    return client.checkInstanceHealth(instanceId)
  })
  registerTrustedRuntimeIpcHandler('mcpworkers:lifecycle', async (_event, instanceId: unknown, action: unknown) => {
    if (typeof instanceId !== 'string' || !['start', 'stop', 'restart'].includes(String(action))) {
      throw new Error('A valid MCPWorkers Instance ID and lifecycle action are required.')
    }
    return client.lifecycle(instanceId, action as 'start' | 'stop' | 'restart')
  })
}
