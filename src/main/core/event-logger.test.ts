import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RuntimeEventLogger } from './event-logger.js'

let tempDir: string
let filePath: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-events-'))
  filePath = path.join(tempDir, 'events', 'runtime.jsonl')
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('runtime event logger', () => {
  it('writes structured events with correlation identifiers', async () => {
    const logger = new RuntimeEventLogger({ filePath })
    const event = await logger.emit({ type: 'service.started', level: 'info', message: 'Service started' })

    expect(event.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(event.correlationId).toMatch(/^[0-9a-f-]{36}$/i)
    expect((await logger.readRecent())[0]).toEqual(event)
  })

  it('redacts secret fields and credential-like text recursively', async () => {
    const logger = new RuntimeEventLogger({ filePath })
    const event = await logger.emit({
      type: 'service.failure',
      level: 'error',
      message: 'Request failed with Bearer abc.def.ghi and api_key=visible-key',
      details: {
        accessToken: 'top-secret',
        nested: {
          password: 'also-secret',
          note: 'Authorization: Bearer visible-token',
        },
        safe: 'diagnostic',
      },
    })

    expect(event.message).not.toContain('abc.def.ghi')
    expect(event.message).not.toContain('visible-key')
    expect(event.details).toEqual({
      accessToken: '[REDACTED]',
      nested: {
        password: '[REDACTED]',
        note: 'Authorization: Bearer [REDACTED]',
      },
      safe: 'diagnostic',
    })
    const persisted = await fs.readFile(filePath, 'utf8')
    expect(persisted).not.toContain('top-secret')
    expect(persisted).not.toContain('visible-token')
  })

  it('serializes concurrent events and preserves correlation IDs', async () => {
    const logger = new RuntimeEventLogger({ filePath })
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      logger.emit({
        type: 'test.concurrent',
        level: 'debug',
        message: `event ${index}`,
        correlationId: 'operation-1',
      }),
    ))

    const events = await logger.readRecent(100)
    expect(events).toHaveLength(20)
    expect(new Set(events.map((event) => event.id)).size).toBe(20)
    expect(events.every((event) => event.correlationId === 'operation-1')).toBe(true)
  })

  it('rotates bounded log files and retains recent events', async () => {
    const logger = new RuntimeEventLogger({ filePath, maxBytes: 4_096, maxFiles: 2 })
    for (let index = 0; index < 8; index += 1) {
      await logger.emit({
        type: 'test.rotation',
        level: 'info',
        message: `event-${index}-${'x'.repeat(1_800)}`,
      })
    }

    const files = await fs.readdir(path.dirname(filePath))
    expect(files.sort()).toEqual(['runtime.jsonl', 'runtime.jsonl.1', 'runtime.jsonl.2'])
    for (const file of files) {
      expect((await fs.stat(path.join(path.dirname(filePath), file))).size).toBeLessThanOrEqual(4_096)
    }
    const events = await logger.readRecent(100)
    expect(events.length).toBeGreaterThan(0)
    expect(events.length).toBeLessThan(8)
    expect(events.at(-1)?.message).toContain('event-7')
  })

  it('rejects a symbolic-link event log rather than following it', async () => {
    const external = path.join(tempDir, 'external.jsonl')
    await fs.writeFile(external, '')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.symlink(external, filePath, 'file')

    const logger = new RuntimeEventLogger({ filePath })
    await expect(logger.emit({ type: 'test', level: 'info', message: 'blocked' })).rejects.toThrow(/regular file/)
    expect(await fs.readFile(external, 'utf8')).toBe('')
  })
})
