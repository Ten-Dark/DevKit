import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { McpWorkersManagerRuntimeConfigStore } from './mcpworkers-manager-config.js';

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-config-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'registry'), { recursive: true });
  await writeFile(
    path.join(root, 'registry', 'registry.json'),
    JSON.stringify({ schemaVersion: 1, definitions: [], instances: [] }),
    'utf8',
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('McpWorkersManagerRuntimeConfigStore', () => {
  it('persists and reloads an explicitly selected existing data root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-config-store-'));
    temporaryRoots.push(directory);
    const configPath = path.join(directory, 'mcpworkers-runtime.json');
    const dataRoot = await createRoot();
    const store = new McpWorkersManagerRuntimeConfigStore(configPath);
    await store.initialize();

    expect(store.getDataRoot()).toBeNull();
    await expect(store.setDataRoot(dataRoot)).resolves.toEqual({ dataRoot });
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ schemaVersion: 1, dataRoot });

    const reloaded = new McpWorkersManagerRuntimeConfigStore(configPath);
    await reloaded.initialize();
    expect(reloaded.getDataRoot()).toBe(dataRoot);
    await expect(reloaded.clearDataRoot()).resolves.toEqual({ dataRoot: null });
    expect(reloaded.getDataRoot()).toBeNull();
  });

  it('rejects a directory without an existing Registry and does not persist it', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-config-empty-'));
    temporaryRoots.push(directory);
    const configPath = path.join(directory, 'mcpworkers-runtime.json');
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-empty-root-'));
    temporaryRoots.push(dataRoot);
    const store = new McpWorkersManagerRuntimeConfigStore(configPath);
    await store.initialize();

    await expect(store.setDataRoot(dataRoot)).rejects.toThrow(/registry\/registry.json/);
    await expect(readFile(configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(store.getDataRoot()).toBeNull();
  });

  it('rejects a symbolic-link Registry file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-config-link-'));
    temporaryRoots.push(directory);
    const configPath = path.join(directory, 'mcpworkers-runtime.json');
    const dataRoot = await createRoot();
    const registryPath = path.join(dataRoot, 'registry', 'registry.json');
    const targetPath = path.join(dataRoot, 'registry', 'registry-copy.json');
    await writeFile(targetPath, JSON.stringify({ schemaVersion: 1, definitions: [], instances: [] }), 'utf8');
    await rm(registryPath);
    try {
      await symlink(targetPath, registryPath, 'file');
    } catch {
      return;
    }

    const store = new McpWorkersManagerRuntimeConfigStore(configPath);
    await store.initialize();
    await expect(store.setDataRoot(dataRoot)).rejects.toThrow(/real directory|unsafe/);
  });

  it('auto-discovers and persists the single valid existing data root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-config-discovery-'));
    temporaryRoots.push(directory);
    const configPath = path.join(directory, 'mcpworkers-runtime.json');
    const dataRoot = await createRoot();
    const store = new McpWorkersManagerRuntimeConfigStore(configPath);

    await store.initialize([path.join(directory, 'missing'), dataRoot, dataRoot]);

    expect(store.getDataRoot()).toBe(dataRoot);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ schemaVersion: 1, dataRoot });
  });

  it('replaces a stale invalid configured folder with the single validated existing data root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-config-stale-'));
    temporaryRoots.push(directory);
    const configPath = path.join(directory, 'mcpworkers-runtime.json');
    const invalidRoot = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-invalid-root-'));
    temporaryRoots.push(invalidRoot);
    const dataRoot = await createRoot();
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, dataRoot: invalidRoot }), 'utf8');
    const store = new McpWorkersManagerRuntimeConfigStore(configPath);

    await store.initialize([dataRoot]);

    expect(store.getDataRoot()).toBe(dataRoot);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ schemaVersion: 1, dataRoot });
    expect(await readdir(invalidRoot)).toEqual([]);
  });

  it('does not choose automatically when multiple valid data roots are found', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-config-ambiguous-'));
    temporaryRoots.push(directory);
    const configPath = path.join(directory, 'mcpworkers-runtime.json');
    const firstRoot = await createRoot();
    const secondRoot = await createRoot();
    const store = new McpWorkersManagerRuntimeConfigStore(configPath);

    await store.initialize([firstRoot, secondRoot]);

    expect(store.getDataRoot()).toBeNull();
    await expect(readFile(configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite a malformed existing config file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devkit-manager-config-corrupt-'));
    temporaryRoots.push(directory);
    const configPath = path.join(directory, 'mcpworkers-runtime.json');
    await writeFile(configPath, '{invalid', 'utf8');
    const store = new McpWorkersManagerRuntimeConfigStore(configPath);

    await expect(store.initialize()).rejects.toThrow(/malformed/);
    expect(await readFile(configPath, 'utf8')).toBe('{invalid');
  });
});
