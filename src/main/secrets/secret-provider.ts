export interface SecretReference {
  providerId: string
  reference: Record<string, unknown>
}

export interface SecretProviderCapabilities {
  availability: boolean
  validation: boolean
  resolve: boolean
}

export interface SecretProvider {
  readonly id: string
  getAvailability(): Promise<{ available: boolean; reason?: string }>
  validateReference(reference: Record<string, unknown>): Promise<void>
  resolveSecret(reference: Record<string, unknown>, unlockPassword?: string): Promise<string>
  getCapabilities(): SecretProviderCapabilities
  dispose?(): Promise<void>
}

export class SecretProviderRegistry {
  private readonly providers = new Map<string, SecretProvider>()

  register(provider: SecretProvider): void {
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(provider.id)) {
      throw new Error('Secret provider ID is invalid.')
    }
    if (this.providers.has(provider.id)) {
      throw new Error('Secret provider is already registered: ' + provider.id)
    }
    this.providers.set(provider.id, provider)
  }

  get(providerId: string): SecretProvider {
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error('Secret provider is not registered: ' + providerId)
    return provider
  }

  async resolve(reference: SecretReference, unlockPassword?: string): Promise<string> {
    if (!reference || typeof reference.providerId !== 'string' || !reference.reference
      || typeof reference.reference !== 'object' || Array.isArray(reference.reference)) {
      throw new Error('Secret reference is invalid.')
    }
    const provider = this.get(reference.providerId)
    const availability = await provider.getAvailability()
    if (!availability.available) {
      throw new Error(availability.reason ?? 'Secret provider is unavailable.')
    }
    await provider.validateReference(reference.reference)
    const value = unlockPassword === undefined
      ? await provider.resolveSecret(reference.reference)
      : await provider.resolveSecret(reference.reference, unlockPassword)
    if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) {
      throw new Error('Secret provider returned an invalid secret value.')
    }
    return value
  }

  list(): Array<{ id: string; capabilities: SecretProviderCapabilities }> {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      capabilities: provider.getCapabilities(),
    }))
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.providers.values()].map((provider) => provider.dispose?.()))
    this.providers.clear()
  }
}
