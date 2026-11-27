import { describe, expect, it, vi } from 'vitest'
import type { ManagedProcessHandle } from './process-control-provider.js'
import {
  createProcessControlProvider,
  WindowsProcessControlProvider,
} from './windows-process-control-provider.js'

class FakeNativeProcess {
  readonly pid = 4242
  private empty: boolean
  private closed = false

  constructor(initiallyEmpty = false) {
    this.empty = initiallyEmpty
  }


  isJobEmpty(): boolean {
    return this.empty
  }

  terminateJob(): boolean {
    this.empty = true
    return true
  }

  getExitCode(): number | null {
    return this.empty ? 0 : null
  }

  close(): void {
    this.closed = true
  }

  isClosed(): boolean {
    return this.closed
  }
}

describe('WindowsProcessControlProvider', () => {
  it('declares only capabilities implemented by the native Job Object provider', () => {
    const provider = new WindowsProcessControlProvider({
      spawnManagedProcess: vi.fn(),
      attachManagedProcess: vi.fn(),
    })

    expect(provider.platform).toBe('win32')
    expect(provider.capabilities).toEqual({
      gracefulShutdown: false,
      processTreeManagement: true,
      ownershipVerification: 'native-process-handle',
    })
  })

  it('creates a native process handle and observes the whole Job Object lifetime', async () => {
    const nativeHandle = new FakeNativeProcess()
    const spawnManagedProcess = vi.fn(() => nativeHandle)
    const provider = new WindowsProcessControlProvider({ spawnManagedProcess, attachManagedProcess: vi.fn() }, 5)
    const handle = provider.spawn('C:\\tools\\service.exe', ['--mode', 'test'], {
      cwd: 'C:\\tools',
      env: { PATH: 'C:\\Windows\\System32' },
    })

    expect(spawnManagedProcess).toHaveBeenCalledWith(
      'C:\\tools\\service.exe',
      ['--mode', 'test'],
      'C:\\tools',
      { PATH: 'C:\\Windows\\System32' },
    )
    await new Promise<void>((resolve) => handle.once('spawn', resolve))
    expect(handle.pid).toBe(4242)
    expect(provider.requestGracefulStop(handle)).toBe('unsupported')

    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      handle.once('exit', (code, signal) => resolve([code, signal]))
    })
    expect(provider.forceTerminate(handle)).toBe(true)
    await expect(exited).resolves.toEqual([0, null])
    expect(nativeHandle.isClosed()).toBe(true)
  })
  it('attaches a just-spawned bootstrap process to a managed Job Object', async () => {
    const nativeHandle = new FakeNativeProcess()
    const attachManagedProcess = vi.fn(() => nativeHandle)
    const provider = new WindowsProcessControlProvider({
      spawnManagedProcess: vi.fn(),
      attachManagedProcess,
    }, 5)

    const handle = provider.attach(9001)
    expect(attachManagedProcess).toHaveBeenCalledWith(9001)
    await new Promise<void>((resolve) => handle.once('spawn', resolve))

    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      handle.once('exit', (code, signal) => resolve([code, signal]))
    })
    expect(provider.forceTerminate(handle)).toBe(true)
    await expect(exited).resolves.toEqual([0, null])
    expect(nativeHandle.isClosed()).toBe(true)
  })

  it('does not lose an immediate exit while ProcessManager attaches lifecycle listeners', async () => {
    const nativeHandle = new FakeNativeProcess(true)
    const provider = new WindowsProcessControlProvider({
      spawnManagedProcess: vi.fn(() => nativeHandle),
      attachManagedProcess: vi.fn(),
    }, 5)
    const handle = provider.spawn('C:\\tools\\short-lived.exe', [], {
      cwd: 'C:\\tools',
      env: {},
    })

    await new Promise<void>((resolve) => handle.once('spawn', resolve))
    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      handle.once('exit', (code, signal) => resolve([code, signal]))
    })
    await expect(exited).resolves.toEqual([0, null])
    expect(nativeHandle.isClosed()).toBe(true)
  })

  it('does not allow a handle created by another provider to be terminated', () => {

    const first = new WindowsProcessControlProvider({ spawnManagedProcess: vi.fn(), attachManagedProcess: vi.fn() })
    const second = new WindowsProcessControlProvider({ spawnManagedProcess: vi.fn(), attachManagedProcess: vi.fn() })
    const foreignHandle = { pid: 42 } as ManagedProcessHandle

    expect(() => first.forceTerminate(foreignHandle)).toThrow(/not owned/)
    expect(() => second.forceTerminate(foreignHandle)).toThrow(/not owned/)
  })

  it('refuses to create an unimplemented platform provider', () => {
    expect(() => createProcessControlProvider('linux')).toThrow(/No process control provider/)
    expect(() => createProcessControlProvider('darwin')).toThrow(/No process control provider/)
  })
})
