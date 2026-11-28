import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { SecretProvider, SecretProviderCapabilities, SecretProviderEntry } from './secret-provider.js'

const MAX_SECRET_OUTPUT = 16 * 1024
const MAX_ENTRY_LIST_OUTPUT = 256 * 1024
const MAX_LISTED_ENTRIES = 5_000
const CACHED_UNLOCK_TTL_MS = 120_000
const UNLOCK_TIMEOUT_MS = 60_000
const activeUnlockProcesses = new Set<ChildProcess>()

function terminateProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => undefined)
  }
  child.kill()
  activeUnlockProcesses.delete(child)
}

export interface KeePassXCReference {
  databasePath: string
  entryPath: string
  attribute: string
}

export interface KeePassXCProviderOptions {
  cliPath: string
  keyFilePath?: string
  listEntriesWithPassword?: (args: {
    cliPath: string
    databasePath: string
    unlockPassword: string
    keyFilePath?: string
  }) => Promise<SecretProviderEntry[]>
  resolveWithPassword?: (args: {
    cliPath: string
    databasePath: string
    entryPath: string
    attribute: string
    unlockPassword: string
    keyFilePath?: string
  }) => Promise<string>
}

function parseReference(value: Record<string, unknown>): KeePassXCReference {
  if (typeof value.databasePath !== 'string' || !path.isAbsolute(value.databasePath)
    || value.databasePath.length > 4_096) {
    throw new Error('KeePassXC database path must be an absolute path.')
  }
  if (typeof value.entryPath !== 'string' || value.entryPath.trim().length === 0
    || value.entryPath.length > 2_048 || value.entryPath.includes(String.fromCharCode(0)) || value.entryPath.includes(String.fromCharCode(10)) || value.entryPath.includes(String.fromCharCode(13)) || value.entryPath.includes('"')) {
    throw new Error('KeePassXC entry path is invalid.')
  }
  const attribute = value.attribute === undefined ? 'Password' : value.attribute
  if (typeof attribute !== 'string' || !/^[A-Za-z][A-Za-z0-9 _-]{0,63}$/u.test(attribute)) {
    throw new Error('KeePassXC attribute name is invalid.')
  }
  return {
    databasePath: path.resolve(value.databasePath),
    entryPath: value.entryPath.split('/').map((part) => part.trim()).filter(Boolean).join('/'),
    attribute,
  }
}

function runKeePassXC(input: {
  cliPath: string
  databasePath: string
  entryPath: string
  attribute: string
  unlockPassword: string
  keyFilePath?: string
}): Promise<string> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('KeePassXC password-based unlock is currently supported only on Windows.'))
  }
  if (!input.unlockPassword || input.unlockPassword.length > 4_096
    || input.unlockPassword.includes(String.fromCharCode(0)) || input.unlockPassword.includes(String.fromCharCode(10)) || input.unlockPassword.includes(String.fromCharCode(13))) {
    return Promise.reject(new Error('KeePassXC master password is invalid.'))
  }

  const args = ['show', '--quiet', '--show-protected', '--attributes', input.attribute]
  if (input.keyFilePath) args.push('--key-file', input.keyFilePath)
  args.push(input.databasePath, input.entryPath)

  return new Promise((resolve, reject) => {
    const child = spawn(input.cliPath, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    activeUnlockProcesses.add(child)
    let output = ''
    let diagnostics = ''
    let settled = false
    const finish = (error?: Error, secret?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      activeUnlockProcesses.delete(child)
      if (error) reject(error)
      else resolve(secret!)
    }
    const timeout = setTimeout(() => {
      terminateProcessTree(child)
      finish(new Error('KeePassXC unlock timed out.'))
    }, UNLOCK_TIMEOUT_MS)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
      if (Buffer.byteLength(output, 'utf8') > MAX_SECRET_OUTPUT) {
        terminateProcessTree(child)
        finish(new Error('KeePassXC secret output exceeded the supported size limit.'))
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      diagnostics = (diagnostics + chunk).slice(-4_096)
    })
    child.on('error', () => finish(new Error('Could not start KeePassXC CLI.')))
    child.on('close', (code) => {
      if (code !== 0) {
        if (/(wrong|incorrect|invalid).{0,30}(password|credentials|key)|failed to decrypt|invalid credentials|неверн.{0,30}(парол|ключ)|неправильн.{0,30}(парол|ключ)|не удалось расшифр/iu.test(diagnostics)) {
          finish(new Error('KeePassXC could not unlock the database. Check the master password and any configured key file.'))
          return
        }
        if (/(could not find (the )?(entry|group)|entry.*(not found|does not exist)|group.*(not found|does not exist)|attribute.*(not found|does not exist)|не удалось найти (запис|групп|атрибут)|не найден[ао]? запись|запис[ьи].*не найден|групп[аы].*не найден|атрибут.*не найден)/iu.test(diagnostics)) {
          finish(new Error('KeePassXC could not find the configured entry or attribute. Check the full group/entry path and attribute name.'))
          return
        }
        if (/(database.*(not found|does not exist|could not open)|file not found|could not open database|не удалось открыть баз[ауы]|файл не найден|баз[аы].*не найден)/iu.test(diagnostics)) {
          finish(new Error('KeePassXC could not open the database. Verify the database path and file access.'))
          return
        }
        finish(new Error('KeePassXC CLI failed to read the configured entry (exit code ' + String(code) + ').'))
        return
      }
      const secret = output.trimEnd()
      if (!secret || secret.includes(String.fromCharCode(10)) || secret.includes(String.fromCharCode(13)) || secret.includes(String.fromCharCode(0))) {
        finish(new Error('KeePassXC returned an empty or ambiguous secret value.'))
        return
      }
      finish(undefined, secret)
    })

    child.stdin?.on('error', () => {
      // The process may close stdin after rejecting the supplied password.
    })
    child.stdin?.end(input.unlockPassword + String.fromCharCode(10))
  })
}

