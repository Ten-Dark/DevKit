import { registerTrustedRuntimeIpcHandler } from '../core/secure-ipc.js'
import { promptForSecureConsolePassword } from '../secrets/secure-console-prompt.js'
import type { KarakeepStorageProvider } from './karakeep-provider.js'
import type { ObsidianVaultStorageProvider } from './storage-manager.js'

export interface StorageHandlerOptions {
  promptForPassword?: () => Promise<string>
}

export function registerStorageHandlers(
  storage: ObsidianVaultStorageProvider,
  karakeep: KarakeepStorageProvider,
  options: StorageHandlerOptions = {},
): void {
  const promptForPassword = options.promptForPassword ?? promptForSecureConsolePassword
  registerTrustedRuntimeIpcHandler('storage:getStatus', async () => storage.getStatus())
  registerTrustedRuntimeIpcHandler('storage:selectAndConnect', async () => storage.selectAndConnect())
  registerTrustedRuntimeIpcHandler('storage:disconnect', async () => storage.disconnect())
  registerTrustedRuntimeIpcHandler('storage:list', async (_event, relativePath: unknown, limit: unknown) => {
    if (relativePath !== undefined && typeof relativePath !== 'string') throw new Error('Storage path must be a string.')
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) {
      throw new Error('Storage listing limit must be between 1 and 100.')
    }
    return storage.list(relativePath as string | undefined, limit as number | undefined)
  })
  registerTrustedRuntimeIpcHandler('storage:search', async (_event, query: unknown, limit: unknown) => {
    if (typeof query !== 'string' || query.length > 120) throw new Error('Storage search query is invalid.')
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) {
      throw new Error('Storage search limit must be between 1 and 100.')
    }
    return storage.search(query, limit as number | undefined)
  })
  registerTrustedRuntimeIpcHandler('storage:getMetadata', async (_event, relativePath: unknown) => {
    if (typeof relativePath !== 'string' || relativePath.length > 2_048) throw new Error('Storage entry path is invalid.')
    return storage.getMetadata(relativePath)
  })
  registerTrustedRuntimeIpcHandler('storage:read', async (_event, relativePath: unknown) => {
    if (typeof relativePath !== 'string' || relativePath.length > 2_048) throw new Error('Storage note path is invalid.')
    return storage.read(relativePath)
  })

  registerTrustedRuntimeIpcHandler('storage:karakeep:getStatus', async () => karakeep.getStatus())
  registerTrustedRuntimeIpcHandler('storage:karakeep:connectWithSecretReference', async (_event, baseUrl: unknown, reference: unknown) => {
    const password = await promptForPassword()
    return karakeep.connectWithSecretReference(baseUrl, reference, password)
  })
  registerTrustedRuntimeIpcHandler('storage:karakeep:disconnect', async () => karakeep.disconnect())
}
