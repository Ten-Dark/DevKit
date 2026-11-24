import { dialog } from 'electron'
import { mainWindow } from '../window.js'
import type { LocalIntegrationId } from './local-integrations.js'
import { LocalIntegrationsManager } from './local-integrations.js'
import { registerTrustedRuntimeIpcHandler } from '../core/secure-ipc.js'

function assertIntegrationId(value: unknown): asserts value is LocalIntegrationId {
  if (!['localmcp', 'localmcp-tunnel', 'chat2agent'].includes(String(value))) {
    throw new Error('Invalid local integration identifier.')
  }
}

export function registerLocalIntegrationHandlers(manager: LocalIntegrationsManager): void {
  registerTrustedRuntimeIpcHandler('integrations:getStatuses', async () => manager.getStatuses())

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

  registerTrustedRuntimeIpcHandler('integrations:start', async (_event, id: unknown) => {
    assertIntegrationId(id)
    return manager.start(id)
  })

  registerTrustedRuntimeIpcHandler('integrations:stop', async (_event, id: unknown) => {
    assertIntegrationId(id)
    return manager.stop(id)
  })
}
