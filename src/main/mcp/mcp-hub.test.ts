import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from('encrypted:' + value, 'utf8')),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^encrypted:/, '')),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/devkit-test-user-data'),
    getVersion: vi.fn(() => '1.0.0'),
  },
  safeStorage: safeStorageMock,
}))

import { McpHubManager, resolveStdioLaunch } from './mcp-hub.js'

let tempDir: string
let filePath: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(process.cwd(), '.mcp-hub-test-'))
  filePath = path.join(tempDir, 'registry', 'mcp-connections.json')
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.decryptString.mockClear()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('MCP hub connection storage', () => {
  it('persists remote connection metadata but encrypts full URLs and header values', async () => {
    const manager = new McpHubManager(filePath)
    const connection = await manager.addConnection({
      name: 'Private remote MCP',
      source: 'manual',
      transport: {
        type: 'streamable-http',
        url: 'https://mcp.example.com/mcp/secret-path-token',
        headers: { Authorization: 'Bearer secret-test-token' },
      },
    })

    const document = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      connections: Array<{ encryptedSecrets: string }>
    }
    const persisted = JSON.stringify(document)
    const decryptedPayload = Buffer.from(document.connections[0].encryptedSecrets, 'base64').toString('utf8')

    expect(connection).toMatchObject({
      transportType: 'streamable-http',
      state: 'disconnected',
      endpointOrigin: 'https://mcp.example.com',
      headerKeys: ['Authorization'],
    })
    expect(connection).not.toHaveProperty('headers')
    expect(connection).not.toHaveProperty('url')
    expect(persisted).not.toContain('secret-path-token')
    expect(persisted).not.toContain('secret-test-token')
    expect(decryptedPayload).toContain('secret-path-token')
    expect(decryptedPayload).toContain('secret-test-token')
    expect(safeStorageMock.encryptString).toHaveBeenCalledOnce()

    const reloaded = await new McpHubManager(filePath).listConnections()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]).toMatchObject({ id: connection.id, state: 'disconnected', headerKeys: ['Authorization'] })
  })

  it('stores stdio arguments and environment values encrypted and exposes only their keys/count', async () => {
    const manager = new McpHubManager(filePath)
    const connection = await manager.addConnection({
      name: 'Local MCP',
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['server.js', '--token', 'argument-secret'],
        cwd: tempDir,
        env: { API_TOKEN: 'plain-secret-value', FEATURE_FLAG: 'true' },
      },
    })
    const persisted = await fs.readFile(filePath, 'utf8')

    expect(connection.envKeys).toEqual(['API_TOKEN', 'FEATURE_FLAG'])
    expect(connection.argumentCount).toBe(3)
    expect(connection).not.toHaveProperty('args')
    expect(persisted).not.toContain('plain-secret-value')
    expect(persisted).not.toContain('argument-secret')
    expect(persisted).not.toContain('"true"')
  })

  it('allows a local process without secrets when OS encryption is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const manager = new McpHubManager(filePath)

    const connection = await manager.addConnection({
      name: 'Local process without credentials',
      transport: { type: 'stdio', command: process.execPath, args: [], cwd: tempDir },
    })

    expect(connection.state).toBe('disconnected')
    expect(connection.envKeys).toEqual([])
    expect(connection.headerKeys).toEqual([])
    expect(connection.argumentCount).toBe(0)
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()

    await expect(manager.addConnection({
      name: 'Remote URL must be encrypted',
      transport: { type: 'streamable-http', url: 'https://mcp.example.com/mcp' },
    })).rejects.toThrow('cannot be saved safely')
  })
  it('refuses to save secrets when OS-backed encryption is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const manager = new McpHubManager(filePath)

    await expect(manager.addConnection({
      name: 'Credentialed MCP',
      transport: {
        type: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer secret' },
      },
    })).rejects.toThrow('cannot be saved safely')
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects remote HTTP endpoints, embedded credentials, query tokens and invalid headers', async () => {
    const manager = new McpHubManager(filePath)

    await expect(manager.addConnection({
      name: 'Insecure endpoint',
      transport: { type: 'streamable-http', url: 'http://mcp.example.com/mcp' },
    })).rejects.toThrow('must use HTTPS')

    await expect(manager.addConnection({
      name: 'Credential in URL',
      transport: { type: 'streamable-http', url: 'https://user:password@mcp.example.com/mcp' },
    })).rejects.toThrow('cannot contain credentials')

    await expect(manager.addConnection({
      name: 'Query token URL',
      transport: { type: 'streamable-http', url: 'https://mcp.example.com/mcp?token=secret' },
    })).rejects.toThrow('query parameters')

    await expect(manager.addConnection({
      name: 'Invalid header',
      transport: {
        type: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: { 'Bad Header': 'value' },
      },
    })).rejects.toThrow('Invalid HTTP header name')
  })

  it('resolves Registry npx packages through a Windows command processor without shell injection characters', () => {
    expect(resolveStdioLaunch('npx', ['--yes', '@example/filesystem@1.2.3'], 'registry', 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npx --yes @example/filesystem@1.2.3'],
    })
    expect(resolveStdioLaunch('npx', ['--yes', '@example/filesystem@1.2.3'], 'registry', 'linux')).toEqual({
      command: 'npx',
      args: ['--yes', '@example/filesystem@1.2.3'],
    })
    expect(() => resolveStdioLaunch('npx', ['--yes', 'pkg@1.2.3', '& whoami'], 'registry', 'win32')).toThrow('failed validation')
  })

  it('saves a valid Registry package descriptor without exposing its package arguments', async () => {
    const manager = new McpHubManager(filePath)
    const connection = await manager.addConnection({
      name: 'Filesystem MCP',
      source: 'registry',
      registryName: 'io.example/filesystem',
      registryVersion: '1.2.3',
      transport: { type: 'stdio', command: 'npx', args: ['--yes', '@example/filesystem@1.2.3'], cwd: tempDir },
    })
    const persisted = await fs.readFile(filePath, 'utf8')
    expect(connection).toMatchObject({ source: 'registry', command: 'npx', argumentCount: 2, state: 'disconnected' })
    expect(connection).not.toHaveProperty('args')
    expect(persisted).not.toContain('@example/filesystem@1.2.3')
  })
  it('rejects unsafe package commands submitted as official Registry installs', async () => {
    const manager = new McpHubManager(filePath)
    await expect(manager.addConnection({
      name: 'Registry package with injected shell args',
      source: 'registry',
      registryName: 'io.example/server',
      registryVersion: '1.0.0',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['--yes', 'safe-package@1.0.0', '& whoami'],
        cwd: tempDir,
      },
    })).rejects.toThrow('failed validation')

    await expect(manager.addConnection({
      name: 'Registry package from different runtime',
      source: 'registry',
      registryName: 'io.example/server',
      registryVersion: '1.0.0',
      transport: { type: 'stdio', command: 'cmd.exe', args: ['/c', 'echo unsafe'], cwd: tempDir },
    })).rejects.toThrow('failed validation')
  })
  it('allows only loopback HTTP endpoints', async () => {
    const manager = new McpHubManager(filePath)

    const connection = await manager.addConnection({
      name: 'Local HTTP MCP',
      transport: { type: 'streamable-http', url: 'http://127.0.0.1:4317/mcp' },
    })

    expect(connection.endpointOrigin).toBe('http://127.0.0.1:4317')
  })

  it('requires connections to be disconnected before removal', async () => {
    const manager = new McpHubManager(filePath)
    const connection = await manager.addConnection({
      name: 'Public MCP',
      transport: { type: 'streamable-http', url: 'https://mcp.example.com/mcp' },
    })

    expect(await manager.removeConnection(connection.id)).toBe(true)
    expect(await manager.listConnections()).toEqual([])
  })

  it('connects to a local stdio MCP process, discovers tools and disconnects', async () => {
    const serverPath = path.join(tempDir, 'fixture-server.mjs')
    await fs.writeFile(serverPath, [
      "import { Server } from '@modelcontextprotocol/sdk/server/index.js'",
      "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
      "import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
      "const server = new Server({ name: 'fixture-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })",
      "server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'ping', description: 'Health check', inputSchema: { type: 'object', properties: {} } }] }))",
      'await server.connect(new StdioServerTransport())',
    ].join('\n'), 'utf8')

    const manager = new McpHubManager(filePath)
    const saved = await manager.addConnection({
      name: 'Fixture MCP',
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        cwd: tempDir,
      },
    })

    const connected = await manager.connect(saved.id)
    expect(connected).toMatchObject({
      state: 'connected',
      serverInfo: { name: 'fixture-mcp', version: '1.0.0' },
      tools: [{ name: 'ping', description: 'Health check' }],
    })

    const disconnected = await manager.disconnect(saved.id)
    expect(disconnected.state).toBe('disconnected')
    expect(disconnected.tools).toEqual([])
  })
  it('drains stdio diagnostics without logging credential-bearing arguments', async () => {
    const serverPath = path.join(tempDir, 'stderr-secret-server.mjs')
    const secretArgument = 'credential-argument-that-must-never-appear-in-logs'
    await fs.writeFile(serverPath, [
      "process.stderr.write(process.argv[2].slice(0, 12))",
      "process.stderr.write(process.argv[2].slice(12) + String.fromCharCode(10))",
      "import { Server } from '@modelcontextprotocol/sdk/server/index.js'",
      "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
      "import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
      "const server = new Server({ name: 'stderr-secret-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })",
      "server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))",
      'await server.connect(new StdioServerTransport())',
    ].join('\n'), 'utf8')

    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const manager = new McpHubManager(filePath)
    const saved = await manager.addConnection({
      name: 'Stderr secret fixture',
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath, secretArgument],
        cwd: tempDir,
      },
    })

    const connected = await manager.connect(saved.id)
    expect(connected.state).toBe('connected')
    expect(log).not.toHaveBeenCalled()
    await manager.disconnect(saved.id)
  })

  it('coalesces concurrent connection attempts for the same server', async () => {
    const serverPath = path.join(tempDir, 'single-flight-server.mjs')
    const pidFile = path.join(tempDir, 'server-pids.txt')
    await fs.writeFile(serverPath, [
      "import { appendFileSync } from 'node:fs'",
      "import { Server } from '@modelcontextprotocol/sdk/server/index.js'",
      "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
      "import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
      "appendFileSync(process.env.DEVKIT_TEST_PID_FILE, String(process.pid) + '\\n')",
      "const server = new Server({ name: 'single-flight-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })",
      "server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'pid', description: String(process.pid), inputSchema: { type: 'object', properties: {} } }] }))",
      'await server.connect(new StdioServerTransport())',
    ].join('\n'), 'utf8')

    const manager = new McpHubManager(filePath)
    const saved = await manager.addConnection({
      name: 'Single-flight fixture',
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        cwd: tempDir,
        env: { DEVKIT_TEST_PID_FILE: pidFile },
      },
    })

    const [first, second] = await Promise.all([manager.connect(saved.id), manager.connect(saved.id)])
    expect(first.state).toBe('connected')
    expect(second.state).toBe('connected')
    expect(first.tools).toEqual(second.tools)
    const pids = (await fs.readFile(pidFile, 'utf8')).trim().split(/\r?\n/)
    expect(pids).toHaveLength(1)
    await manager.disconnect(saved.id)
  })

  it('disconnects and removes a server while its tool discovery is still pending', async () => {
    const serverPath = path.join(tempDir, 'disconnect-pending-server.mjs')
    const pidFile = path.join(tempDir, 'disconnect-pending-server-pid.txt')
    await fs.writeFile(serverPath, [
      "import { writeFileSync } from 'node:fs'",
      "import { Server } from '@modelcontextprotocol/sdk/server/index.js'",
      "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
      "import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
      "writeFileSync(process.env.DEVKIT_TEST_PID_FILE, String(process.pid))",
      "const server = new Server({ name: 'disconnect-pending-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })",
      "server.setRequestHandler(ListToolsRequestSchema, async () => { await new Promise((resolve) => setTimeout(resolve, 10_000)); return { tools: [] } })",
      'await server.connect(new StdioServerTransport())',
    ].join('\n'), 'utf8')

    const manager = new McpHubManager(filePath, { connectMs: 3_000, listToolsMs: 15_000, cleanupMs: 1_000 })
    const saved = await manager.addConnection({
      name: 'Disconnect pending fixture',
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        cwd: tempDir,
        env: { DEVKIT_TEST_PID_FILE: pidFile },
      },
    })

    const connecting = manager.connect(saved.id)
    const pidDeadline = Date.now() + 3_000
    while (Date.now() < pidDeadline) {
      try {
        await fs.access(pidFile)
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    const pid = Number(await fs.readFile(pidFile, 'utf8'))
    await expect(manager.removeConnection(saved.id)).rejects.toThrow(/Disconnect this MCP server/)
    const disconnected = await manager.disconnect(saved.id)
    const connectionResult = await connecting

    expect(disconnected.state).toBe('disconnected')
    expect(connectionResult.state).toBe('disconnected')
    expect(await manager.removeConnection(saved.id)).toBe(true)
    expect(await manager.listConnections()).toEqual([])

    const deadline = Date.now() + 3_000
    let exited = false
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch {
        exited = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(exited).toBe(true)
  })

  it('closes an in-flight stdio connection before shutdown completes', async () => {
    const serverPath = path.join(tempDir, 'shutdown-server.mjs')
    const pidFile = path.join(tempDir, 'shutdown-server-pid.txt')
    await fs.writeFile(serverPath, [
      "import { writeFileSync } from 'node:fs'",
      "import { Server } from '@modelcontextprotocol/sdk/server/index.js'",
      "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
      "import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
      "writeFileSync(process.env.DEVKIT_TEST_PID_FILE, String(process.pid))",
      "const server = new Server({ name: 'shutdown-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })",
      "server.setRequestHandler(ListToolsRequestSchema, async () => { await new Promise((resolve) => setTimeout(resolve, 1_000)); return { tools: [] } })",
      'await server.connect(new StdioServerTransport())',
    ].join('\n'), 'utf8')

    const manager = new McpHubManager(filePath)
    const saved = await manager.addConnection({
      name: 'Shutdown fixture',
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        cwd: tempDir,
        env: { DEVKIT_TEST_PID_FILE: pidFile },
      },
    })

    const connecting = manager.connect(saved.id)
    const pidDeadline = Date.now() + 2_000
    while (Date.now() < pidDeadline) {
      try {
        await fs.access(pidFile)
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    const pid = Number(await fs.readFile(pidFile, 'utf8'))
    const shutdown = manager.closeAll()
    const result = await connecting
    await shutdown

    expect(result.state).toBe('disconnected')
    const deadline = Date.now() + 3_000
    let exited = false
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch {
        exited = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(exited).toBe(true)
    await expect(manager.connect(saved.id)).rejects.toThrow('shutting down')
  })

  it('times out an unresponsive remote handshake and cleans up the transport', async () => {
    const server = createServer(() => undefined)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test HTTP server did not bind.')

    try {
      const manager = new McpHubManager(filePath, { connectMs: 100, listToolsMs: 100, cleanupMs: 100 })
      const saved = await manager.addConnection({
        name: 'Unresponsive HTTP fixture',
        transport: { type: 'streamable-http', url: 'http://127.0.0.1:' + address.port + '/mcp' },
      })
      const result = await manager.connect(saved.id)
      expect(result.state).toBe('error')
      expect(result.error).toContain('timed out')
      await manager.closeAll()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('force-terminates an unresponsive stdio child during shutdown without leaving an orphan', async () => {
    const serverPath = path.join(tempDir, 'shutdown-stubborn-server.mjs')
    const pidFile = path.join(tempDir, 'shutdown-stubborn-server-pid.txt')
    await fs.writeFile(serverPath, [
      "import { writeFileSync } from 'node:fs'",
      "import { Server } from '@modelcontextprotocol/sdk/server/index.js'",
      "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
      "import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
      "writeFileSync(process.env.DEVKIT_TEST_PID_FILE, String(process.pid))",
      "process.on('SIGTERM', () => {})",
      "setInterval(() => undefined, 1_000)",
      "const server = new Server({ name: 'shutdown-stubborn-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })",
      "server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))",
      "await server.connect(new StdioServerTransport())",
    ].join('\n'), 'utf8')

    const manager = new McpHubManager(filePath, { cleanupMs: 7_000 })
    const saved = await manager.addConnection({
      name: 'Shutdown stubborn fixture',
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        cwd: tempDir,
        env: { DEVKIT_TEST_PID_FILE: pidFile },
      },
    })

    const connected = await manager.connect(saved.id)
    expect(connected.state).toBe('connected')
    const pid = Number(await fs.readFile(pidFile, 'utf8'))

    await manager.closeAll()

    const deadline = Date.now() + 3_000
    let exited = false
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch {
        exited = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(exited).toBe(true)
  })
})
