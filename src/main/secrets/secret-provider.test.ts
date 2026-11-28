import { describe, expect, it, vi } from 'vitest'
import { SecretProviderRegistry, type SecretProvider } from './secret-provider.js'

function provider(id: string, resolveSecret = vi.fn().mockResolvedValue('secret-value')): SecretProvider {
  return {
    id,
    getAvailability: vi.fn().mockResolvedValue({ available: true }),
    validateReference: vi.fn().mockResolvedValue(undefined),
    resolveSecret,
    getCapabilities: () => ({ availability: true, validation: true, resolve: true }),
  }
}

describe('SecretProviderRegistry', () => {
  it('registers providers and resolves references through the provider contract', async () => {
    const registry = new SecretProviderRegistry()
    const adapter = provider('test-provider')
    registry.register(adapter)

    await expect(registry.resolve({
      providerId: 'test-provider',
      reference: { recordId: 'record-1' },
    })).resolves.toBe('secret-value')

    expect(adapter.validateReference).toHaveBeenCalledWith({ recordId: 'record-1' })
    expect(adapter.resolveSecret).toHaveBeenCalledWith({ recordId: 'record-1' })
  })

  it('rejects duplicate and unknown providers', async () => {
    const registry = new SecretProviderRegistry()
    registry.register(provider('test-provider'))
    expect(() => registry.register(provider('test-provider'))).toThrow(/already registered/)
    await expect(registry.resolve({ providerId: 'missing', reference: {} })).rejects.toThrow(/not registered/)
  })

  it('fails closed when a provider is unavailable', async () => {
    const registry = new SecretProviderRegistry()
    const adapter = provider('offline')
    vi.mocked(adapter.getAvailability).mockResolvedValue({ available: false, reason: 'Locked' })
    registry.register(adapter)

    await expect(registry.resolve({ providerId: 'offline', reference: {} })).rejects.toThrow('Locked')
    expect(adapter.resolveSecret).not.toHaveBeenCalled()
  })

  it('rejects malformed or unsafe secret values', async () => {
    const registry = new SecretProviderRegistry()
    registry.register(provider('bad', vi.fn().mockResolvedValue('token' + String.fromCharCode(10) + 'extra')))
    await expect(registry.resolve({ providerId: 'bad', reference: {} })).rejects.toThrow(/invalid secret/)
  })
})
