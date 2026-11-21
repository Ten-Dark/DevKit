import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ServiceRegistryStore, SERVICE_REGISTRY_SCHEMA_VERSION } from './service-registry-store.js'
import type { ServiceDefinition } from './contracts.js'

let tempDir: string
let filePath: string
let store: ServiceRegistryStore

const makeService = (id: string): ServiceDefinition => ({
  id,
  name: id,
  version: '1.0.0',
  adapterId: 'process.local',
  owner: { kind: 'managed', resourceId: id },
  capabilities: ['status', 'health'],
  platforms: ['win32'],
  dependencies: [],
  config: {},
})

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-registry-'))
  filePath = path.join(tempDir, 'registry', 'services.json')
  store = new ServiceRegistryStore({ filePath })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('service registry persistence', () => {
  it('creates a versioned registry and persists registered services', async () => {
    await store.register(makeService('api'))

    const document = JSON.parse(await fs.readFile(filePath, 'utf8'))
    expect(document.schemaVersion).toBe(SERVICE_REGISTRY_SCHEMA_VERSION)
    expect(document.revision).toBe(1)
    expect(document.services).toEqual([makeService('api')])
    expect(await store.get('api')).toEqual(makeService('api'))
  })

  it('rejects invalid and duplicate registrations without changing the document', async () => {
    await store.register(makeService('api'))
    const before = await fs.readFile(filePath, 'utf8')

    await expect(store.register({ ...makeService('bad'), id: '../bad' })).rejects.toThrow(/Invalid service definition/)
    await expect(store.register(makeService('api'))).rejects.toThrow(/already registered/)
    expect(await fs.readFile(filePath, 'utf8')).toBe(before)
  })

  it('serializes concurrent registrations without losing entries', async () => {
    await Promise.all([
      store.register(makeService('api')),
      store.register(makeService('worker')),
      store.register(makeService('database')),
    ])

    expect((await store.list()).map((service) => service.id).sort()).toEqual(['api', 'database', 'worker'])
    const document = JSON.parse(await fs.readFile(filePath, 'utf8'))
    expect(document.revision).toBe(3)
  })

  it('replaces an existing definition without allowing identity changes', async () => {
    await store.register(makeService('api'))
    const updated = { ...makeService('api'), name: 'Updated API' }

    await expect(store.replace('api', { ...updated, id: 'other' })).rejects.toThrow(/cannot change its identifier/)
    await expect(store.replace('api', updated)).resolves.toEqual(updated)
    expect((await store.get('api'))?.name).toBe('Updated API')
  })

  it('unregisters only the requested service', async () => {
    await store.register(makeService('api'))
    await store.register(makeService('worker'))

    await expect(store.unregister('missing')).resolves.toBe(false)
    await expect(store.unregister('api')).resolves.toBe(true)
    expect((await store.list()).map((service) => service.id)).toEqual(['worker'])
  })

  it('recovers a corrupt registry from its validated backup and quarantines the source', async () => {
    await store.register(makeService('api'))
    await store.register(makeService('worker'))
    await fs.writeFile(filePath, '{broken')

    expect((await store.list()).map((service) => service.id)).toEqual(['api'])
    const names = await fs.readdir(path.dirname(filePath))
    expect(names.some((name) => name.startsWith('services.json.corrupt-'))).toBe(true)
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).services.map((service: ServiceDefinition) => service.id)).toEqual(['api'])
  })

  it('recovers a missing registry file from its validated backup', async () => {
    await store.register(makeService('api'))
    await store.register(makeService('worker'))
    await fs.unlink(filePath)

    const recovered = new ServiceRegistryStore({ filePath })
    expect((await recovered.list()).map((service) => service.id)).toEqual(['api'])
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).revision).toBe(1)
  })

  it('does not initialize an empty registry over an invalid backup', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(`${filePath}.bak`, '{broken')

    await expect(store.list()).rejects.toThrow(/backup is invalid/)
    expect(await fs.readFile(`${filePath}.bak`, 'utf8')).toBe('{broken')
    await expect(fs.access(filePath)).rejects.toThrow()
  })

  it('preserves invalid registry data when no valid backup exists', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, '{broken')

    await expect(store.list()).rejects.toThrow(/no valid backup/)
    expect(await fs.readFile(filePath, 'utf8')).toBe('{broken')
  })

  it('preserves the current registry when an atomic replacement fails', async () => {
    await store.register(makeService('api'))
    const before = await fs.readFile(filePath, 'utf8')
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename blocked'))

    await expect(store.register(makeService('worker'))).rejects.toThrow('rename blocked')
    expect(await fs.readFile(filePath, 'utf8')).toBe(before)
    expect((await fs.readdir(path.dirname(filePath))).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
