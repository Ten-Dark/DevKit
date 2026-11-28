import { dialog, type IpcMainInvokeEvent } from 'electron'
import { mainWindow } from '../window.js'
import type { McpConnectionInput } from '../../shared/mcp.js'
import { registerTrustedRuntimeIpcHandler } from '../core/secure-ipc.js'
import { McpHubManager } from './mcp-hub.js'
import { McpRegistryClient } from './registry-client.js'

function assertConnectionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
    throw new Error('Invalid MCP connection identifier.')
  }
}

function assertRegistryName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\r\n]/.test(value)) {
    throw new Error('Invalid MCP Registry server name.')
  }
}

export function registerMcpHandlers(hub: McpHubManager, registry = new McpRegistryClient()): void {
  registerTrustedRuntimeIpcHandler('mcp:listConnections', async (_event: IpcMainInvokeEvent) => {
    return hub.listConnections()
  })

  registerTrustedRuntimeIpcHandler('mcp:searchRegistry', async (_event, query: unknown, cursor: unknown) => {
    if (typeof query !== 'string' || query.length > 120) throw new Error('Registry search query is invalid.')
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 1_024)) {
      throw new Error('Registry cursor is invalid.')
    }
    return registry.search(query, cursor as string | undefined)
  })

  registerTrustedRuntimeIpcHandler('mcp:getRegistryServer', async (_event, name: unknown, version: unknown) => {
    assertRegistryName(name)
    if (version !== undefined && (typeof version !== 'string' || version.length > 128)) {
      throw new Error('Invalid MCP Registry version.')
    }
    return registry.getServer(name, version as string | undefined)
  })

  registerTrustedRuntimeIpcHandler('mcp:addConnection', async (_event, input: unknown) => {
    return hub.addConnection(input as McpConnectionInput)
  })

  registerTrustedRuntimeIpcHandler('mcp:connect', async (_event, id: unknown) => {
    assertConnectionId(id)
    const connection = (await hub.listConnections()).find((item) => item.id === id)
    if (!connection) throw new Error('MCP connection was not found.')

    const isLocalProcess = connection.transportType === 'stdio'
    const detail = isLocalProcess
      ? 'DevKit will launch ' + (connection.registryName || connection.command || 'the configured local executable') + '. It runs with your Windows user permissions and may access files, network resources, and environment variables available to it. Continue only if you trust its source.'
      : 'DevKit will contact ' + (connection.endpointOrigin || 'the configured remote endpoint') + '. Connection and discovery requests will be sent to this third-party provider. Continue only if you trust the endpoint and its privacy policy.'
    const options = {
      type: 'warning' as const,
      title: 'Confirm MCP connection',
      message: 'Connect to ' + connection.name + '?',
      detail,
      buttons: ['Cancel', 'Connect'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }
    const confirmation = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    if (confirmation.response !== 1) return null
    return hub.connect(id)
  })

  registerTrustedRuntimeIpcHandler('mcp:disconnect', async (_event, id: unknown) => {
    assertConnectionId(id)
    return hub.disconnect(id)
  })

  registerTrustedRuntimeIpcHandler('mcp:removeConnection', async (_event, id: unknown) => {
    assertConnectionId(id)
    return hub.removeConnection(id)
  })

  registerTrustedRuntimeIpcHandler('mcp:selectWorkingDirectory', async () => {
    const options = { properties: ['openDirectory'] as Array<'openDirectory'> }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
}
