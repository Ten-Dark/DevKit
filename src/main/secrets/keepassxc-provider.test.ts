import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeePassXCProvider } from './keepassxc-provider.js'

describe('KeePassXCProvider', () => {
  let directory: string

  afterEach(async () => {
    vi.restoreAllMocks()
    if (directory) await fs.rm(directory, { recursive: true, force: true })
  })

  it('validates database references independent of file extension', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-kpxc-'))
    const cliPath = path.join(directory, 'keepassxc-cli.exe')
    const databasePath = path.join(directory, 'database.dll')
    await fs.writeFile(cliPath, 'cli')
    await fs.writeFile(databasePath, 'database')
    const provider = new KeePassXCProvider({ cliPath })

    await expect(provider.getAvailability()).resolves.toEqual({ available: true })
    await expect(provider.validateReference({
      databasePath,
      entryPath: 'Root/Dev Secrets/Karakeep',
    })).resolves.toBeUndefined()
  })

  it('rejects relative database paths and invalid entry paths', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-kpxc-'))
    const cliPath = path.join(directory, 'keepassxc-cli.exe')
    await fs.writeFile(cliPath, 'cli')
    const provider = new KeePassXCProvider({ cliPath })

    await expect(provider.validateReference({
      databasePath: 'database.dll',
      entryPath: 'Root/Karakeep',
    })).rejects.toThrow(/absolute path/)
  })

  it('passes the DevKit-entered master password to KeePassXC without opening another prompt', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-kpxc-'))
    const cliPath = path.join(directory, 'keepassxc-cli.exe')
    const databasePath = path.join(directory, 'database.dll')
    await fs.writeFile(cliPath, 'cli')
    await fs.writeFile(databasePath, 'database')
    const resolveWithPassword = vi.fn().mockResolvedValue('token-value')
    const provider = new KeePassXCProvider({ cliPath, resolveWithPassword })

    await expect(provider.resolveSecret({
      databasePath,
      entryPath: 'Root/Dev Secrets/Karakeep',
    }, 'test-master-password')).resolves.toBe('token-value')
    expect(resolveWithPassword).toHaveBeenCalledWith({
      cliPath,
      databasePath,
      entryPath: 'Root/Dev Secrets/Karakeep',
      attribute: 'Password',
      unlockPassword: 'test-master-password',
    })
  })

  it('requires an unlock password instead of opening a second prompt', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-kpxc-'))
    const cliPath = path.join(directory, 'keepassxc-cli.exe')
    const databasePath = path.join(directory, 'database.dll')
    await fs.writeFile(cliPath, 'cli')
    await fs.writeFile(databasePath, 'database')
    const resolveWithPassword = vi.fn()
    const provider = new KeePassXCProvider({ cliPath, resolveWithPassword })

    await expect(provider.resolveSecret({ databasePath, entryPath: 'Root/Karakeep' }))
      .rejects.toThrow(/A KeePassXC database master password is required/)
    expect(resolveWithPassword).not.toHaveBeenCalled()
  })
})