function runKeePassXCList(input: {
  cliPath: string
  databasePath: string
  unlockPassword: string
  keyFilePath?: string
}): Promise<SecretProviderEntry[]> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('KeePassXC entry browsing is currently supported only on Windows.'))
  }
  if (!input.unlockPassword || input.unlockPassword.length > 4_096
    || input.unlockPassword.includes(String.fromCharCode(0))
    || input.unlockPassword.includes(String.fromCharCode(10))
    || input.unlockPassword.includes(String.fromCharCode(13))) {
    return Promise.reject(new Error('KeePassXC master password is invalid.'))
  }

  const args = ['ls', '--quiet', '--recursive', '--flatten']
  if (input.keyFilePath) args.push('--key-file', input.keyFilePath)
  args.push(input.databasePath)

  return new Promise((resolve, reject) => {
    const child = spawn(input.cliPath, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    activeUnlockProcesses.add(child)
    let output = ''
    let diagnostics = ''
    let settled = false
    const finish = (error?: Error, entries?: SecretProviderEntry[]) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      activeUnlockProcesses.delete(child)
      if (error) reject(error)
      else resolve(entries ?? [])
    }
    const timeout = setTimeout(() => {
      terminateProcessTree(child)
      finish(new Error('KeePassXC entry listing timed out.'))
    }, UNLOCK_TIMEOUT_MS)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
      if (Buffer.byteLength(output, 'utf8') > MAX_ENTRY_LIST_OUTPUT) {
        terminateProcessTree(child)
        finish(new Error('KeePassXC entry list exceeded the supported size limit.'))
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      diagnostics = (diagnostics + chunk).slice(-4_096)
    })
    child.on('error', () => finish(new Error('Could not start KeePassXC CLI.')))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        if (/(wrong|incorrect|invalid).{0,30}(password|credentials|key)|failed to decrypt|invalid credentials|неверн.{0,30}(парол|ключ)|неправильн.{0,30}(парол|ключ)|не удалось расшифр/iu.test(diagnostics)) {
          finish(new Error('KeePassXC could not unlock the database. Check the master password and any configured key file.'))
          return
        }
        if (/(database.*(not found|does not exist|could not open)|file not found|could not open database|не удалось открыть баз[ауы]|файл не найден|баз[аы].*не найден)/iu.test(diagnostics)) {
          finish(new Error('KeePassXC could not open the database. Verify the database path and file access.'))
          return
        }
        finish(new Error('KeePassXC could not list database entries (exit code ' + String(code) + ').'))
        return
      }

      try {
        const paths = output.split(/\r?\n/u)
          .map(value => value.trim())
          .filter(value => value.length > 0 && !value.endsWith('/')
            && !value.endsWith('/[пусто]') && !value.endsWith('/[empty]'))
        if (paths.length > MAX_LISTED_ENTRIES) throw new Error('KeePassXC database contains too many entries to browse safely.')
        const unique = new Map<string, SecretProviderEntry>()
        for (const entryPath of paths) {
          const normalized = parseReference({
            databasePath: input.databasePath,
            entryPath,
            attribute: 'Password',
          }).entryPath
          const segments = normalized.split('/')
          const title = segments.at(-1)
          if (!title) continue
          unique.set(normalized, {
            path: normalized,
            title,
            groupPath: segments.slice(0, -1).join('/'),
          })
        }
        finish(undefined, [...unique.values()].sort((left, right) => left.path.localeCompare(right.path)))
      } catch (error) {
        finish(error instanceof Error ? error : new Error('KeePassXC entry list is invalid.'))
      }
    })

    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input.unlockPassword + String.fromCharCode(10))
  })
}

