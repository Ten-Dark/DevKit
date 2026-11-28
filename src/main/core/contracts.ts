export type ServiceOwner =
  | { kind: 'managed'; resourceId: string }
  | { kind: 'connected'; provider: string; resourceId: string }

export type ServiceCapability =
  | 'status'
  | 'health'
  | 'start'
  | 'stop'
  | 'restart'
  | 'logs'

export type ServiceAggregateState = 'running' | 'stopped' | 'failed' | 'degraded' | 'unknown'
export type ProcessObservationState = 'present' | 'absent' | 'exited' | 'unobservable'
export type HealthCheckState = 'pass' | 'fail' | 'unknown'
export type HealthProbeType = 'process' | 'http'

export interface ServiceDependency {
  serviceId: string
  required: boolean
  capability?: ServiceCapability
  versionConstraint?: string
}

export interface HttpReadinessProbe {
  type: 'http'
  url: string
  timeoutMs: number
  expectedStatusCodes?: number[]
}

export interface ServiceDefinition {
  id: string
  name: string
  version: string
  adapterId: string
  owner: ServiceOwner
  capabilities: ServiceCapability[]
  platforms: NodeJS.Platform[]
  dependencies: ServiceDependency[]
  config: Record<string, unknown>
  readinessProbe?: HttpReadinessProbe
}

export interface ProcessObservation {
  state: ProcessObservationState
  observedAt: string
  pid?: number
  startedAt?: string
  executablePath?: string
  workingDirectory?: string
  identityVerified: boolean
  /** Runtime ownership is separate from process identity verification. */
  ownership?: 'managed' | 'external' | 'unknown'
  exitCode?: number | null
}

export interface HealthCheckResult {
  id: string
  type: HealthProbeType
  state: HealthCheckState
  checkedAt: string
  durationMs: number
  message?: string
}

export interface ServiceRuntimeSnapshot {
  serviceId: string
  state: ServiceAggregateState
  process: ProcessObservation
  healthChecks: HealthCheckResult[]
  observedAt: string
  reason?: string
}

export type RuntimeEventLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RuntimeEvent {
  id: string
  type: string
  level: RuntimeEventLevel
  occurredAt: string
  correlationId: string
  serviceId?: string
  message: string
  details?: Record<string, unknown>
}

export type ServiceDefinitionValidation =
  | { valid: true; value: ServiceDefinition }
  | { valid: false; errors: string[] }

