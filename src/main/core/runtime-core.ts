import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { AdapterRegistry } from './adapter-registry.js'
import type { DependencyPlan } from './dependency-engine.js'
import { DependencyEngine } from './dependency-engine.js'
import { RuntimeEventLogger, type RuntimeEventInput } from './event-logger.js'
import { HealthManager } from './health-manager.js'
import { registerBuiltInAdapters } from './local-process-adapter.js'
import { ProcessManager, type ProcessManagerOptions } from './process-manager.js'
import { ServiceRegistryStore, type RegistryStoreOptions } from './service-registry-store.js'
import {
  validateServiceDefinition,
  type ServiceDefinition,
  type ServiceRuntimeSnapshot,
} from './contracts.js'
import { resolveWorkspacePaths } from '../workspace.js'

export interface RuntimeCoreOptions {
  registry?: RegistryStoreOptions
  processManager?: ProcessManagerOptions
  eventFilePath?: string
  readinessTimeoutMs?: number
  readinessPollIntervalMs?: number
}

export interface RuntimeServiceItem {
  service: ServiceDefinition
  snapshot: ServiceRuntimeSnapshot
}

export interface RuntimeServiceDetails extends RuntimeServiceItem {
  dependencies: ServiceDefinition['dependencies']
  dependents: string[]
  recentEvents: string[]
}

export interface RuntimeStartResult {
  plan: DependencyPlan
  startedServiceIds: string[]
  services: RuntimeServiceItem[]
}

export class RuntimeCore {
  readonly registry: ServiceRegistryStore
  readonly eventLogger: RuntimeEventLogger
  readonly processManager: ProcessManager
  readonly healthManager: HealthManager
  readonly adapterRegistry = new AdapterRegistry()
  readonly dependencyEngine = new DependencyEngine()
  private readonly readinessTimeoutMs: number
  private readonly readinessPollIntervalMs: number
  private initialization?: Promise<void>

  constructor(options: RuntimeCoreOptions = {}) {
    const paths = resolveWorkspacePaths()
    this.registry = new ServiceRegistryStore(options.registry ?? {
      filePath: path.join(paths.registry, 'services.json'),
    })
    this.eventLogger = new RuntimeEventLogger({
      filePath: options.eventFilePath ?? path.join(paths.events, 'runtime.jsonl'),
    })
    this.processManager = new ProcessManager({
      ...options.processManager,
      stateFilePath: options.processManager?.stateFilePath ?? path.join(paths.registry, 'process-instances.json'),
      eventLogger: this.eventLogger,
    })
    this.healthManager = new HealthManager()
    this.readinessTimeoutMs = Math.max(500, options.readinessTimeoutMs ?? 15_000)
    this.readinessPollIntervalMs = Math.max(50, options.readinessPollIntervalMs ?? 250)
  }

