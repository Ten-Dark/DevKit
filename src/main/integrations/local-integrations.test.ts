import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LocalIntegrationsManager } from './local-integrations.js'

let tempDir: string
let projectsRoot: string
let settingsPath: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-local-integrations-'))
  projectsRoot = path.join(tempDir, 'Projects')
  settingsPath = path.join(tempDir, 'workspace', 'services', 'local-integrations.json')
  await fs.mkdir(projectsRoot, { recursive: true })
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('LocalIntegrationsManager', () => {
  it('stores the Projects root and returns no direct MCP lifecycle integrations', async () => {
    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const result = await manager.getStatuses()

    expect(result).toEqual({ projectsRoot, integrations: [] })
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      projectsRoot,
    })
  })

  it('restores the saved Projects root in a new manager instance', async () => {
    const manager = new LocalIntegrationsManager(settingsPath)
    await manager.setProjectsRoot(projectsRoot)

    const restored = new LocalIntegrationsManager(settingsPath)
    await expect(restored.getProjectsRoot()).resolves.toBe(projectsRoot)
  })

  it('rejects relative, missing, and symbolic-link Projects roots', async () => {
    const manager = new LocalIntegrationsManager(settingsPath)
    await expect(manager.setProjectsRoot('Projects')).rejects.toThrow('absolute path')
    await expect(manager.setProjectsRoot(path.join(tempDir, 'missing'))).rejects.toThrow()

    const target = path.join(tempDir, 'target')
    const link = path.join(tempDir, 'link')
    await fs.mkdir(target)
    await fs.symlink(target, link, 'junction')
    await expect(manager.setProjectsRoot(link)).rejects.toThrow('real directory')
  })

  it('rejects unsafe settings files instead of following symbolic links', async () => {
    const manager = new LocalIntegrationsManager(settingsPath)
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    const target = path.join(tempDir, 'settings-target.json')
    await fs.writeFile(target, JSON.stringify({ schemaVersion: 1, projectsRoot }))
    await fs.symlink(target, settingsPath, 'file')

    await expect(manager.getProjectsRoot()).rejects.toThrow('regular file')
  })
})
