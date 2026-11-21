import type { ServiceDefinition } from './contracts.js'

export interface DependencyPlan {
  targetServiceId: string
  order: string[]
  toStart: string[]
  alreadyReady: string[]
  shutdownOrder: string[]
  blockers: string[]
  warnings: string[]
  canExecute: boolean
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

function satisfiesVersion(version: string, constraint?: string): boolean {
  if (!constraint || constraint === '*') return true
  const operator = constraint.startsWith('>=') ? '>=' : constraint[0] === '^' || constraint[0] === '~' ? constraint[0] : '='
  const requiredText = operator === '>=' ? constraint.slice(2) : operator === '=' ? constraint : constraint.slice(1)
  const actual = parseVersion(version)
  const required = parseVersion(requiredText)
  if (!actual || !required) return operator === '=' && version === requiredText

  const comparison = compareVersions(actual, required)
  if (operator === '>=') return comparison >= 0
  if (operator === '^') {
    const compatible = required.major > 0
      ? actual.major === required.major
      : required.minor > 0
        ? actual.major === 0 && actual.minor === required.minor
        : actual.major === 0 && actual.minor === 0 && actual.patch === required.patch
    return compatible && comparison >= 0
  }
  if (operator === '~') return actual.major === required.major && actual.minor === required.minor && comparison >= 0
  return comparison === 0
}

export class DependencyEngine {
  buildStartupPlan(
    targetServiceId: string,
    services: ServiceDefinition[],
    readyServiceIds: Iterable<string> = [],
  ): DependencyPlan {
    const blockers: string[] = []
    const warnings: string[] = []
    const byId = new Map<string, ServiceDefinition>()

    for (const service of services) {
      if (byId.has(service.id)) {
        blockers.push(`Service '${service.id}' is registered more than once.`)
      } else {
        byId.set(service.id, service)
      }
    }

    if (!byId.has(targetServiceId)) {
      blockers.push(`Target service '${targetServiceId}' is not registered.`)
      return this.createPlan(targetServiceId, [], new Set(readyServiceIds), blockers, warnings)
    }

    const visited = new Set<string>()
    const visiting: string[] = []
    const cycleKeys = new Set<string>()

    const visit = (serviceId: string): void => {
      if (visited.has(serviceId)) return
      const cycleStart = visiting.indexOf(serviceId)
      if (cycleStart >= 0) {
        const cycle = [...visiting.slice(cycleStart), serviceId]
        const cycleKey = cycle.join(' -> ')
        if (!cycleKeys.has(cycleKey)) {
          cycleKeys.add(cycleKey)
          blockers.push(`Dependency cycle detected: ${cycleKey}.`)
        }
        return
      }

      const service = byId.get(serviceId)
      if (!service) return
      visiting.push(serviceId)

      for (const dependency of service.dependencies) {
        const provider = byId.get(dependency.serviceId)
        if (!provider) {
          const message = `Service '${serviceId}' depends on missing service '${dependency.serviceId}'.`
          if (dependency.required) blockers.push(message)
          else warnings.push(`Optional dependency skipped: ${message}`)
          continue
        }

        const versionMatches = satisfiesVersion(provider.version, dependency.versionConstraint)
        const capabilityMatches = !dependency.capability || provider.capabilities.includes(dependency.capability)
        if (!versionMatches || !capabilityMatches) {
          const reasons = [
            ...(!versionMatches ? [`version '${provider.version}' does not satisfy '${dependency.versionConstraint}'`] : []),
            ...(!capabilityMatches ? [`capability '${dependency.capability}' is not supported`] : []),
          ]
          const message = `Dependency '${dependency.serviceId}' required by '${serviceId}' is incompatible: ${reasons.join('; ')}.`
          if (dependency.required) blockers.push(message)
          else warnings.push(`Optional dependency skipped: ${message}`)
          continue
        }

        visit(provider.id)
      }

      visiting.pop()
      visited.add(serviceId)
    }

    visit(targetServiceId)

    // DFS post-order yields provider-before-consumer startup order.
    const order = [...visited]
    const ready = new Set(readyServiceIds)
    return this.createPlan(targetServiceId, order, ready, blockers, warnings)
  }

  private createPlan(
    targetServiceId: string,
    order: string[],
    ready: Set<string>,
    blockers: string[],
    warnings: string[],
  ): DependencyPlan {
    const alreadyReady = order.filter((serviceId) => ready.has(serviceId))
    const toStart = order.filter((serviceId) => !ready.has(serviceId))
    return {
      targetServiceId,
      order,
      toStart,
      alreadyReady,
      shutdownOrder: [...toStart].reverse(),
      blockers,
      warnings,
      canExecute: blockers.length === 0,
    }
  }
}
