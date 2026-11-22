import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export const WORKSPACE_DIRECTORY_NAME = 'workspace'
export const WORKSPACE_MANIFEST_FILE_NAME = 'workspace.json'
export const WORKSPACE_SCHEMA_VERSION = 1

export interface WorkspaceManifest {
  id: string
  schemaVersion: number
  owner: 'devkit'
  createdAt: string
  updatedAt: string
  appVersion: string
}

export interface WorkspacePaths {
  root: string
  manifest: string
  config: string
  registry: string
  services: string
  serviceData: string
  runtimes: string
  workflows: string
  events: string
  logs: string
  cache: string
  backups: string
  vault: string
}

export interface BootstrapWorkspaceOptions {
  userDataPath?: string
  appVersion?: string
}

export async function ensureSafeDirectory(directoryPath: string): Promise<void> {
  const resolved = path.resolve(directoryPath)
  const parsedRoot = path.parse(resolved).root
  const segments = resolved.slice(parsedRoot.length).split(path.sep).filter(Boolean)
  let current = parsedRoot

  for (const segment of segments) {
    current = path.join(current, segment)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Managed directory path contains a symbolic link or non-directory: ${current}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await fs.mkdir(current)
    }
  }

  // Every path component is checked with lstat above. Avoid comparing realpath()
  // with the input string: Windows may resolve an equivalent 8.3 short path
  // to its long-name form, making a safe directory look like a path escape.
}

let activeWorkspacePaths: WorkspacePaths | undefined
let activeWorkspaceUserDataPath: string | undefined

export function resolveWorkspacePaths(userDataPath = app.getPath('userData')): WorkspacePaths {
  const normalizedUserDataPath = path.resolve(userDataPath)
  if (activeWorkspacePaths && normalizedUserDataPath === activeWorkspaceUserDataPath) {
    return activeWorkspacePaths
  }
  const root = path.join(normalizedUserDataPath, WORKSPACE_DIRECTORY_NAME)
  return {
    root,
    manifest: path.join(root, WORKSPACE_MANIFEST_FILE_NAME),
    config: path.join(root, 'config'),
    registry: path.join(root, 'registry'),
    services: path.join(root, 'services'),
    serviceData: path.join(root, 'service-data'),
    runtimes: path.join(root, 'runtimes'),
    workflows: path.join(root, 'workflows'),
    events: path.join(root, 'events'),
    logs: path.join(root, 'logs'),
    cache: path.join(root, 'cache'),
    backups: path.join(root, 'backups'),
    vault: path.join(root, 'vault'),
  }
}

function isWorkspaceManifest(value: unknown): value is WorkspaceManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const manifest = value as Record<string, unknown>
  return (
    typeof manifest.id === 'string' &&
    /^[0-9a-f-]{36}$/i.test(manifest.id) &&
    manifest.schemaVersion === WORKSPACE_SCHEMA_VERSION &&
    manifest.owner === 'devkit' &&
    typeof manifest.createdAt === 'string' &&
    typeof manifest.updatedAt === 'string' &&
    typeof manifest.appVersion === 'string'
  )
}

async function writeManifestAtomically(filePath: string, manifest: WorkspaceManifest): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${WORKSPACE_MANIFEST_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' })
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined)
    throw error
  }
}

export async function bootstrapWorkspace(
  options: BootstrapWorkspaceOptions = {},
): Promise<{ paths: WorkspacePaths; manifest: WorkspaceManifest }> {
  const userDataPath = path.resolve(options.userDataPath ?? app.getPath('userData'))
  const realUserDataPath = await fs.realpath(userDataPath)
  const paths = resolveWorkspacePaths(realUserDataPath)

  try {
    const existingRoot = await fs.lstat(paths.root)
    if (existingRoot.isSymbolicLink() || !existingRoot.isDirectory()) {
      throw new Error('Workspace root must be a real directory, not a symbolic link or file.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.mkdir(paths.root, { recursive: false })
  }

  const rootStat = await fs.lstat(paths.root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Workspace root changed during initialization.')
  }

  const realRoot = await fs.realpath(paths.root)
  if (realRoot !== paths.root) {
    throw new Error('Workspace root resolves outside its configured location.')
  }

  let manifest: WorkspaceManifest
  try {
    const manifestStat = await fs.lstat(paths.manifest)
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
      throw new Error('Workspace manifest must be a regular file.')
    }
    const parsed: unknown = JSON.parse(await fs.readFile(paths.manifest, 'utf8'))
    if (!isWorkspaceManifest(parsed)) {
      throw new Error('Workspace manifest is invalid or uses an unsupported schema version.')
    }
    manifest = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const now = new Date().toISOString()
    manifest = {
      id: randomUUID(),
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      owner: 'devkit',
      createdAt: now,
      updatedAt: now,
      appVersion: options.appVersion ?? app.getVersion(),
    }
    await writeManifestAtomically(paths.manifest, manifest)
  }

  activeWorkspacePaths = paths
  activeWorkspaceUserDataPath = userDataPath
  return { paths, manifest }
}
