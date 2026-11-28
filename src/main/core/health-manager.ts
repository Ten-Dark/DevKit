import type {
  HealthCheckResult,
  ProcessObservation,
  ServiceAggregateState,
  ServiceDefinition,
  ServiceRuntimeSnapshot,
} from './contracts.js'

export class StaleHealthCheckError extends Error {
  constructor(serviceId: string) {
    super(`Health check result for '${serviceId}' was superseded by a newer check.`)
    this.name = 'StaleHealthCheckError'
  }
}

export interface HealthManagerOptions {
  fetcher?: typeof fetch
  now?: () => number
}

export class HealthManager {
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly generations = new Map<string, number>()
  private readonly snapshots = new Map<string, ServiceRuntimeSnapshot>()

  constructor(options: HealthManagerOptions = {}) {
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
  }

  async check(
    service: ServiceDefinition,
    process: ProcessObservation,
  ): Promise<ServiceRuntimeSnapshot> {
    const generation = (this.generations.get(service.id) ?? 0) + 1
    this.generations.set(service.id, generation)

    const checkedAt = new Date(this.now()).toISOString()
    const processVerified = process.state === 'present'
      && (process.identityVerified || process.ownership === 'external')
    const healthChecks: HealthCheckResult[] = [{
      id: 'process',
      type: 'process',
      state: processVerified
        ? 'pass'
        : process.state === 'absent' || process.state === 'exited'
          ? 'fail'
          : 'unknown',
      checkedAt,
      durationMs: 0,
      message: processVerified
        ? process.ownership === 'external'
          ? 'External service is present; process control remains with its external owner.'
          : 'Managed process is present and identity is verified.'
        : process.state === 'unobservable'
          ? 'Process identity cannot be verified in this session.'
          : process.state === 'exited'
            ? 'Managed process has exited.'
            : 'No managed process is running.',
    }]

    if (service.readinessProbe) {
      if (processVerified) {
        healthChecks.push(await this.runHttpProbe(service))
      } else {
        healthChecks.push({
          id: 'readiness',
          type: 'http',
          state: 'unknown',
          checkedAt: new Date(this.now()).toISOString(),
          durationMs: 0,
          message: 'Readiness probe skipped because the process is not verified as present.',
        })
      }
    }


    if (this.generations.get(service.id) !== generation) {
      const latest = this.snapshots.get(service.id)
      if (latest) return latest
      throw new StaleHealthCheckError(service.id)
    }

    const state = this.deriveAggregateState(process, healthChecks)
    const snapshot: ServiceRuntimeSnapshot = {
      serviceId: service.id,
      state,
      process,
      healthChecks,
      observedAt: new Date(this.now()).toISOString(),
      ...(state === 'running' ? {} : { reason: this.describeState(process, healthChecks, state) }),
    }
    this.snapshots.set(service.id, snapshot)
    return snapshot
  }

  getLatest(serviceId: string): ServiceRuntimeSnapshot | undefined {
    return this.snapshots.get(serviceId)
  }

  private async runHttpProbe(service: ServiceDefinition): Promise<HealthCheckResult> {
    const probe = service.readinessProbe
    if (!probe) throw new Error('HTTP readiness probe is not configured.')

    const startedAt = this.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), probe.timeoutMs)
    try {
      const response = await this.fetcher(probe.url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
      })
      const expected = probe.expectedStatusCodes ?? [200]
      const status = response.status
      await response.body?.cancel().catch(() => undefined)
      const passed = expected.includes(status)
      return {
        id: 'readiness',
        type: 'http',
        state: passed ? 'pass' : 'fail',
        checkedAt: new Date(this.now()).toISOString(),
        durationMs: Math.max(0, this.now() - startedAt),
        message: passed
          ? `Readiness endpoint returned HTTP ${status}.`
          : `Readiness endpoint returned unexpected HTTP ${status}.`,
      }
    } catch {
      const timedOut = controller.signal.aborted
      return {
        id: 'readiness',
        type: 'http',
        state: 'fail',
        checkedAt: new Date(this.now()).toISOString(),
        durationMs: Math.max(0, this.now() - startedAt),
        message: timedOut ? 'Readiness probe timed out.' : 'Readiness endpoint is unavailable.',
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private deriveAggregateState(
    process: ProcessObservation,
    checks: HealthCheckResult[],
  ): ServiceAggregateState {
    if (process.state === 'absent') return 'stopped'
    if (process.state === 'exited') return 'failed'
    if (process.state === 'unobservable'
      || (process.state === 'present' && !process.identityVerified && process.ownership !== 'external')) return 'unknown'
    if (checks.some((check) => check.state === 'fail')) return 'degraded'
    if (checks.some((check) => check.state === 'unknown')) return 'degraded'
    return 'running'
  }

  private describeState(
    process: ProcessObservation,
    checks: HealthCheckResult[],
    state: ServiceAggregateState,
  ): string {
    if (process.state === 'absent') return 'No DevKit-managed process is running.'
    if (process.state === 'exited') return 'The managed process exited.'
    if (state === 'unknown') return 'Process ownership or observation is insufficient to determine service health.'
    return checks.find((check) => check.state !== 'pass')?.message ?? 'Service is not fully ready.'
  }
}
