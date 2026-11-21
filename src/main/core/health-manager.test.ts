import { describe, expect, it, vi } from 'vitest'
import { HealthManager } from './health-manager.js'
import type { ProcessObservation, ServiceDefinition } from './contracts.js'

const service: ServiceDefinition = {
  id: 'local-api',
  name: 'Local API',
  version: '1.0.0',
  adapterId: 'process.local',
  owner: { kind: 'managed', resourceId: 'local-api' },
  capabilities: ['status', 'health', 'start', 'stop'],
  platforms: ['win32'],
  dependencies: [],
  config: {},
  readinessProbe: {
    type: 'http',
    url: 'http://127.0.0.1:4317/health',
    timeoutMs: 100,
    expectedStatusCodes: [200],
  },
}

const present: ProcessObservation = {
  state: 'present',
  observedAt: new Date().toISOString(),
  pid: 1234,
  identityVerified: true,
}

describe('health manager', () => {
  it('reports running only when process identity and readiness both pass', async () => {
    const manager = new HealthManager({ fetcher: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) })
    const snapshot = await manager.check(service, present)

    expect(snapshot.state).toBe('running')
    expect(snapshot.healthChecks.map((check) => check.state)).toEqual(['pass', 'pass'])
  })

  it('reports degraded when the process exists but readiness fails', async () => {
    const manager = new HealthManager({ fetcher: vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })) })
    const snapshot = await manager.check(service, present)

    expect(snapshot.state).toBe('degraded')
    expect(snapshot.reason).toContain('unexpected HTTP 503')
  })

  it('does not probe readiness when no managed process is present', async () => {
    const fetcher = vi.fn()
    const manager = new HealthManager({ fetcher })
    const snapshot = await manager.check(service, {
      state: 'absent',
      observedAt: new Date().toISOString(),
      identityVerified: false,
    })

    expect(snapshot.state).toBe('stopped')
    expect(fetcher).not.toHaveBeenCalled()
    expect(snapshot.healthChecks[1].state).toBe('unknown')
  })

  it('reports unknown when process ownership cannot be verified', async () => {
    const manager = new HealthManager({ fetcher: vi.fn() })
    const snapshot = await manager.check(service, {
      state: 'unobservable',
      observedAt: new Date().toISOString(),
      pid: 1234,
      identityVerified: false,
    })

    expect(snapshot.state).toBe('unknown')
    expect(snapshot.reason).toContain('insufficient')
  })

  it('uses a bounded timeout and does not expose raw network errors', async () => {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('sensitive URL details')), { once: true })
      }),
    )
    const manager = new HealthManager({ fetcher: fetcher as typeof fetch })
    const snapshot = await manager.check(service, present)

    expect(snapshot.state).toBe('degraded')
    expect(snapshot.reason).toBe('Readiness probe timed out.')
    expect(snapshot.reason).not.toContain('sensitive')
  })

  it('does not allow an older slow result to overwrite a newer health snapshot', async () => {
    let resolveFirst!: (response: Response) => void
    let firstStarted!: () => void
    const started = new Promise<void>((resolve) => { firstStarted = resolve })
    let calls = 0
    const fetcher = vi.fn(() => {
      calls += 1
      if (calls === 1) {
        firstStarted()
        return new Promise<Response>((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve(new Response('ok', { status: 200 }))
    })
    const manager = new HealthManager({ fetcher: fetcher as typeof fetch })

    const older = manager.check(service, present)
    await started
    const newer = await manager.check(service, present)
    resolveFirst(new Response('late failure', { status: 503 }))
    const stale = await older

    expect(newer.state).toBe('running')
    expect(stale).toBe(newer)
    expect(manager.getLatest(service.id)).toBe(newer)
  })
})
