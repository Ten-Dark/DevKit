import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RuntimeEvent, RuntimeEventLevel } from './contracts.js'
import { ensureSafeDirectory, resolveWorkspacePaths } from '../workspace.js'

const SECRET_KEY_PATTERN = /(secret|token|password|passwd|authorization|api[-_]?key|private[-_]?key|credential|cookie)/i
const SECRET_TEXT_PATTERNS = [
  /(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /((?:password|token|api[-_]?key|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
  /(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi,
]

export interface RuntimeEventInput {
  type: string
  level: RuntimeEventLevel
  message: string
  correlationId?: string
  serviceId?: string
  details?: Record<string, unknown>
}

export interface RuntimeEventLoggerOptions {
  filePath?: string
  maxBytes?: number
  maxFiles?: number
  maxEventBytes?: number
}

function redactText(value: string): string {
  let sanitized = value.slice(0, 4_096)
  for (const pattern of SECRET_TEXT_PATTERNS) {
    sanitized = sanitized.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
  }
  return sanitized
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]'
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1))
  if (!value || typeof value !== 'object') return String(value)

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value).slice(0, 100)) {
    result[key.slice(0, 120)] = SECRET_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitizeValue(nested, depth + 1)
  }
  return result
}

function isRegularFile(stat: Awaited<ReturnType<typeof fs.lstat>>): boolean {
  return !stat.isSymbolicLink() && stat.isFile()
}

export class RuntimeEventLogger {
  readonly filePath: string
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly maxEventBytes: number
  private queue: Promise<void> = Promise.resolve()

  constructor(options: RuntimeEventLoggerOptions = {}) {
    this.filePath = options.filePath ?? path.join(resolveWorkspacePaths().events, 'runtime.jsonl')
    this.maxBytes = Math.max(4_096, options.maxBytes ?? 1_048_576)
    this.maxFiles = Math.max(1, Math.min(10, options.maxFiles ?? 3))
    this.maxEventBytes = Math.max(1_024, Math.min(this.maxBytes, options.maxEventBytes ?? 32_768))
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async rotateIfNeeded(nextLineBytes: number): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.filePath))
    let currentSize: number
    try {
      const stat = await fs.lstat(this.filePath)
      if (!isRegularFile(stat)) throw new Error('Runtime event log must be a regular file.')
      currentSize = stat.size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    if (currentSize + nextLineBytes <= this.maxBytes) return

    for (let index = this.maxFiles; index >= 1; index -= 1) {
      const source = index === 1 ? this.filePath : `${this.filePath}.${index - 1}`
      const destination = `${this.filePath}.${index}`
      try {
        const sourceStat = await fs.lstat(source)
        if (!isRegularFile(sourceStat)) throw new Error(`Runtime event archive must be a regular file: ${source}`)
        if (index === this.maxFiles) await fs.unlink(destination).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
        await fs.rename(source, destination)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }

  async emit(input: RuntimeEventInput): Promise<RuntimeEvent> {
    return this.enqueue(async () => {
      if (!input.type.trim() || input.type.length > 120) throw new Error('Event type must contain 1 to 120 characters.')
      if (!input.message.trim()) throw new Error('Event message must not be empty.')

      const event: RuntimeEvent = {
        id: randomUUID(),
        type: input.type,
        level: input.level,
        occurredAt: new Date().toISOString(),
        correlationId: input.correlationId ?? randomUUID(),
        ...(input.serviceId ? { serviceId: input.serviceId } : {}),
        message: redactText(input.message).slice(0, 2_048),
        ...(input.details ? { details: sanitizeValue(input.details) as Record<string, unknown> } : {}),
      }
      let line = `${JSON.stringify(event)}\n`
      if (Buffer.byteLength(line, 'utf8') > this.maxEventBytes) {
        event.details = { truncated: true, reason: 'event-size-limit' }
        event.message = event.message.slice(0, 512)
        line = `${JSON.stringify(event)}\n`
      }

      await this.rotateIfNeeded(Buffer.byteLength(line, 'utf8'))
      await fs.appendFile(this.filePath, line, { encoding: 'utf8' })
      return event
    })
  }

  async readRecent(limit = 100): Promise<RuntimeEvent[]> {
    return this.enqueue(async () => {
      await ensureSafeDirectory(path.dirname(this.filePath))
      const events: RuntimeEvent[] = []
      const files = Array.from({ length: this.maxFiles + 1 }, (_, index) =>
        index === 0 ? this.filePath : `${this.filePath}.${index}`,
      )

      for (const file of files) {
        try {
          const stat = await fs.lstat(file)
          if (!isRegularFile(stat)) throw new Error(`Runtime event archive must be a regular file: ${file}`)
          const content = await fs.readFile(file, 'utf8')
          for (const line of content.split(/\r?\n/)) {
            if (!line) continue
            try {
              const parsed = JSON.parse(line) as RuntimeEvent
              if (parsed && typeof parsed.id === 'string' && typeof parsed.type === 'string') events.push(parsed)
            } catch {
              // A crash may leave a partial final line. Ignore only that record.
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }

      return events
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
        .slice(-Math.max(1, Math.min(1_000, limit)))
    })
  }
}
