import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createProcessControlProvider, WindowsProcessControlProvider } from './windows-process-control-provider.js'

describe('WindowsProcessControlProvider', () => {
  it('declares the capabilities it actually supports', () => {
    const provider = new WindowsProcessControlProvider()

    expect(provider.platform).toBe('win32')
    expect(provider.capabilities).toEqual({
      gracefulShutdown: false,
      processTreeManagement: false,
      ownershipVerification: 'session-child-reference',
    })
  })

  it('does not claim graceful shutdown and forcefully terminates its own process reference', async () => {
    const provider = new WindowsProcessControlProvider()
    const handle = provider.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
      env: process.env,
    })

    await once(handle, 'spawn')
    expect(handle.pid).toBeTypeOf('number')
    expect(provider.requestGracefulStop(handle)).toBe('unsupported')

    const exited = once(handle, 'exit')
    expect(provider.forceTerminate(handle)).toBe(true)
    await exited
  })

  it('refuses to create an unimplemented platform provider', () => {
    expect(() => createProcessControlProvider('linux')).toThrow(/No process control provider/)
    expect(() => createProcessControlProvider('darwin')).toThrow(/No process control provider/)
  })
})
