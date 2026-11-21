import { describe, expect, it } from 'vitest'
import { validateServiceDefinition, type ServiceDefinition } from './contracts.js'

const validService: ServiceDefinition = {
  id: 'local-api',
  name: 'Local API',
  version: '1.2.0',
  adapterId: 'process.local',
  owner: { kind: 'managed', resourceId: 'local-api' },
  capabilities: ['status', 'health', 'start', 'stop', 'restart', 'logs'],
  platforms: ['win32'],
  dependencies: [],
  config: { executable: 'node.exe', args: ['server.js'] },
  readinessProbe: {
    type: 'http',
    url: 'http://127.0.0.1:4317/health',
    timeoutMs: 2_000,
    expectedStatusCodes: [200],
  },
}

describe('service definition contracts', () => {
  it('accepts a valid managed service definition', () => {
    expect(validateServiceDefinition(validService)).toEqual({
      valid: true,
      value: validService,
    })
  })

  it('accepts a connected service with observation-only capabilities', () => {
    const connected = {
      ...validService,
      owner: { kind: 'connected', provider: 'local-mcp', resourceId: 'mcp-server-a' },
      capabilities: ['status', 'health'],
    }
    expect(validateServiceDefinition(connected).valid).toBe(true)
  })

  it('rejects invalid identifiers, owner and capabilities', () => {
    const result = validateServiceDefinition({
      ...validService,
      id: '../outside',
      adapterId: 'Process Local',
      owner: { kind: 'connected', resourceId: 'missing-provider' },
      capabilities: ['status', 'delete'],
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.stringContaining('id'),
        expect.stringContaining('adapterId'),
        expect.stringContaining('owner'),
        expect.stringContaining('capabilities'),
      ]))
    }
  })

  it('rejects unsupported top-level fields instead of persisting unrecognized data', () => {
    const result = validateServiceDefinition({ ...validService, accessToken: 'must-not-persist' })
    expect(result.valid).toBe(false)
    if (result.valid === false) {
      expect(result.errors).toContain("unsupported service definition field 'accessToken'.")
    }
  })

  it('rejects self-dependencies and duplicate dependency identifiers', () => {
    const result = validateServiceDefinition({
      ...validService,
      dependencies: [
        { serviceId: 'local-api', required: true },
        { serviceId: 'database', required: true },
        { serviceId: 'database', required: false },
      ],
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.stringContaining('cannot depend on itself'),
        expect.stringContaining('duplicated'),
      ]))
    }
  })

  it('rejects unbounded or malformed readiness probes', () => {
    const result = validateServiceDefinition({
      ...validService,
      readinessProbe: {
        type: 'http',
        url: 'file:///C:/secrets',
        timeoutMs: 60_000,
      },
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain('readinessProbe must be a bounded HTTP probe to a loopback URL with a valid timeout.')
    }
  })

  it('rejects empty platform lists and malformed dependencies', () => {
    const result = validateServiceDefinition({
      ...validService,
      platforms: [],
      dependencies: [{ serviceId: 'Bad Id', required: true }],
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.stringContaining('platforms'),
        expect.stringContaining('valid serviceId'),
      ]))
    }
  })
})
