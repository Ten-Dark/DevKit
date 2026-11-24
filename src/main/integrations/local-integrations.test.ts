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
}

function fakeChild(stdout: string, exitCode = 0): FakeChild {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  }) as FakeChild

  queueMicrotask(() => {
    child.stdout.end(stdout)
    child.stderr.end()
    child.emit('close', exitCode)
  })
  return child
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
      { id: 'chat2agent', state: 'running', pid: 2548, canStart: true, canStop: true },
    ])
    expect(spawnMock).toHaveBeenCalledOnce()
    const [executable, args, options] = spawnMock.mock.calls[0] as [string, string[], { cwd: string }]
    expect(executable).toContain('WindowsPowerShell')
    expect(args).toContain('-Command')
    expect(args.join(' ')).toContain('service-status.mjs')
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
})
