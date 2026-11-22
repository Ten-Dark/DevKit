import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import type { ManagedProcessHandle, ProcessControlProvider } from './process-control-provider.js'

/**
 * Test-only provider retaining Node's ChildProcess behavior for orchestration
 * tests. Production code must use the native Windows Job Object provider.
 */
export function createTestProcessControlProvider(): ProcessControlProvider {
  const children = new WeakMap<ManagedProcessHandle, ChildProcess>()

  return {
    platform: process.platform,
    capabilities: {
      gracefulShutdown: false,
      processTreeManagement: false,
      ownershipVerification: 'session-child-reference',
    },
    spawn(executablePath, args, options) {
      const child = spawn(executablePath, args, {
        ...options,
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
        detached: false,
      })
      const handle = new EventEmitter() as ManagedProcessHandle
      Object.defineProperty(handle, 'pid', { value: child.pid, enumerable: true })
      children.set(handle, child)
      child.on('spawn', () => handle.emit('spawn'))
      child.on('exit', (code, signal) => handle.emit('exit', code, signal))
      child.on('error', (error) => handle.emit('error', error))
      return handle
    },
    requestGracefulStop: () => 'unsupported',
    forceTerminate(handle) {
      const child = children.get(handle)
      if (!child) throw new Error('Test process handle is not owned by this provider.')
      return child.kill('SIGKILL')
    },
  }
}
