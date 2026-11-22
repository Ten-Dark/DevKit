import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isTrustedIpcSender } from './ipc-security.js'

// Tracks registered IPC channel names to prevent double registration.
// Electron throws "Handler already registered" if ipcMain.handle is called
// twice for the same channel. This registry fails fast at registration time
// instead of at runtime in production.
const registeredChannels = new Set<string>()

/**
 * Registers an IPC handler with double-registration protection and a
 * central trusted-renderer gate. Individual handlers must still validate
 * their arguments and enforce operation-specific authorization.
 */
export function registerIpcHandler<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): void {
  if (registeredChannels.has(channel)) {
    throw new Error(
      `IPC handler already registered for channel '${channel}'. ` +
        'Ensure register*Handlers() is called only once per application lifetime.',
    )
  }
  registeredChannels.add(channel)
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: Args): Promise<Result> => {
    if (!isTrustedIpcSender(event)) {
      throw new Error('Access denied: IPC is available only to the trusted main renderer.')
    }
    return handler(event, ...args)
  })
}

/**
 * Returns the set of currently registered channel names.
 * Useful for testing and diagnostics.
 */
export function getRegisteredChannels(): string[] {
  return [...registeredChannels]
}

/**
 * Clears the registry. Intended for test cleanup only.
 */
export function resetIpcRegistry(): void {
  registeredChannels.clear()
}