export class KeePassXCProvider implements SecretProvider {
  readonly id = 'keepassxc'
  private readonly cliPath: string
  private readonly keyFilePath?: string
  private readonly resolveWithPassword: NonNullable<KeePassXCProviderOptions['resolveWithPassword']>
  private readonly listEntriesWithPassword: NonNullable<KeePassXCProviderOptions['listEntriesWithPassword']>
  private cachedUnlock: { password: Buffer; expiresAt: number } | null = null

  private cacheUnlockPassword(password: string): void {
    this.clearCachedUnlock()
    this.cachedUnlock = {
      password: Buffer.from(password, 'utf8'),
      expiresAt: Date.now() + CACHED_UNLOCK_TTL_MS,
    }
  }

  private takeCachedUnlockPassword(): string | null {
    if (!this.cachedUnlock) return null
    if (this.cachedUnlock.expiresAt <= Date.now()) {
      this.clearCachedUnlock()
      return null
    }
    const password = this.cachedUnlock.password.toString('utf8')
    this.clearCachedUnlock()
    return password
  }

  private clearCachedUnlock(): void {
    this.cachedUnlock?.password.fill(0)
    this.cachedUnlock = null
  }



  constructor(options: KeePassXCProviderOptions) {
    if (!path.isAbsolute(options.cliPath)) throw new Error('KeePassXC CLI path must be absolute.')
    this.cliPath = path.resolve(options.cliPath)
    this.keyFilePath = options.keyFilePath ? path.resolve(options.keyFilePath) : undefined
    this.resolveWithPassword = options.resolveWithPassword ?? runKeePassXC
    this.listEntriesWithPassword = options.listEntriesWithPassword ?? runKeePassXCList
  }

  getCapabilities(): SecretProviderCapabilities {
    return { availability: true, validation: true, resolve: true }
  }

  async getAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const [cli, keyFile] = await Promise.all([
        fs.stat(this.cliPath),
        this.keyFilePath ? fs.stat(this.keyFilePath) : Promise.resolve(undefined),
      ])
      if (!cli.isFile()) return { available: false, reason: 'KeePassXC CLI is not a regular file.' }
      if (this.keyFilePath && !keyFile?.isFile()) {
        return { available: false, reason: 'KeePassXC key file is unavailable.' }
      }
      return { available: true }
    } catch {
      return { available: false, reason: 'KeePassXC CLI or configured key file is unavailable.' }
    }
  }

  async validateReference(reference: Record<string, unknown>): Promise<void> {
    const parsed = parseReference(reference)
    const stat = await fs.stat(parsed.databasePath).catch(() => null)
    if (!stat?.isFile()) throw new Error('KeePassXC database file is unavailable.')
  }

  clearSession(): void {
    this.clearCachedUnlock()
  }

  async dispose(): Promise<void> {
    this.clearCachedUnlock()
    for (const child of [...activeUnlockProcesses]) terminateProcessTree(child)
  }

  async listEntries(reference: Record<string, unknown>, unlockPassword: string): Promise<SecretProviderEntry[]> {
    const parsed = parseReference({ ...reference, entryPath: '__browse__', attribute: 'Password' })
    await this.validateReference({ databasePath: parsed.databasePath, entryPath: parsed.entryPath, attribute: parsed.attribute })
    if (typeof unlockPassword !== 'string' || unlockPassword.length === 0) {
      throw new Error('A KeePassXC database master password is required to list entries.')
    }
    const entries = await this.listEntriesWithPassword({
      cliPath: this.cliPath,
      databasePath: parsed.databasePath,
      unlockPassword,
      ...(this.keyFilePath ? { keyFilePath: this.keyFilePath } : {}),
    })
    this.cacheUnlockPassword(unlockPassword)
    return entries
  }

  async resolveSecret(reference: Record<string, unknown>, unlockPassword?: string): Promise<string> {
    const cachedUnlockPassword = unlockPassword === undefined ? this.takeCachedUnlockPassword() : null
    if (unlockPassword !== undefined) this.clearCachedUnlock()
    unlockPassword = unlockPassword ?? cachedUnlockPassword ?? undefined
    const parsed = parseReference(reference)
    if (typeof unlockPassword !== 'string' || unlockPassword.length === 0) {
      throw new Error('A KeePassXC database master password is required to unlock this entry. Select the database again to unlock it.')
    }
    return this.resolveWithPassword({
      cliPath: this.cliPath,
      databasePath: parsed.databasePath,
      entryPath: parsed.entryPath,
      attribute: parsed.attribute,
      unlockPassword,
      ...(this.keyFilePath ? { keyFilePath: this.keyFilePath } : {}),
    })
  }
}
