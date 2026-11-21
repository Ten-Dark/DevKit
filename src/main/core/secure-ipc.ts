import { app, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpcHandler } from '../ipc-registry.js'

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1'
}

export function isTrustedRuntimeIpcSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent !== null) return false

  try {
    const senderUrl = new URL(frame.url)
    if (senderUrl.protocol === 'http:' || senderUrl.protocol === 'https:') {
      const configuredDevUrl = new URL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173')
      return (
        senderUrl.origin === configuredDevUrl.origin &&
        isLoopback(senderUrl.hostname) &&
        senderUrl.pathname === '/' &&
        !senderUrl.username &&
        !senderUrl.password
      )
    }

    if (senderUrl.protocol === 'file:') {
      const actualPath = path.resolve(fileURLToPath(senderUrl))
      const expectedPath = path.resolve(app.getAppPath(), 'dist-electron', 'renderer', 'index.html')
      return actualPath.toLowerCase() === expectedPath.toLowerCase()
    }
  } catch {
    return false
  }
  return false
}

export function registerTrustedRuntimeIpcHandler<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): void {
  registerIpcHandler<Args, Result>(channel, async (event: IpcMainInvokeEvent, ...args: Args): Promise<Result> => {
    if (!isTrustedRuntimeIpcSender(event)) {
      throw new Error('Access denied: runtime IPC is available only to the trusted main renderer.')
    }
    return handler(event, ...args)
  })
}
