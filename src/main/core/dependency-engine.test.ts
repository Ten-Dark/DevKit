import { describe, expect, it } from 'vitest'
import { DependencyEngine } from './dependency-engine.js'
import type { ServiceDefinition } from './contracts.js'

function service(
  id: string,
  dependencies: ServiceDefinition['dependencies'] = [],
  version = '1.2.0',
  capabilities: ServiceDefinition['capabilities'] = ['status', 'health', 'start', 'stop'],
): ServiceDefinition {
  return {
    id,
    name: id,
    version,
    adapterId: 'process.local',
    owner: { kind: 'managed', resourceId: id },
    capabilities,
    platforms: ['win32'],
    dependencies,
    config: {},
  }
}

describe('dependency engine', () => {
  const engine = new DependencyEngine()

  it('builds provider-first order including transitive dependencies', () => {
    const services = [
      service('application', [{ serviceId: 'api', required: true }]),
      service('api', [{ serviceId: 'database', required: true }]),
      service('database'),
    ]

    expect(engine.buildStartupPlan('application', services).order).toEqual([
      'database',
      'api',
      'application',
    ])
  })

  it('skips dependencies that are already ready and reverses shutdown order', () => {
    const services = [
      service('application', [{ serviceId: 'api', required: true }]),
      service('api'),
    ]
    const plan = engine.buildStartupPlan('application', services, ['api'])

    expect(plan.order).toEqual(['api', 'application'])
    expect(plan.alreadyReady).toEqual(['api'])
    expect(plan.toStart).toEqual(['application'])
    expect(plan.shutdownOrder).toEqual(['application'])
  })

  it('blocks plans with missing required dependencies', () => {
    const plan = engine.buildStartupPlan('application', [
      service('application', [{ serviceId: 'database', required: true }]),
    ])

    expect(plan.canExecute).toBe(false)
    expect(plan.blockers).toContain(
      "Service 'application' depends on missing service 'database'.",
    )
  })

  it('warns and skips missing optional dependencies', () => {
    const plan = engine.buildStartupPlan('application', [
      service('application', [{ serviceId: 'metrics', required: false }]),
    ])

    expect(plan.canExecute).toBe(true)
    expect(plan.order).toEqual(['application'])
    expect(plan.warnings[0]).toContain('Optional dependency skipped')
  })

  it('rejects cycles before returning an executable plan', () => {
    const plan = engine.buildStartupPlan('application', [
      service('application', [{ serviceId: 'api', required: true }]),
      service('api', [{ serviceId: 'application', required: true }]),
    ])

    expect(plan.canExecute).toBe(false)
    expect(plan.blockers.some((blocker) => blocker.includes('Dependency cycle detected'))).toBe(true)
  })

  it('checks exact, caret, tilde and minimum version constraints', () => {
    const services = [
      service('application', [
        { serviceId: 'stable', required: true, versionConstraint: '^1.1.0' },
        { serviceId: 'patch', required: true, versionConstraint: '~2.3.0' },
        { serviceId: 'minimum', required: true, versionConstraint: '>=3.0.0' },
      ]),
      service('stable', [], '1.9.0'),
      service('patch', [], '2.3.8'),
      service('minimum', [], '3.0.1'),
    ]

    expect(engine.buildStartupPlan('application', services).canExecute).toBe(true)
  })

  it('applies semver caret upper bounds for zero-major versions', () => {
    const compatible = engine.buildStartupPlan('application', [
      service('application', [{ serviceId: 'api', required: true, versionConstraint: '^0.2.0' }]),
      service('api', [], '0.2.9'),
    ])
    const incompatible = engine.buildStartupPlan('application', [
      service('application', [{ serviceId: 'api', required: true, versionConstraint: '^0.2.0' }]),
      service('api', [], '0.3.0'),
    ])

    expect(compatible.canExecute).toBe(true)
    expect(incompatible.canExecute).toBe(false)
  })

  it('blocks incompatible required versions and capabilities', () => {
    const plan = engine.buildStartupPlan('application', [
      service('application', [
        { serviceId: 'api', required: true, versionConstraint: '^2.0.0', capability: 'logs' },
      ]),
      service('api', [], '1.0.0', ['status']),
    ])

    expect(plan.canExecute).toBe(false)
    expect(plan.blockers[0]).toContain('does not satisfy')
    expect(plan.blockers[0]).toContain('not supported')
  })

  it('reports an unknown target and duplicate service identifiers', () => {
    expect(engine.buildStartupPlan('missing', []).blockers).toContain(
      "Target service 'missing' is not registered.",
    )

    const duplicate = engine.buildStartupPlan('api', [service('api'), service('api')])
    expect(duplicate.canExecute).toBe(false)
    expect(duplicate.blockers).toContain("Service 'api' is registered more than once.")
  })
})
