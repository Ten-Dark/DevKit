import {
  type HealthCheckResult,
  type ProcessObservation,
  type ServiceCapability,
  type ServiceDefinition,
} from './contracts.js'

export interface AdapterValidationResult {
  valid: boolean
  errors: string[]
}

export interface AdapterOperationContext {
  operationId: string
  signal?: AbortSignal
}

export interface ServiceAdapter {
  id: string
  version: string
  platforms: NodeJS.Platform[]
  capabilities: ServiceCapability[]
  validateConfig(config: unknown): AdapterValidationResult
  getStatus?(service: ServiceDefinition, context: AdapterOperationContext): Promise<ProcessObservation>
  healthCheck?(service: ServiceDefinition, context: AdapterOperationContext): Promise<HealthCheckResult[]>
  start?(service: ServiceDefinition, context: AdapterOperationContext): Promise<ProcessObservation>
  stop?(service: ServiceDefinition, context: AdapterOperationContext): Promise<ProcessObservation>
  restart?(service: ServiceDefinition, context: AdapterOperationContext): Promise<ProcessObservation>
  getLogs?(service: ServiceDefinition, context: AdapterOperationContext): Promise<string[]>
}

const CAPABILITY_METHOD: Partial<Record<ServiceCapability, keyof ServiceAdapter>> = {
  status: 'getStatus',
  health: 'healthCheck',
  start: 'start',
  stop: 'stop',
  restart: 'restart',
  logs: 'getLogs',
}

export interface AdapterServiceValidation {
  valid: boolean
  errors: string[]
  adapter?: ServiceAdapter
}

function isValidAdapterId(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/.test(value)
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, ServiceAdapter>()

  register(adapter: ServiceAdapter): void {
    if (!isValidAdapterId(adapter.id)) throw new Error('Adapter id is invalid.')
    if (!adapter.version.trim() || adapter.version.length > 64) throw new Error('Adapter version must contain 1 to 64 characters.')
    if (
      !Array.isArray(adapter.platforms) ||
      adapter.platforms.length === 0 ||
      adapter.platforms.some((platform) => !['win32', 'linux', 'darwin', 'freebsd', 'openbsd', 'netbsd', 'aix', 'sunos', 'android', 'haiku', 'cygwin'].includes(platform))
    ) {
      throw new Error('Adapter must declare at least one supported platform.')
    }
    if (
      !Array.isArray(adapter.capabilities) ||
      adapter.capabilities.length === 0 ||
      adapter.capabilities.some((capability) => !['status', 'health', 'start', 'stop', 'restart', 'logs'].includes(capability))
    ) {
      throw new Error('Adapter must declare at least one supported capability.')
    }
    if (new Set(adapter.platforms).size !== adapter.platforms.length) {
      throw new Error('Adapter platforms must not contain duplicates.')
    }
    if (new Set(adapter.capabilities).size !== adapter.capabilities.length) {
      throw new Error('Adapter capabilities must not contain duplicates.')
    }
    if (this.adapters.has(adapter.id)) throw new Error(`Adapter '${adapter.id}' is already registered.`)

    for (const capability of adapter.capabilities) {
      const method = CAPABILITY_METHOD[capability]
      if (method && typeof adapter[method] !== 'function') {
        throw new Error(`Adapter '${adapter.id}' declares '${capability}' without implementing ${String(method)}.`)
      }
    }
    this.adapters.set(adapter.id, Object.freeze({
      ...adapter,
      platforms: [...adapter.platforms],
      capabilities: [...adapter.capabilities],
    }))
  }

  get(adapterId: string): ServiceAdapter | undefined {
    return this.adapters.get(adapterId)
  }

  list(): ServiceAdapter[] {
    return [...this.adapters.values()]
  }

  validateService(service: ServiceDefinition, platform: NodeJS.Platform = process.platform): AdapterServiceValidation {
    const errors: string[] = []
    const adapter = this.adapters.get(service.adapterId)
    if (!adapter) return { valid: false, errors: [`Adapter '${service.adapterId}' is not registered.`] }

    if (!adapter.platforms.includes(platform)) {
      errors.push(`Adapter '${adapter.id}' does not support platform '${platform}'.`)
    }
    if (!service.platforms.includes(platform)) {
      errors.push(`Service '${service.id}' is not declared for platform '${platform}'.`)
    }
    for (const declaredPlatform of service.platforms) {
      if (!adapter.platforms.includes(declaredPlatform)) {
        errors.push(`Adapter '${adapter.id}' does not support declared service platform '${declaredPlatform}'.`)
      }
    }

    for (const capability of service.capabilities) {
      if (!adapter.capabilities.includes(capability)) {
        errors.push(`Adapter '${adapter.id}' does not support capability '${capability}'.`)
      }
    }

    const configResult = adapter.validateConfig(service.config)
    if (!configResult.valid) errors.push(...configResult.errors.map((error) => `Invalid adapter config: ${error}`))

    return { valid: errors.length === 0, errors, adapter }
  }
}