const SERVICE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const ADAPTER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/
const CAPABILITIES = new Set<ServiceCapability>([
  'status',
  'health',
  'start',
  'stop',
  'restart',
  'logs',
])
const PLATFORMS = new Set<NodeJS.Platform>([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'cygwin',
  'netbsd',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isOwner(value: unknown): value is ServiceOwner {
  if (!isRecord(value)) return false
  if (value.kind === 'managed') {
    return (
      Object.keys(value).every((key) => ['kind', 'resourceId'].includes(key)) &&
      typeof value.resourceId === 'string' &&
      value.resourceId.length > 0 &&
      value.resourceId.length <= 128
    )
  }
  if (value.kind === 'connected') {
    return (
      Object.keys(value).every((key) => ['kind', 'provider', 'resourceId'].includes(key)) &&
      typeof value.provider === 'string' &&
      value.provider.length > 0 &&
      value.provider.length <= 128 &&
      typeof value.resourceId === 'string' &&
      value.resourceId.length > 0 &&
      value.resourceId.length <= 128
    )
  }
  return false
}

export function validateServiceDefinition(input: unknown): ServiceDefinitionValidation {
  const errors: string[] = []
  if (!isRecord(input)) return { valid: false, errors: ['Service definition must be an object.'] }
  const allowedKeys = new Set(['id', 'name', 'version', 'adapterId', 'owner', 'capabilities', 'platforms', 'dependencies', 'config', 'readinessProbe'])
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) errors.push(`unsupported service definition field '${key}'.`)
  }

  if (typeof input.id !== 'string' || !SERVICE_ID_PATTERN.test(input.id)) {
    errors.push('id must be a lowercase service identifier (letters, digits and hyphens).')
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 120) {
    errors.push('name must contain between 1 and 120 characters.')
  }
  if (typeof input.version !== 'string' || input.version.trim().length === 0 || input.version.length > 64) {
    errors.push('version must contain between 1 and 64 characters.')
  }
  if (typeof input.adapterId !== 'string' || !ADAPTER_ID_PATTERN.test(input.adapterId)) {
    errors.push('adapterId is invalid.')
  }
  if (!isOwner(input.owner)) errors.push('owner must declare a valid managed or connected owner.')

  const capabilities = input.capabilities
  if (
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    capabilities.some((capability) => typeof capability !== 'string' || !CAPABILITIES.has(capability as ServiceCapability))
  ) {
    errors.push('capabilities contains an unsupported capability.')
  } else if (new Set(capabilities).size !== capabilities.length) {
    errors.push('capabilities must not contain duplicates.')
  }

  const platforms = input.platforms
  if (
    !Array.isArray(platforms) ||
    platforms.length === 0 ||
    platforms.some((platform) => typeof platform !== 'string' || !PLATFORMS.has(platform as NodeJS.Platform))
  ) {
    errors.push('platforms must contain at least one supported platform.')
  } else if (new Set(platforms).size !== platforms.length) {
    errors.push('platforms must not contain duplicates.')
  }

  const dependencies = input.dependencies
  if (!Array.isArray(dependencies)) {
    errors.push('dependencies must be an array.')
  } else {
    const dependencyIds = new Set<string>()
    for (const dependency of dependencies) {
      if (!isRecord(dependency) || typeof dependency.serviceId !== 'string' || !SERVICE_ID_PATTERN.test(dependency.serviceId)) {
        errors.push('each dependency must reference a valid serviceId.')
        continue
      }
      for (const key of Object.keys(dependency)) {
        if (!['serviceId', 'required', 'capability', 'versionConstraint'].includes(key)) {
          errors.push(`dependency '${dependency.serviceId}' contains unsupported field '${key}'.`)
        }
      }
      if (dependency.serviceId === input.id) errors.push('a service cannot depend on itself.')
      if (dependencyIds.has(dependency.serviceId)) errors.push(`dependency '${dependency.serviceId}' is duplicated.`)
      dependencyIds.add(dependency.serviceId)
      if (typeof dependency.required !== 'boolean') {
        errors.push(`dependency '${dependency.serviceId}' must declare required as a boolean.`)
      }
      if (dependency.capability !== undefined && !CAPABILITIES.has(dependency.capability as ServiceCapability)) {
        errors.push(`dependency '${dependency.serviceId}' declares an unsupported capability.`)
      }
      if (dependency.versionConstraint !== undefined && (typeof dependency.versionConstraint !== 'string' || dependency.versionConstraint.length > 64)) {
        errors.push(`dependency '${dependency.serviceId}' has an invalid version constraint.`)
      }
    }
  }

  if (!isRecord(input.config)) errors.push('config must be an object.')

  if (input.readinessProbe !== undefined) {
    const probe = input.readinessProbe
    let safeLocalUrl = false
    if (isRecord(probe) && typeof probe.url === 'string') {
      try {
        const url = new URL(probe.url)
        safeLocalUrl =
          ['http:', 'https:'].includes(url.protocol) &&
          ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase()) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
      } catch {
        safeLocalUrl = false
      }
    }
    if (
      !isRecord(probe) ||
      Object.keys(probe).some((key) => !['type', 'url', 'timeoutMs', 'expectedStatusCodes'].includes(key)) ||
      probe.type !== 'http' ||
      !safeLocalUrl ||
      typeof probe.timeoutMs !== 'number' ||
      !Number.isInteger(probe.timeoutMs) ||
      probe.timeoutMs < 100 ||
      probe.timeoutMs > 30_000 ||
      (probe.expectedStatusCodes !== undefined &&
        (!Array.isArray(probe.expectedStatusCodes) ||
          probe.expectedStatusCodes.length === 0 ||
          probe.expectedStatusCodes.some((code) => !Number.isInteger(code) || code < 100 || code > 599)))
    ) {
      errors.push('readinessProbe must be a bounded HTTP probe to a loopback URL with a valid timeout.')
    }
  }

  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, value: input as unknown as ServiceDefinition }
}
