import type { EventEmitter } from 'node:events'
import type { SpawnOptions } from 'node:child_process'

export interface ManagedProcessHandle extends EventEmitter {
  readonly pid?: number
}

export interface ProcessControlCapabilities {
  gracefulShutdown: boolean
  processTreeManagement: boolean
  ownershipVerification: 'session-child-reference' | 'native-process-handle'
}

export interface ProcessControlProvider {
  readonly platform: NodeJS.Platform
  readonly capabilities: Readonly<ProcessControlCapabilities>
  spawn(executablePath: string, args: string[], options: Pick<SpawnOptions, 'cwd' | 'env'>): ManagedProcessHandle
  requestGracefulStop(handle: ManagedProcessHandle): 'requested' | 'unsupported'
  forceTerminate(handle: ManagedProcessHandle): boolean
}
