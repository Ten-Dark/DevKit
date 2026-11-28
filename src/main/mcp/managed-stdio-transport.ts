import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Stream } from 'node:stream'
import { app } from 'electron'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { WindowsProcessControlProvider } from '../core/windows-process-control-provider.js'
import type { ManagedProcessHandle } from '../core/process-control-provider.js'

interface ManagedLaunchConfiguration {
  command: string
  args: string[]
  cwd: string
}

function resolveBootstrapPath(): string {
  const appPath = app.getAppPath()
  const root = appPath.toLowerCase().endsWith('.asar') ? appPath + '.unpacked' : appPath
  const bootstrapPath = path.join(root, 'dist-electron', 'main', 'mcp', 'stdio-bootstrap.cjs')
  if (!fs.existsSync(bootstrapPath)) {
    throw new Error('The managed MCP stdio bootstrap is missing from the application package.')
  }
  return bootstrapPath
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' timed out after ' + timeoutMs + ' ms.')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function readControlLine(socket: net.Socket, timeoutMs: number, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      socket.pause()
      clearTimeout(timer)
    }
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline < 0) {
        if (buffer.length > 2_048) {
          cleanup()
          reject(new Error('MCP stdio bootstrap returned an oversized control message.'))
        }
        return
      }
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      cleanup()
      resolve(line)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error('MCP stdio bootstrap closed its control channel unexpectedly.'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(label + ' timed out after ' + timeoutMs + ' ms.'))
    }, timeoutMs)
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
    socket.resume()
  })
}

export class ManagedStdioClientTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  sessionId?: string
  setProtocolVersion?: (version: string) => void

  private readonly inner: StdioClientTransport
  private readonly controlServer: net.Server
  private controlSocket?: net.Socket
  private controlConnection?: Promise<net.Socket>
  private processHandle?: ManagedProcessHandle
  private serverPid?: number
  private jobExit?: Promise<void>
  private cleanupPromise?: Promise<void>
  private closeNotified = false
  private started = false
  private closed = false

  constructor(
    private readonly launch: ManagedLaunchConfiguration,
    server: StdioServerParameters,
    private readonly processControl: WindowsProcessControlProvider,
    private readonly cleanupTimeoutMs = 5_000,
  ) {
    const pipePath = '\\\\.\\pipe\\devkit-mcp-' + randomUUID()
    this.controlServer = net.createServer((socket) => {
      if (this.controlSocket) {
        socket.destroy()
        return
      }
      this.controlSocket = socket
      socket.pause()
    })
    this.controlConnection = new Promise((resolve) => {
      this.controlServer.once('connection', resolve)
    })
    this.controlServer.on('error', (error) => this.onerror?.(error))

    this.inner = new StdioClientTransport({
      command: process.execPath,
      args: [resolveBootstrapPath(), pipePath],
      cwd: process.cwd(),
      env: { ...server.env, ELECTRON_RUN_AS_NODE: '1' },
      stderr: server.stderr ?? 'pipe',
      maxBufferSize: server.maxBufferSize,
    })
    this.inner.onmessage = (message) => this.onmessage?.(message)
    this.inner.onerror = (error) => this.onerror?.(error)
    this.inner.onclose = () => {
      void this.handleInnerClose()
    }
    this.pipePath = pipePath
  }

  private readonly pipePath: string

  get pid(): number | null {
    return this.serverPid ?? null
  }

  get stderr(): Stream | null {
    return this.inner.stderr
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('Managed MCP stdio transport already started.')
    if (this.closed) throw new Error('Managed MCP stdio transport is closed.')

    try {
      await new Promise<void>((resolve, reject) => {
        this.controlServer.once('error', reject)
        this.controlServer.listen(this.pipePath, resolve)
      })
      await this.inner.start()
      const socket = await withTimeout(this.controlConnection!, 5_000, 'MCP stdio bootstrap handshake')
      this.controlSocket = socket
      const ready = await readControlLine(socket, 5_000, 'MCP stdio bootstrap readiness')
      if (ready !== 'READY') throw new Error(ready.startsWith('ERROR ') ? ready.slice(6) : 'MCP stdio bootstrap did not become ready.')

      const pid = this.inner.pid
      if (!pid) throw new Error('MCP stdio bootstrap did not expose its process identifier.')
      const handle = this.processControl.attach(pid)
      this.processHandle = handle
      this.jobExit = new Promise<void>((resolve) => handle.once('exit', () => resolve()))
      handle.on('error', (error) => this.onerror?.(error))

      socket.write(JSON.stringify(this.launch) + '\n')
      const started = await readControlLine(socket, 10_000, 'MCP server process startup')
      const startedMatch = /^STARTED ([1-9][0-9]*)$/.exec(started)
      if (!startedMatch) throw new Error(started.startsWith('ERROR ') ? started.slice(6) : 'MCP server process did not start.')
      this.serverPid = Number(startedMatch[1])
      this.started = true
    } catch (error) {
      this.controlSocket?.destroy()
      await this.inner.close().catch(() => undefined)
      await this.cleanupJob().catch(() => undefined)
      throw error
    } finally {
      if (this.controlServer.listening) this.controlServer.close()
    }
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    return this.inner.send(message)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.inner.close().catch((error: unknown) => {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)))
    })
    await this.cleanupJob()
    this.controlSocket?.destroy()
    this.notifyClose()
  }

  private async cleanupJob(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise
    const handle = this.processHandle
    if (!handle || !this.jobExit) return
    this.cleanupPromise = (async () => {
      const settled = await withTimeout(this.jobExit!, 250, 'MCP process tree graceful exit')
        .then(() => true, () => false)
      if (!settled) {
        try {
          this.processControl.forceTerminate(handle)
        } catch (error) {
          const alreadyExited = await Promise.race([this.jobExit!.then(() => true), delay(50).then(() => false)])
          if (!alreadyExited) throw error
        }
      }
      await withTimeout(this.jobExit!, this.cleanupTimeoutMs, 'MCP process tree shutdown')
    })()
    return this.cleanupPromise
  }

  private async handleInnerClose(): Promise<void> {
    try {
      await this.cleanupJob()
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.notifyClose()
    }
  }

  private notifyClose(): void {
    if (this.closeNotified) return
    this.closeNotified = true
    this.onclose?.()
  }
}
