import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import path from 'node:path'
import { app } from 'electron'
import type { ManagedProcessHandle, ProcessControlProvider } from './process-control-provider.js'

interface NativeProcessHandle {
  readonly pid: number
  isJobEmpty(): boolean
  terminateJob(): boolean
  getExitCode(): number | null
  close(): void
}

interface NativeProcessControlModule {
  spawnManagedProcess(
    executablePath: string,
    args: string[],
    workingDirectory: string,
    environment: NodeJS.ProcessEnv,
  ): NativeProcessHandle
  attachManagedProcess(pid: number): NativeProcessHandle
}

class WindowsJobProcessHandle extends EventEmitter implements ManagedProcessHandle {
  readonly pid: number
  private readonly poller: NodeJS.Timeout
  private settled = false
  private errorReported = false

  constructor(private readonly nativeHandle: NativeProcessHandle, pollIntervalMs: number) {
    super()
    this.pid = nativeHandle.pid
    this.poller = setInterval(() => this.observe(), pollIntervalMs)
    this.poller.unref()

    // Defer only the spawn notification. The first state poll happens on the
    // interval so ProcessManager can attach exit/error listeners before a
    // very short-lived process can settle.
    queueMicrotask(() => {
      if (!this.settled) this.emit('spawn')
    })
  }

  private observe(): void {
    if (this.settled) return
    try {
      if (!this.nativeHandle.isJobEmpty()) return
      const exitCode = this.nativeHandle.getExitCode()
      this.nativeHandle.close()
      this.settled = true
      clearInterval(this.poller)
      this.emit('exit', exitCode, null)
    } catch (error) {
      // Keep polling after an observation error. A later successful query may
      // still prove the group empty and allow ProcessManager to settle safely.
      if (this.errorReported) return
      this.errorReported = true
      this.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }
}

/**
 * Windows process control backed by native CreateProcessW + Job Objects.
 * The primary thread is created suspended and cannot execute until the process
 * has been assigned to its private kill-on-close Job Object.
 */
export class WindowsProcessControlProvider implements ProcessControlProvider {
  readonly platform = 'win32' as const
  readonly capabilities = Object.freeze({
    gracefulShutdown: false,
    processTreeManagement: true,
    ownershipVerification: 'native-process-handle' as const,
  })

  private readonly handles = new WeakMap<ManagedProcessHandle, NativeProcessHandle>()
  private nativeModule?: NativeProcessControlModule

  constructor(
    nativeModule?: NativeProcessControlModule,
    private readonly pollIntervalMs = 25,
  ) {
    this.nativeModule = nativeModule
  }

  private loadNativeModule(): NativeProcessControlModule {
    if (this.nativeModule) return this.nativeModule
    if (process.platform !== 'win32') {
      throw new Error('The native Windows process-control provider can run only on Windows.')
    }

    const appPath = app.getAppPath()
    const nativeRoot = appPath.toLowerCase().endsWith('app.asar') ? `${appPath}.unpacked` : appPath
    const require = createRequire(path.join(appPath, 'package.json'))
    const nativePath = path.join(nativeRoot, 'dist-electron', 'main', 'native', 'windows_process_control.node')
    this.nativeModule = require(nativePath) as NativeProcessControlModule
    return this.nativeModule
  }

  spawn(
    executablePath: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): ManagedProcessHandle {
    if (!options.cwd) throw new Error('A working directory is required for managed Windows processes.')
    const nativeHandle = this.loadNativeModule().spawnManagedProcess(
      executablePath,
      args,
      options.cwd,
      options.env ?? process.env,
    )
    const handle = new WindowsJobProcessHandle(nativeHandle, this.pollIntervalMs)
    this.handles.set(handle, nativeHandle)
    return handle
  }

  attach(pid: number): ManagedProcessHandle {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error('A positive process identifier is required for managed attachment.')
    }
    const nativeHandle = this.loadNativeModule().attachManagedProcess(pid)
    const handle = new WindowsJobProcessHandle(nativeHandle, this.pollIntervalMs)
    this.handles.set(handle, nativeHandle)
    return handle
  }

  requestGracefulStop(_handle: ManagedProcessHandle): 'unsupported' {
    return 'unsupported'
  }

  forceTerminate(handle: ManagedProcessHandle): boolean {
    const nativeHandle = this.handles.get(handle)
    if (!nativeHandle) throw new Error('Process handle is not owned by this Windows provider instance.')
    return nativeHandle.terminateJob()
  }
}

export function createProcessControlProvider(platform: NodeJS.Platform = process.platform): ProcessControlProvider {
  if (platform === 'win32') return new WindowsProcessControlProvider()
  throw new Error("No process control provider is implemented for platform '" + platform + "'.")
}
