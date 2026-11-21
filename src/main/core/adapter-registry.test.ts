import { describe, expect, it } from 'vitest'
import { AdapterRegistry, type ServiceAdapter } from './adapter-registry.js'
import type { ServiceDefinition } from './contracts.js'

const service: ServiceDefinition = {
  id: 'local-api',
  name: 'Local API',
  version: '1.0.0',
  adapterId: 'process.local',
  owner: { kind: 'managed', resourceId: 'local-api' },
  capabilities: ['status', 'health', 'start', 'stop'],
  platforms: ['win32'],
  dependencies: [],
  config: { executable: 'node.exe' },
}

const adapter: ServiceAdapter = {
  id: 'process.local',
  version: '1.0.0',
  platforms: ['win32'],
  capabilities: ['status', 'health', 'start', 'stop'],
  validateConfig: (config) => ({
    valid: Boolean(config && typeof config === 'object' && 'executable' in config),
    errors: ['executable is required'],
  }),
  getStatus: async () => ({
    state: 'absent',
    observedAt: new Date().toISOString(),
    identityVerified: false,
  }),
  healthCheck: async () => [],
  start: async () => ({
    state: 'present',
    observedAt: new Date().toISOString(),
    identityVerified: true,
  }),
  stop: async () => ({
    state: 'absent',
    observedAt: new Date().toISOString(),
    identityVerified: false,
  }),
}

describe('adapter registry', () => {
  it('registers and resolves an adapter by its stable identifier', () => {
    const registry = new AdapterRegistry()
    registry.register(adapter)

    expect(registry.get('process.local')?.version).toBe('1.0.0')
    expect(registry.list()).toHaveLength(1)
  })

  it('rejects duplicate or malformed adapter registrations', () => {
    const registry = new AdapterRegistry()
    registry.register(adapter)

    expect(() => registry.register(adapter)).toThrow(/already registered/)
    expect(() => registry.register({ ...adapter, id: 'Bad Adapter' })).toThrow(/id is invalid/)
  })

  it('rejects declared capabilities without the corresponding implementation', () => {
    const registry = new AdapterRegistry()
    const incomplete = { ...adapter, capabilities: ['status', 'restart'] as const, restart: undefined }

    expect(() => registry.register(incomplete as unknown as ServiceAdapter)).toThrow(/without implementing restart/)
  })

  it('validates service capabilities, platform and adapter configuration', () => {
    const registry = new AdapterRegistry()
    registry.register(adapter)

    expect(registry.validateService(service, 'win32')).toMatchObject({ valid: true })
    expect(registry.validateService(service, 'linux').errors).toContain(
      "Adapter 'process.local' does not support platform 'linux'.",
    )
    expect(registry.validateService({ ...service, capabilities: ['status', 'logs'] }, 'win32').valid).toBe(false)
    expect(registry.validateService({ ...service, config: {} }, 'win32').errors).toContain(
      'Invalid adapter config: executable is required',
    )
  })

  it('rejects a service whose adapter is not registered', () => {
    const registry = new AdapterRegistry()
    expect(registry.validateService(service, 'win32').errors).toEqual([
      "Adapter 'process.local' is not registered.",
    ])
  })
})
