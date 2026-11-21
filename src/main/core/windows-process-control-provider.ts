import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import type { ManagedProcessHandle, ProcessControlProvider } from './process-control-provider.js'

class WindowsChildProcessHandle extends EventEmitter implements ManagedProcessHandle {
  constructor(readonly pid: number | undefined) {
    super()
  }
}

/**
 * First Windows implementation. It deliberately manages only the exact
 * ChildProcess created in this runtime session. The wrapper is not a native
 * process handle and does not provide graceful shutdown or tree containment.
 */
export class WindowsProcessControlProvider implements ProcessControlProvider {
  readonly platform = 'win32' as const
  readonly capabilities = Object.freeze({
    gracefulShutdown: false,
    processTreeManagement: false,
    ownershipVerification: 'session-child-reference' as const,
  })
  private readonly children = new WeakMap<ManagedProcessHandle, ChildProcess>()

  spawn(
    executablePath: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): ManagedProcessHandle {
    const child = spawn(executablePath, args, {
      ...options,
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
    })
    const handle = new WindowsChildProcessHandle(child.pid)
    this.children.set(handle, child)
    child.on('spawn', () => handle.emit('spawn'))
    child.on('exit', (code, signal) => handle.emit('exit', code, signal))
    child.on('error', (error) => handle.emit('error', error))
    return handle
  }

  requestGracefulStop(_handle: ManagedProcessHandle): 'unsupported' {
    return 'unsupported'
  }

  forceTerminate(handle: ManagedProcessHandle): boolean {
    const child = this.children.get(handle)
    if (!child) throw new Error('Process handle is not owned by this Windows provider instance.')
    // Node.js maps SIGKILL to abrupt termination on Windows.
    return child.kill('SIGKILL')
  }
}

export function createProcessControlProvider(platform: NodeJS.Platform = process.platform): ProcessControlProvider {
  if (platform === 'win32') return new WindowsProcessControlProvider()
  throw new Error("No process control provider is implemented for platform '" + platform + "'.")
}
