import path from 'node:path'
import type { HealthCheckResult, ProcessObservation } from './contracts.js'
import { AdapterRegistry, type ServiceAdapter } from './adapter-registry.js'
import { HealthManager } from './health-manager.js'
import { ProcessManager, type ProcessLaunchSpec } from './process-manager.js'
import { RuntimeEventLogger } from './event-logger.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function createLocalProcessAdapter(
  processManager: ProcessManager,
  healthManager: HealthManager,
  eventLogger: RuntimeEventLogger,
): ServiceAdapter {
  return {
    id: 'process.local',
    version: '1.0.0',
    platforms: ['win32'],
    capabilities: ['status', 'health', 'start', 'stop', 'restart', 'logs'],
    validateConfig(config) {
      const errors: string[] = []
      if (!isRecord(config)) return { valid: false, errors: ['config must be an object.'] }
      const allowedKeys = new Set(['executablePath', 'workingDirectory', 'args', 'env'])
      for (const key of Object.keys(config)) {
        if (!allowedKeys.has(key)) errors.push(`unsupported process config key '${key}'.`)
      }
      if (typeof config.executablePath !== 'string' || config.executablePath.length > 4_096 || !path.isAbsolute(config.executablePath)) {
        errors.push('executablePath must be an absolute path.')
      }
      if (typeof config.workingDirectory !== 'string' || config.workingDirectory.length > 4_096 || !path.isAbsolute(config.workingDirectory)) {
        errors.push('workingDirectory must be an absolute path.')
      }
      if (
        !Array.isArray(config.args) || config.args.length > 128 ||
        config.args.some((argument) => typeof argument !== 'string' || argument.length > 4_096 || argument.includes('\0'))
      ) {
        errors.push('args must be an array of at most 128 valid strings.')
      }
      if (config.env !== undefined) {
        if (!isRecord(config.env)) {
          errors.push('env must be an object.')
        } else {
          if (Object.keys(config.env).length > 32) errors.push('env cannot contain more than 32 variables.')
          for (const [key, value] of Object.entries(config.env)) {
            if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) errors.push(`environment key '${key}' is invalid.`)
            if (/(secret|token|password|credential|api[-_]?key|private[-_]?key)/i.test(key)) {
              errors.push(`environment key '${key}' cannot contain a secret before Vault integration.`)
            }
            if (typeof value !== 'string' || value.length > 4_096 || value.includes('\0')) {
              errors.push(`environment value for '${key}' is invalid.`)
            }
          }
        }
      }
      return { valid: errors.length === 0, errors }
    },
    async getStatus(service): Promise<ProcessObservation> {
      return processManager.getObservation(service.id)
    },
    async healthCheck(service): Promise<HealthCheckResult[]> {
      const process = await processManager.getObservation(service.id)
      return (await healthManager.check(service, process)).healthChecks
    },
    async start(service, context) {
      return processManager.start(service, service.config as unknown as ProcessLaunchSpec, context.signal)
    },
    async stop(service) {
      return processManager.stop(service)
    },
    async restart(service, context) {
      await processManager.stop(service)
      return processManager.start(service, service.config as unknown as ProcessLaunchSpec, context.signal)
    },
    async getLogs(service) {
      const events = await eventLogger.readRecent(200)
      return events
        .filter((event) => event.serviceId === service.id)
        .map((event) => `[${event.occurredAt}] ${event.level.toUpperCase()} ${event.type}: ${event.message}`)
    },
  }
}

export function registerBuiltInAdapters(
  registry: AdapterRegistry,
  processManager: ProcessManager,
  healthManager: HealthManager,
  eventLogger: RuntimeEventLogger,
): void {
  registry.register(createLocalProcessAdapter(processManager, healthManager, eventLogger))
}