  private mutationQueue: Promise<void> = Promise.resolve()

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async emitEvent(event: RuntimeEventInput): Promise<void> {
    try {
      await this.eventLogger.emit(event)
    } catch (error) {
      console.error('[DevKit Runtime] Could not persist runtime event:', error)
    }
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        registerBuiltInAdapters(this.adapterRegistry, this.processManager, this.healthManager, this.eventLogger)
        await this.processManager.initialize()
        await this.registry.list()
      })()
    }
    return this.initialization
  }

  async listServices(): Promise<RuntimeServiceItem[]> {
    await this.initialize()
    const services = await this.registry.list()
    return Promise.all(services.map(async (service) => ({
      service,
      snapshot: await this.getSnapshot(service),
    })))
  }

  async getServiceDetails(serviceId: string): Promise<RuntimeServiceDetails> {
    await this.initialize()
    const service = await this.registry.get(serviceId)
    if (!service) throw new Error(`Service '${serviceId}' is not registered.`)
    const [snapshot, events, allServices] = await Promise.all([
      this.getSnapshot(service),
      this.eventLogger.readRecent(200),
      this.registry.list(),
    ])
    const dependents = allServices
      .filter((candidate) => candidate.dependencies.some((dependency) => dependency.serviceId === serviceId))
      .map((candidate) => candidate.id)

    return {
      service,
      snapshot,
      dependencies: service.dependencies,
      dependents,
      recentEvents: events
        .filter((event) => event.serviceId === serviceId)
        .slice(-30)
        .map((event) => `[${event.occurredAt}] ${event.level.toUpperCase()} ${event.type}: ${event.message}`),
    }
  }

  async registerService(input: unknown): Promise<ServiceDefinition> {
    return this.serializeMutation(async () => {
      await this.initialize()
    const validation = validateServiceDefinition(input)
    if (validation.valid === false) {
      throw new Error(`Invalid service definition: ${validation.errors.join(' ')}`)
    }
    const service = validation.value
    if (!service.capabilities.includes('status') || !service.capabilities.includes('health')) {
      throw new Error('Local services must grant status and health capabilities.')
    }
    if (service.capabilities.includes('start') !== service.capabilities.includes('stop')) {
      throw new Error('Local process lifecycle must grant start and stop together.')
    }
    if (service.capabilities.includes('restart') && !service.capabilities.includes('start')) {
      throw new Error('Restart requires both start and stop capabilities.')
    }
    if (service.owner.kind !== 'managed') {
      throw new Error('The local process adapter accepts only DevKit-managed service definitions.')
    }
    if (service.owner.resourceId !== service.id) {
      throw new Error('Managed local service owner.resourceId must match the service identifier.')
    }
    const adapterValidation = this.adapterRegistry.validateService(service)
    if (!adapterValidation.valid) {
      throw new Error(adapterValidation.errors.join(' '))
    }

    const registered = await this.registry.register(service)
    await this.emitEvent({
      type: 'service.registered',
      level: 'info',
      serviceId: service.id,
      correlationId: randomUUID(),
      message: 'Local service registered.',
      details: { adapterId: service.adapterId, owner: service.owner.kind },
    })
    return registered
    })
  }

  async getStartPlan(serviceId: string): Promise<DependencyPlan> {
    await this.initialize()
    const services = await this.registry.list()
    const candidatePlan = this.dependencyEngine.buildStartupPlan(serviceId, services)
    if (candidatePlan.order.length === 0 || candidatePlan.blockers.length > 0) return candidatePlan

    const relevantServices = new Set(candidatePlan.order)
    const snapshots = await Promise.all(
      services
        .filter((service) => relevantServices.has(service.id))
        .map(async (service) => this.getSnapshot(service)),
    )
    const ready = snapshots.filter((snapshot) => snapshot.state === 'running').map((snapshot) => snapshot.serviceId)
    const unavailableBlockers = snapshots
      .filter((snapshot) => snapshot.state === 'degraded' || snapshot.state === 'unknown')
      .map((snapshot) => `Service '${snapshot.serviceId}' is ${snapshot.state}; resolve its current process/health state before starting the plan.`)
    const plan = this.dependencyEngine.buildStartupPlan(serviceId, services, ready)
    const capabilityBlockers = plan.toStart.flatMap((id) => {
      const service = services.find((candidate) => candidate.id === id)
      if (!service) return [`Service '${id}' is no longer registered.`]
      if (!service.capabilities.includes('start') || !service.capabilities.includes('stop')) {
        return [`Service '${id}' cannot be started safely because it does not grant both start and stop capabilities.`]
      }
      const adapterValidation = this.adapterRegistry.validateService(service)
      if (!adapterValidation.valid) {
        return [`Service '${id}' has an invalid adapter configuration: ${adapterValidation.errors.join(' ')}`]
      }
      return []
    })
    const blockers = [...plan.blockers, ...capabilityBlockers, ...unavailableBlockers]
    return { ...plan, blockers, canExecute: blockers.length === 0 }
  }

  async executeStartPlan(
    serviceId: string,
    approvedServiceIds: string[],
  ): Promise<RuntimeStartResult> {
    return this.serializeMutation(async () => {
      await this.initialize()
    if (!Array.isArray(approvedServiceIds) || approvedServiceIds.some((id) => typeof id !== 'string')) {
      throw new Error('Approved service identifiers must be an array of strings.')
    }
    const plan = await this.getStartPlan(serviceId)
    if (!plan.canExecute) {
      throw new Error(`Startup plan is blocked: ${plan.blockers.join(' ')}`)
    }
    if (
      approvedServiceIds.length !== plan.toStart.length ||
      approvedServiceIds.some((id, index) => id !== plan.toStart[index])
    ) {
      throw new Error('Startup plan changed since confirmation. Review the updated plan before execution.')
    }

    const definitions = new Map((await this.registry.list()).map((service) => [service.id, service]))
    const startedServiceIds: string[] = []
    try {
      for (const serviceIdToStart of plan.toStart) {
        const service = definitions.get(serviceIdToStart)
        if (!service) throw new Error(`Service '${serviceIdToStart}' disappeared from the registry.`)
        const validation = this.adapterRegistry.validateService(service)
        if (!validation.valid || !validation.adapter?.start || !service.capabilities.includes('start')) {
          throw new Error(validation.errors.join(' ') || `Service '${service.id}' cannot be started.`)
        }
        await validation.adapter.start(service, { operationId: randomUUID() })
        startedServiceIds.push(service.id)
        await this.waitForReady(service)
        await this.emitEvent({
          type: 'service.ready',
          level: 'info',
          serviceId: service.id,
          message: 'Service passed its required readiness checks.',
        })
      }
    } catch (error) {
      for (const startedId of [...startedServiceIds].reverse()) {
        const startedService = definitions.get(startedId)
        if (!startedService) continue
        try {
          const adapter = this.adapterRegistry.get(startedService.adapterId)
          if (adapter?.stop && startedService.capabilities.includes('stop')) {
            await adapter.stop(startedService, { operationId: randomUUID() })
          }
        } catch (rollbackError) {
          await this.emitEvent({
            type: 'service.rollback-failed',
            level: 'error',
            serviceId: startedId,
            message: 'Automatic rollback could not stop a service started by the failed plan.',
            details: { error: rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error.' },
          }).catch(() => undefined)
        }
      }
      throw new Error(
        `Startup plan failed: ${error instanceof Error ? error.message : 'Unknown error.'}`,
        { cause: error },
      )
    }

    const services = await Promise.all(plan.order.map(async (id) => {
      const service = definitions.get(id)!
      return { service, snapshot: await this.getSnapshot(service) }
    }))
    return { plan, startedServiceIds, services }
    })
  }

  async stopService(serviceId: string): Promise<ServiceRuntimeSnapshot> {
    return this.serializeMutation(async () => {
      await this.initialize()
    const service = await this.registry.get(serviceId)
    if (!service) throw new Error(`Service '${serviceId}' is not registered.`)
    const services = await this.registry.list()
    const dependentIds = this.findTransitiveDependents(serviceId, services)

    for (const dependentId of dependentIds) {
      const dependent = services.find((candidate) => candidate.id === dependentId)
      if (!dependent) continue
      const snapshot = await this.getSnapshot(dependent)
      if (['running', 'degraded', 'unknown'].includes(snapshot.state)) {
        throw new Error(
          `Cannot stop '${serviceId}' while dependent service '${dependentId}' is ${snapshot.state}.`,
        )
      }
    }

    const adapter = this.adapterRegistry.get(service.adapterId)
    if (!adapter?.stop || !service.capabilities.includes('stop')) {
      throw new Error(`Service '${serviceId}' does not support stop.`)
    }
    await adapter.stop(service, { operationId: randomUUID() })
    const snapshot = await this.getSnapshot(service)
    await this.emitEvent({
      type: 'service.stopped',
      level: 'info',
      serviceId,
      message: 'Service stop operation completed.',
    })
    return snapshot
    })
  }

  async restartService(serviceId: string): Promise<ServiceRuntimeSnapshot> {
    return this.serializeMutation(async () => {
      await this.initialize()
    const service = await this.registry.get(serviceId)
    if (!service) throw new Error(`Service '${serviceId}' is not registered.`)
    if (!service.capabilities.includes('restart')) throw new Error(`Service '${serviceId}' does not support restart.`)

    const services = await this.registry.list()
    const dependentIds = this.findTransitiveDependents(serviceId, services)
    for (const dependentId of dependentIds) {
      const dependent = services.find((candidate) => candidate.id === dependentId)
      if (!dependent) continue
      const snapshot = await this.getSnapshot(dependent)
      if (['running', 'degraded', 'unknown'].includes(snapshot.state)) {
        throw new Error(`Cannot restart '${serviceId}' while dependent service '${dependentId}' is ${snapshot.state}.`)
      }
    }

    const validation = this.adapterRegistry.validateService(service)
    if (!validation.valid) throw new Error(validation.errors.join(' '))
    const adapter = validation.adapter
    if (!adapter?.restart) throw new Error(`Adapter '${service.adapterId}' does not implement restart.`)
    await adapter.restart(service, { operationId: randomUUID() })
    const snapshot = await this.waitForReady(service)
    await this.emitEvent({
      type: 'service.restarted',
      level: 'info',
      serviceId,
      message: 'Service restarted and passed readiness checks.',
    })
    return snapshot
    })
  }

  async acknowledgeUnobservableStopped(serviceId: string, confirmedStopped: boolean): Promise<ServiceRuntimeSnapshot> {
    return this.serializeMutation(async () => {
      await this.initialize()
    const service = await this.registry.get(serviceId)
    if (!service) throw new Error(`Service '${serviceId}' is not registered.`)
    if (confirmedStopped !== true) throw new Error('Explicit stopped-state confirmation is required.')
    await this.processManager.acknowledgeUnobservableStopped(serviceId, true)
    await this.emitEvent({
      type: 'service.process-ownership-cleared',
      level: 'warn',
      serviceId,
      message: 'Unobservable process ownership was cleared after explicit user confirmation.',
    })
    return this.getSnapshot(service)
    })
  }

  async unregisterService(serviceId: string): Promise<boolean> {
    return this.serializeMutation(async () => {
      await this.initialize()
    const service = await this.registry.get(serviceId)
    if (!service) return false
    const process = await this.processManager.getObservation(serviceId)
    if (process.state === 'present' || process.state === 'unobservable') {
      throw new Error('Cannot unregister a service while its managed process may still be running.')
    }
    const dependents = (await this.registry.list()).filter((candidate) =>
      candidate.dependencies.some((dependency) => dependency.serviceId === serviceId),
    )
    if (dependents.length > 0) {
      throw new Error(`Cannot unregister '${serviceId}' while registered services depend on it: ${dependents.map((item) => item.id).join(', ')}.`)
    }
    const removed = await this.registry.unregister(serviceId)
    if (removed) {
      await this.emitEvent({
        type: 'service.unregistered',
        level: 'warn',
        serviceId,
        message: 'Service registration removed. Managed files and data were not deleted.',
      })
    }
    return removed
    })
  }

  async getRecentEvents(limit = 100): Promise<string[]> {
    await this.initialize()
    return (await this.eventLogger.readRecent(limit)).map((event) =>
      `[${event.occurredAt}] ${event.level.toUpperCase()} ${event.type}: ${event.message}`,
    )
  }

  private async getSnapshot(service: ServiceDefinition): Promise<ServiceRuntimeSnapshot> {
    const adapter = this.adapterRegistry.get(service.adapterId)
    if (!service.capabilities.includes('status') || !service.capabilities.includes('health') || !adapter?.getStatus) {
      throw new Error(`Service '${service.id}' does not grant status and health observation.`)
    }
    const process = await adapter.getStatus(service, { operationId: randomUUID() })
    return this.healthManager.check(service, process)
  }

  private async waitForReady(service: ServiceDefinition): Promise<ServiceRuntimeSnapshot> {
    const deadline = Date.now() + this.readinessTimeoutMs
    let snapshot = await this.getSnapshot(service)
    while (snapshot.state !== 'running' && Date.now() < deadline) {
      if (snapshot.process.state === 'exited' || snapshot.process.state === 'absent' || snapshot.state === 'unknown') {
        throw new Error(`Service '${service.id}' process is not verifiably running.`)
      }
      await new Promise((resolve) => setTimeout(resolve, this.readinessPollIntervalMs))
      snapshot = await this.getSnapshot(service)
    }
    if (snapshot.state !== 'running') {
      throw new Error(`Service '${service.id}' did not become ready within ${this.readinessTimeoutMs} ms.`)
    }
    return snapshot
  }

  private findTransitiveDependents(serviceId: string, services: ServiceDefinition[]): string[] {
    const result = new Set<string>()
    const queue = [serviceId]
    while (queue.length > 0) {
      const dependencyId = queue.shift()!
      for (const service of services) {
        if (result.has(service.id)) continue
        if (service.dependencies.some((dependency) => dependency.serviceId === dependencyId)) {
          result.add(service.id)
          queue.push(service.id)
        }
      }
    }
    return [...result]
  }
}
