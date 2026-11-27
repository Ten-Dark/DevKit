import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/devkit-test-user-data'),
    getVersion: vi.fn(() => '1.0.0'),
  },
}))

import { LocalIntegrationsManager } from './local-integrations.js'

type FakeChild = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
}

function fakeChild(stdout: string, exitCode = 0): FakeChild {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    unref: vi.fn(),
  }) as FakeChild

  queueMicrotask(() => {
    child.stdout.end(stdout)
    child.stderr.end()
    child.emit('close', exitCode)
  })
  return child
}

function silentChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    unref: vi.fn(),
  }) as FakeChild
}

let tempDir: string
let projectsRoot: string
let settingsPath: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-local-integrations-'))
  projectsRoot = path.join(tempDir, 'Projects')
  settingsPath = path.join(tempDir, 'workspace', 'services', 'local-integrations.json')
  await fs.mkdir(projectsRoot, { recursive: true })
  spawnMock.mockReset()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('LocalIntegrationsManager', () => {
  it('reads all three external service states through one sanitized PowerShell snapshot', async () => {
    const snapshot = {
      localMcpAvailable: true,
      localMcpRunning: true,
      localMcpPid: 20884,
      chat2AgentAvailable: true,
      chat2AgentReady: true,
      chat2AgentManaged: true,
      chat2AgentLegacyOwned: false,
      chat2AgentKind: 'ready',
      chat2AgentPid: 2548,
      tunnelRunning: true,
    }
    spawnMock.mockImplementationOnce(() => fakeChild(JSON.stringify(snapshot) + '\r\n'))
    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const result = await manager.getStatuses()

    expect(result.projectsRoot).toBe(projectsRoot)
    expect(result.integrations).toMatchObject([
      { id: 'localmcp', state: 'running', pid: 20884, canStart: true, canStop: true },
      { id: 'localmcp-tunnel', state: 'running', canStart: true, canStop: false, stopHint: 'Switch to the Tunnel PowerShell window and press Ctrl+C. DevKit will not force-kill this session.' },
      { id: 'chat2agent', state: 'running', pid: 2548, canStart: false, canStop: true },
    ])
    expect(spawnMock).toHaveBeenCalledOnce()
    const [executable, args, options] = spawnMock.mock.calls[0] as [string, string[], { cwd: string }]
    expect(executable).toContain('WindowsPowerShell')
    expect(args).toContain('-Command')
    expect(args.join(' ')).toContain('--json')
    expect(args.join(' ')).toContain('managerOwned')
    expect(args.join(' ')).not.toContain('Public MCP URL:')
    expect(options.cwd).toBe(projectsRoot)
  })

  it('persists Projects root changes and restores them in a new manager instance', async () => {
    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const document = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    expect(document).toEqual({ schemaVersion: 1, projectsRoot })

    const restored = new LocalIntegrationsManager(settingsPath)
    await expect(restored.getProjectsRoot()).resolves.toBe(projectsRoot)
  })

  it('rejects relative or missing Projects roots', async () => {
    const manager = new LocalIntegrationsManager(settingsPath)
    await expect(manager.setProjectsRoot('Projects')).rejects.toThrow('absolute path')
    await expect(manager.setProjectsRoot(path.join(tempDir, 'missing'))).rejects.toThrow()
  })

  it('reports an error if the status helper exits unsuccessfully', async () => {
    spawnMock.mockImplementationOnce(() => fakeChild('', 1))
    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    await expect(manager.getStatuses()).rejects.toThrow('Could not query local integrations')
  })

  it('starts LocalMCP through its CLI and verifies the resulting status', async () => {
    vi.stubEnv('APPDATA', path.join(tempDir, 'AppData'))
    const snapshot = {
      localMcpAvailable: true,
      localMcpRunning: true,
      localMcpPid: 20884,
      chat2AgentAvailable: false,
      chat2AgentReady: false,
      tunnelRunning: false,
    }
    const cliOutput = [
      'Status: running',
      'PID: 20884',
      'Public endpoint: https://mcp.example.com/private-path',
    ].join(String.fromCharCode(10))
    spawnMock
      .mockImplementationOnce(() => fakeChild(cliOutput))
      .mockImplementationOnce(() => fakeChild(JSON.stringify(snapshot)))
    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const result = await manager.start('localmcp')

    expect(result).toMatchObject({ id: 'localmcp', state: 'running', pid: 20884 })
    expect(result.detail).not.toContain('https://')
    expect(spawnMock).toHaveBeenCalledTimes(2)
    const startArgs = spawnMock.mock.calls[0][1] as string[]
    expect(startArgs.join(' ')).toContain('localmcp.cmd')
    expect(startArgs.join(' ')).toMatch(/ start(?:\\s|$)/)
  })
  it('delegates Chat2Agent start and stop to its scripts and verifies each state', async () => {
    const chatRoot = path.join(projectsRoot, 'Chat2Agent')
    await fs.mkdir(chatRoot, { recursive: true })
    await fs.writeFile(path.join(chatRoot, 'package.json'), '{}')
    await fs.writeFile(path.join(chatRoot, 'start.bat'), '@echo off')
    await fs.writeFile(path.join(chatRoot, 'stop.bat'), '@echo off')

    const runningSnapshot = {
      localMcpAvailable: false,
      localMcpRunning: false,
      chat2AgentAvailable: true,
      chat2AgentReady: true,
      chat2AgentManaged: true,
      chat2AgentLegacyOwned: false,
      chat2AgentKind: 'ready',
      chat2AgentPid: 2548,
      tunnelRunning: false,
    }
    const stoppedSnapshot = {
      ...runningSnapshot,
      chat2AgentReady: false,
      chat2AgentManaged: false,
      chat2AgentKind: 'stopped',
      chat2AgentPid: undefined,
    }
    spawnMock
      .mockImplementationOnce(() => fakeChild('Chat2Agent started'))
      .mockImplementationOnce(() => fakeChild(JSON.stringify(runningSnapshot)))
      .mockImplementationOnce(() => fakeChild(JSON.stringify(runningSnapshot)))
      .mockImplementationOnce(() => fakeChild('Chat2Agent stopped'))
      .mockImplementationOnce(() => fakeChild(JSON.stringify(stoppedSnapshot)))

    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const started = await manager.start('chat2agent')
    const stopped = await manager.stop('chat2agent')

    expect(started).toMatchObject({ id: 'chat2agent', state: 'running', pid: 2548 })
    expect(stopped).toMatchObject({ id: 'chat2agent', state: 'stopped', canStop: false })
    expect(spawnMock).toHaveBeenCalledTimes(5)
    expect((spawnMock.mock.calls[0][1] as string[]).join(' ')).toContain('start.bat')
    expect((spawnMock.mock.calls[3][1] as string[]).join(' ')).toContain('stop.bat')
  })

  it('does not invoke the Chat2Agent stop script when the service is already stopped', async () => {
    spawnMock.mockImplementationOnce(() => fakeChild(JSON.stringify({
      localMcpAvailable: false,
      localMcpRunning: false,
      chat2AgentAvailable: true,
      chat2AgentReady: false,
      chat2AgentManaged: false,
      chat2AgentLegacyOwned: false,
      chat2AgentKind: 'stopped',
      tunnelRunning: false,
    })))

    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const result = await manager.stop('chat2agent')

    expect(result).toMatchObject({ id: 'chat2agent', state: 'stopped', canStop: false })
    expect(spawnMock).toHaveBeenCalledOnce()
  })

  it('allows Chat2Agent shutdown when its managed process is unhealthy', async () => {
    const unhealthySnapshot = {
      localMcpAvailable: false,
      localMcpRunning: false,
      chat2AgentAvailable: true,
      chat2AgentReady: false,
      chat2AgentManaged: true,
      chat2AgentLegacyOwned: false,
      chat2AgentKind: 'unhealthy',
      chat2AgentPid: 2548,
      tunnelRunning: false,
    }
    const stoppedSnapshot = {
      ...unhealthySnapshot,
      chat2AgentManaged: false,
      chat2AgentKind: 'stopped',
      chat2AgentPid: undefined,
    }
    spawnMock
      .mockImplementationOnce(() => fakeChild(JSON.stringify(unhealthySnapshot)))
      .mockImplementationOnce(() => fakeChild('Chat2Agent stopped'))
      .mockImplementationOnce(() => fakeChild(JSON.stringify(stoppedSnapshot)))
    const chatRoot = path.join(projectsRoot, 'Chat2Agent')
    await fs.mkdir(chatRoot, { recursive: true })
    await fs.writeFile(path.join(chatRoot, 'stop.bat'), '@echo off')

    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const stopped = await manager.stop('chat2agent')

    expect(stopped).toMatchObject({ id: 'chat2agent', state: 'stopped', canStop: false })
    expect(spawnMock).toHaveBeenCalledTimes(3)
    expect((spawnMock.mock.calls[1][1] as string[]).join(' ')).toContain('stop.bat')
  })

  it('opens LocalMCP Tunnel in a visible PowerShell session without claiming stop ownership', async () => {
    const script = path.join(projectsRoot, 'MCP', 'LocalMCP-Tunnel', 'scripts', 'start-tunnel.ps1')
    await fs.mkdir(path.dirname(script), { recursive: true })
    await fs.writeFile(script, 'Write-Output tunnel')

    spawnMock
      .mockImplementationOnce(() => fakeChild(JSON.stringify({
        localMcpAvailable: false,
        localMcpRunning: false,
        chat2AgentAvailable: false,
        chat2AgentReady: false,
        tunnelRunning: false,
      })))
      .mockImplementationOnce(() => fakeChild(''))

    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const result = await manager.start('localmcp-tunnel')

    expect(result).toMatchObject({
      id: 'localmcp-tunnel',
      state: 'starting',
      canStart: true,
      canStop: false,
      stopHint: 'Press Ctrl+C in the Tunnel PowerShell window.',
    })
    expect(spawnMock).toHaveBeenCalledTimes(2)
    const [executable, args, options] = spawnMock.mock.calls[1] as [string, string[], { windowsHide: boolean; detached: boolean }]
    expect(executable).toContain('WindowsPowerShell')
    expect(args).toContain('-NoExit')
    expect(args).toContain('-File')
    expect(args).toContain(script)
    expect(options.windowsHide).toBe(false)
    expect(options.detached).toBe(true)
    expect((spawnMock.mock.results[1].value as FakeChild).unref).toHaveBeenCalledOnce()
  })

  it('reports unavailable integrations without advertising unsupported lifecycle actions', async () => {
    spawnMock.mockImplementationOnce(() => fakeChild(JSON.stringify({
      localMcpAvailable: false,
      localMcpRunning: false,
      chat2AgentAvailable: false,
      chat2AgentReady: false,
      tunnelRunning: false,
    })))
    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const result = await manager.getStatuses()

    expect(result.integrations).toMatchObject([
      { id: 'localmcp', state: 'unavailable', canStart: false, canStop: false },
      { id: 'localmcp-tunnel', state: 'stopped', canStart: true, canStop: false },
      { id: 'chat2agent', state: 'unavailable', canStart: false, canStop: false },
    ])
  })

  it('bounds a hung status query and terminates only its PowerShell wrapper', async () => {
    const child = silentChild()
    spawnMock.mockReturnValueOnce(child)
    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)
    vi.useFakeTimers()

    const pending = manager.getStatuses()
    const rejection = expect(pending).rejects.toThrow('timed out after 15000 ms')
    await vi.advanceTimersByTimeAsync(15_001)
    await rejection
    expect(child.kill).toHaveBeenCalledOnce()
  })
})
