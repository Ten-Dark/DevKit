import type { IpcMainInvokeEvent } from 'electron'
import { registerIpcHandler } from '../ipc-registry.js'
export { isTrustedIpcSender as isTrustedRuntimeIpcSender } from '../ipc-security.js'

/**
 * Keeps the Runtime registration API explicit while relying on the central
 * IPC registry for the actual sender-origin enforcement.
 */
export function registerTrustedRuntimeIpcHandler<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): void {
  registerIpcHandler<Args, Result>(channel, handler)
}
