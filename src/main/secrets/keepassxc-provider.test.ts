import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
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

  it.skipIf(!process.env.KEEPASSXC_CLI_PATH)('lists real KeePassXC entries through the installed CLI', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-kpxc-cli-'))
    const cliPath = process.env.KEEPASSXC_CLI_PATH!
    const databasePath = path.join(directory, 'fixture.kdbx')
    const run = (args: string[], input: string) => {
      const result = spawnSync(cliPath, args, { input, encoding: 'utf8', windowsHide: true })
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'KeePassXC fixture command failed.')
    }

    run(['db-create', '-p', databasePath], 'fixture-password\nfixture-password\n')
    run(['mkdir', databasePath, 'Group'], 'fixture-password\n')
    run(['add', databasePath, 'Group/DevKitToken'], 'fixture-password\n')

    const provider = new KeePassXCProvider({ cliPath })
    await expect(provider.listEntries({ databasePath }, 'fixture-password')).resolves.toEqual([{
      path: 'Group/DevKitToken',
      title: 'DevKitToken',
      groupPath: 'Group',
    }])
  })

  it('lists KeePassXC entry paths without exposing entry values', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-kpxc-'))
    const cliPath = path.join(directory, 'keepassxc-cli.exe')
    const databasePath = path.join(directory, 'database.kdbx')
    await fs.writeFile(cliPath, 'cli')
    await fs.writeFile(databasePath, 'database')
    const entries = [{
      path: 'Dev Secrets/MCPWorkers/DevKit',
      title: 'DevKit',
      groupPath: 'Dev Secrets/MCPWorkers',
    }]
    const listEntriesWithPassword = vi.fn().mockResolvedValue(entries)
    const provider = new KeePassXCProvider({ cliPath, listEntriesWithPassword })

    await expect(provider.listEntries({ databasePath }, 'test-master-password')).resolves.toEqual(entries)
    expect(listEntriesWithPassword).toHaveBeenCalledWith({
      cliPath,
      databasePath,
      unlockPassword: 'test-master-password',
    })
  })

  it('reuses the short-lived in-memory unlock from entry browsing for the selected credential', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-kpxc-'))
    const cliPath = path.join(directory, 'keepassxc-cli.exe')
    const databasePath = path.join(directory, 'database.kdbx')
    await fs.writeFile(cliPath, 'cli')
    await fs.writeFile(databasePath, 'database')
    const resolveWithPassword = vi.fn().mockResolvedValue('client-token')
    const listEntriesWithPassword = vi.fn().mockResolvedValue([{
      path: 'Group/DevKitToken',
      title: 'DevKitToken',
      groupPath: 'Group',
    }])
    const provider = new KeePassXCProvider({ cliPath, resolveWithPassword, listEntriesWithPassword })

    await provider.listEntries({ databasePath }, 'test-master-password')
    await expect(provider.resolveSecret({ databasePath, entryPath: 'Group/DevKitToken' })).resolves.toBe('client-token')
    expect(resolveWithPassword).toHaveBeenCalledWith({
      cliPath,
      databasePath,
      entryPath: 'Group/DevKitToken',
      attribute: 'Password',
      unlockPassword: 'test-master-password',
    })
    await expect(provider.resolveSecret({ databasePath, entryPath: 'Group/DevKitToken' }))
      .rejects.toThrow(/Select the database again/)

    await provider.listEntries({ databasePath }, 'test-master-password')
    provider.clearSession()
    await expect(provider.resolveSecret({ databasePath, entryPath: 'Group/DevKitToken' }))
      .rejects.toThrow(/Select the database again/)
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
