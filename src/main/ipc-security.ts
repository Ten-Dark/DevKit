import { app, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1'
}

/** Returns true only for the application's top-level renderer document. */
export function isTrustedRendererUrl(url: string): boolean {
  try {
    const senderUrl = new URL(url)
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

export function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  return Boolean(frame && frame.parent === null && isTrustedRendererUrl(frame.url))
}
