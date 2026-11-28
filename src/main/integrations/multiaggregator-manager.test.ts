import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { MultiAggregatorManager } from './multiaggregator-manager.js'

function fakeChild(output = '', emitSpawn = false) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
    unref: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  child.unref = vi.fn()
  queueMicrotask(() => {
    if (emitSpawn) {
      child.emit('spawn')
      return
    }
    if (output) child.stdout.write(output)
    child.stdout.end()
    child.stderr.end()
    child.emit('close', 0)
  })
  return child
}

describe('MultiAggregatorManager', () => {
  let tempDir: string
  let settingsPath: string
  let executablePath: string
  let manager: MultiAggregatorManager

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-multiaggregator-test-'))
    settingsPath = path.join(tempDir, 'workspace', 'services', 'multiaggregator.json')
    executablePath = path.join(tempDir, 'Multi-AI Aggregator.exe')
    await fs.writeFile(executablePath, 'test executable')
    manager = new MultiAggregatorManager(settingsPath)
    spawnMock.mockReset()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('reports unavailable until the user selects an executable', async () => {
    const status = await manager.getStatus()
    expect(status).toMatchObject({
      id: 'multiaggregator',
      state: 'unavailable',
      canStart: false,
      canStop: false,
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('validates and persists only the selected executable path', async () => {
    await expect(manager.setExecutable('relative.exe')).rejects.toThrow(/absolute path/)
    const wrongExecutable = path.join(tempDir, 'wrong.exe')
    await fs.writeFile(wrongExecutable, 'not the app')
    await expect(manager.setExecutable(wrongExecutable)).rejects.toThrow(/Select the Multi-AI Aggregator executable/)
    const selected = await manager.setExecutable(executablePath)

    expect(selected).toBe(await fs.realpath(executablePath))
    const persisted = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { executablePath: string }
    expect(persisted.executablePath).toBe(selected)
  })

  it('detects the configured process by its exact executable path', async () => {
    await manager.setExecutable(executablePath)
    spawnMock.mockImplementationOnce(() => fakeChild(JSON.stringify({ running: true, pid: 3210 })))

    const status = await manager.getStatus()

    expect(status).toMatchObject({
      id: 'multiaggregator',
      state: 'running',
      pid: 3210,
      canStart: false,
      canStop: false,
    })
    expect(status.stopHint).toMatch(/own window/)
  })

  it('launches the selected app without taking ownership of its shutdown', async () => {
    const selectedExecutable = await manager.setExecutable(executablePath)
    spawnMock
      .mockImplementationOnce(() => fakeChild(JSON.stringify({ running: false, pid: null })))
      .mockImplementationOnce(() => fakeChild('', true))

    const started = await manager.start()

    expect(started).toMatchObject({
      id: 'multiaggregator',
      state: 'starting',
      canStart: false,
      canStop: false,
    })
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[1][0]).toBe(selectedExecutable)
    expect(spawnMock.mock.calls[1][2]).toMatchObject({
      detached: true,
      windowsHide: false,
      shell: false,
      stdio: 'ignore',
    })
    const appProcess = spawnMock.mock.results[1].value as ReturnType<typeof fakeChild>
    expect(appProcess.unref).toHaveBeenCalledOnce()
    expect(appProcess.kill).not.toHaveBeenCalled()
  })

  it('does not terminate the app when stop is requested', async () => {
    await manager.setExecutable(executablePath)
    spawnMock.mockImplementationOnce(() => fakeChild(JSON.stringify({ running: true, pid: 3210 })))

    const status = await manager.stop()

    expect(status.state).toBe('running')
    expect(spawnMock).toHaveBeenCalledOnce()
    expect(spawnMock.mock.calls[0][0]).toMatch(/powershell\.exe$/i)
  })

  it('restores the configured path and clears only DevKit settings', async () => {
    await manager.setExecutable(executablePath)
    const restored = new MultiAggregatorManager(settingsPath)
    spawnMock.mockImplementationOnce(() => fakeChild(JSON.stringify({ running: false, pid: null })))

    expect((await restored.getStatus()).state).toBe('stopped')
    expect(await restored.clearExecutable()).toBe(true)
    await expect(fs.access(settingsPath)).rejects.toThrow()
    await expect(fs.access(executablePath)).resolves.toBeUndefined()
  })
})
