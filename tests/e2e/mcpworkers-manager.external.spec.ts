import { _electron as electron } from 'playwright/test';
import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const enabled = process.env.MCPWORKERS_EXPECT_EXTERNAL_MANAGER === '1';
const executablePath = path.resolve(
  process.env.PACKAGED_EXE ?? path.join(process.cwd(), 'dist', 'win-unpacked', 'Dev Toolbox.exe'),
);

test.skip(!enabled, 'Set MCPWORKERS_EXPECT_EXTERNAL_MANAGER=1 when a compatible external Manager is running.');

test('attaches to an external MCPWorkers Manager without claiming or stopping it', async () => {
  await fs.access(executablePath);
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-manager-external-e2e-'));
  const app = await electron.launch({
    executablePath,
    args: ['--user-data-dir=' + userDataDir],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle(/Dev Toolbox/);
    await window.getByRole('button', { name: 'Services', exact: true }).click();

    await expect(window.getByText(/Runtime ownership: External — attached/)).toBeVisible({ timeout: 15_000 });
    const shutdownButton = window.getByRole('button', { name: 'Shutdown DevKit-owned' });
    await expect(shutdownButton).toBeDisabled();

    const managerState = await window.evaluate(() => window.api.mcpWorkers.getManagerRuntimeStatus());
    expect(managerState.runtime.state).toBe('external');
    expect(managerState.runtime.ownership).toBe('external');

    const services = await window.evaluate(() => window.api.runtime.listServices());
    const managerService = services.find((item) => item.service.id === 'mcpworkers-manager');
    expect(managerService?.snapshot.state).toBe('running');
    expect(managerService?.snapshot.process.identityVerified).toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
