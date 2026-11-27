import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

interface PersistedManagerRuntimeConfig {
  schemaVersion: 1;
  dataRoot: string | null;
}

export interface McpWorkersManagerRuntimeConfigStatus {
  dataRoot: string | null;
}

async function validateExistingDataRoot(value: string): Promise<string> {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_096) {
    throw new Error('Select an existing MCPWorkers data directory.');
  }
  const dataRoot = path.resolve(value);
  if (!path.isAbsolute(dataRoot)) throw new Error('MCPWorkers data directory must be an absolute path.');

  let rootStat;
  try {
    rootStat = await lstat(dataRoot);
  } catch {
    throw new Error('The selected MCPWorkers data directory does not exist.');
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('The selected MCPWorkers data root must be a real directory, not a symbolic link.');
  }

  const registryDirectory = path.join(dataRoot, 'registry');
  const registryPath = path.join(registryDirectory, 'registry.json');
  const [registryDirectoryStat, registryStat] = await Promise.all([
    lstat(registryDirectory).catch(() => null),
    lstat(registryPath).catch(() => null),
  ]);
  if (!registryDirectoryStat?.isDirectory() || registryDirectoryStat.isSymbolicLink()
    || !registryStat?.isFile() || registryStat.isSymbolicLink()) {
    throw new Error('The selected directory is not an existing MCPWorkers data root: registry/registry.json is missing or unsafe.');
  }

  const authDirectory = path.join(dataRoot, 'auth');
  const authToken = path.join(authDirectory, 'daemon.token');
  const [authDirectoryStat, authTokenStat] = await Promise.all([
    lstat(authDirectory).catch(() => null),
    lstat(authToken).catch(() => null),
  ]);
  if ((authDirectoryStat && (!authDirectoryStat.isDirectory() || authDirectoryStat.isSymbolicLink()))
    || (authTokenStat && (!authTokenStat.isFile() || authTokenStat.isSymbolicLink()))) {
    throw new Error('The selected MCPWorkers authentication directory contains an unsafe path.');
  }

  return dataRoot;
}

export class McpWorkersManagerRuntimeConfigStore {
  private dataRoot: string | null = null;
  private initialized = false;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    let details;
    try {
      details = await lstat(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('Could not inspect the MCPWorkers Runtime configuration file.', { cause: error });
    }
    if (!details.isFile() || details.isSymbolicLink() || details.size > 16_384) {
      throw new Error('The MCPWorkers Runtime configuration file is invalid or unsafe.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch {
      throw new Error('The MCPWorkers Runtime configuration file is malformed; it was not overwritten.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || (parsed as Record<string, unknown>).schemaVersion !== 1) {
      throw new Error('The MCPWorkers Runtime configuration schema is unsupported.');
    }
    const value = (parsed as Record<string, unknown>).dataRoot;
    if (value !== null && (typeof value !== 'string' || !path.isAbsolute(value))) {
      throw new Error('The configured MCPWorkers data directory path is invalid.');
    }
    this.dataRoot = value as string | null;
  }

  getDataRoot(): string | null {
    return this.dataRoot;
  }

  async setDataRoot(value: string): Promise<McpWorkersManagerRuntimeConfigStatus> {
    if (!this.initialized) throw new Error('MCPWorkers Runtime configuration is not initialized.');
    const dataRoot = await validateExistingDataRoot(value);
    await this.persist({ schemaVersion: 1, dataRoot });
    this.dataRoot = dataRoot;
    return { dataRoot };
  }

  async clearDataRoot(): Promise<McpWorkersManagerRuntimeConfigStatus> {
    if (!this.initialized) throw new Error('MCPWorkers Runtime configuration is not initialized.');
    await this.persist({ schemaVersion: 1, dataRoot: null });
    this.dataRoot = null;
    return { dataRoot: null };
  }

  private async persist(config: PersistedManagerRuntimeConfig): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = this.filePath + '.' + randomUUID() + '.tmp';
    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(config, null, 2) + '\n', 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
