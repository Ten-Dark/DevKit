import { describe, expect, it, vi } from 'vitest';
import type { ProcessManager, ProcessLaunchSpec } from '../core/process-manager.js';
import type { ProcessObservation } from '../core/contracts.js';
import type { McpWorkersClient, McpWorkersHealthStatus } from './mcpworkers-client.js';
import {
  McpWorkersManagerRuntime,
  type RuntimeShutdownPipeServer,
} from './mcpworkers-manager-runtime.js';

const launchSpec: ProcessLaunchSpec = {
  executablePath: 'C:\\DevKit\\DevKit.exe',
  args: ['C:\\DevKit\\resources\\mcpworkers-manager\\manager.cjs', 'serve'],
  workingDirectory: 'C:\\DevKit\\resources\\mcpworkers-manager',
  env: {
    ELECTRON_RUN_AS_NODE: '1',
    MCPWORKERS_DATA_ROOT: 'C:\\Users\\test\\AppData\\Local\\DevKit\\mcpworkers-data',
  },
};

function health(state: McpWorkersHealthStatus['state']): McpWorkersHealthStatus {
  if (state === 'reachable') {
    return { state, baseUrl: 'http://127.0.0.1:43127', apiVersion: 1, detail: 'reachable' };
  }
  return { state, baseUrl: 'http://127.0.0.1:43127', detail: state };
}

function observation(state: ProcessObservation['state']): ProcessObservation {
  return {
    state,
    observedAt: new Date().toISOString(),
    pid: state === 'present' ? 1234 : undefined,
    identityVerified: state === 'present',
  };
}

function createPipe(): RuntimeShutdownPipeServer {
  return {
    path: '\\\\.\\pipe\\devkit-mcpworkers-test',
    waitForConnection: vi.fn().mockResolvedValue(undefined),
    requestShutdown: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createProcessManager() {
  return {
    start: vi.fn().mockResolvedValue(observation('present')),
    stop: vi.fn().mockResolvedValue(observation('exited')),
    getObservation: vi.fn().mockResolvedValue(observation('present')),
  } as unknown as Pick<ProcessManager, 'start' | 'stop' | 'getObservation'>;
}

describe('McpWorkersManagerRuntime', () => {
  it('attaches to an already-running external Manager without claiming or stopping it', async () => {
    const processManager = createProcessManager();
    const client = { getHealth: vi.fn().mockResolvedValue(health('reachable')) };
    const resolveLaunchSpec = vi.fn().mockResolvedValue(launchSpec);
    const pipe = createPipe();
    const runtime = new McpWorkersManagerRuntime({
      processManager,
      client: client as unknown as Pick<McpWorkersClient, 'getHealth'>,
      resolveLaunchSpec,
      createShutdownPipe: vi.fn().mockResolvedValue(pipe),
    });

    await expect(runtime.startOrAttach()).resolves.toMatchObject({
      state: 'external',
      ownership: 'external',
    });
    await runtime.shutdown();

    expect(resolveLaunchSpec).not.toHaveBeenCalled();
    expect(processManager.start).not.toHaveBeenCalled();
    expect(processManager.stop).not.toHaveBeenCalled();
    expect(pipe.requestShutdown).not.toHaveBeenCalled();
  });

  it('does not start a Manager when the sidecar or data root is not configured', async () => {
    const processManager = createProcessManager();
    const client = { getHealth: vi.fn().mockResolvedValue(health('unavailable')) };
    const runtime = new McpWorkersManagerRuntime({
      processManager,
      client: client as unknown as Pick<McpWorkersClient, 'getHealth'>,
      resolveLaunchSpec: vi.fn().mockResolvedValue(null),
    });

    await expect(runtime.startOrAttach()).resolves.toMatchObject({
      state: 'unavailable',
      ownership: 'none',
    });
    expect(processManager.start).not.toHaveBeenCalled();
  });

  it('starts a configured Manager through ProcessManager and requests graceful shutdown through its pipe', async () => {
    const processManager = createProcessManager();
    const client = {
      getHealth: vi.fn()
        .mockResolvedValueOnce(health('unavailable'))
        .mockResolvedValueOnce(health('unavailable'))
        .mockResolvedValueOnce(health('reachable')),
    };
    const pipe = createPipe();
    const runtime = new McpWorkersManagerRuntime({
      processManager,
      client: client as unknown as Pick<McpWorkersClient, 'getHealth'>,
      resolveLaunchSpec: vi.fn().mockResolvedValue(launchSpec),
      createShutdownPipe: vi.fn().mockResolvedValue(pipe),
      readinessTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
      delay: async () => undefined,
    });

    await expect(runtime.startOrAttach()).resolves.toMatchObject({
      state: 'managed',
      ownership: 'devkit',
      pid: 1234,
    });
    expect(processManager.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mcpworkers-manager', owner: { kind: 'managed', resourceId: 'mcpworkers-manager' } }),
      expect.objectContaining({
        executablePath: launchSpec.executablePath,
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          MCPWORKERS_DATA_ROOT: launchSpec.env!.MCPWORKERS_DATA_ROOT,
          DEVKIT_MCPWORKERS_SHUTDOWN_PIPE: pipe.path,
        }),
      }),
    );

    processManager.getObservation = vi.fn()
      .mockResolvedValueOnce(observation('present'))
      .mockResolvedValueOnce(observation('exited'));

    await expect(runtime.shutdown()).resolves.toMatchObject({
      state: 'unavailable',
      ownership: 'none',
    });
    expect(pipe.requestShutdown).toHaveBeenCalledOnce();
    expect(processManager.stop).not.toHaveBeenCalled();
    expect(pipe.close).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight startup before coordinating shutdown', async () => {
    let finishStart!: (value: ProcessObservation) => void;
    const startResult = new Promise<ProcessObservation>((resolve) => { finishStart = resolve; });
    const processManager = createProcessManager();
    processManager.start = vi.fn().mockReturnValue(startResult);
    processManager.getObservation = vi.fn()
      .mockResolvedValueOnce(observation('present'))
      .mockResolvedValueOnce(observation('present'))
      .mockResolvedValueOnce(observation('exited'));
    const client = {
      getHealth: vi.fn()
        .mockResolvedValueOnce(health('unavailable'))
        .mockResolvedValueOnce(health('unavailable'))
        .mockResolvedValueOnce(health('reachable')),
    };
    const pipe = createPipe();
    const runtime = new McpWorkersManagerRuntime({
      processManager,
      client: client as unknown as Pick<McpWorkersClient, 'getHealth'>,
      resolveLaunchSpec: vi.fn().mockResolvedValue(launchSpec),
      createShutdownPipe: vi.fn().mockResolvedValue(pipe),
      readinessTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
      delay: async () => undefined,
    });

    const starting = runtime.startOrAttach();
    const shuttingDown = runtime.shutdown();
    expect(pipe.requestShutdown).not.toHaveBeenCalled();
    finishStart(observation('present'));

    await expect(starting).resolves.toMatchObject({ state: 'managed', ownership: 'devkit' });
    await expect(shuttingDown).resolves.toMatchObject({ state: 'unavailable', ownership: 'none' });
    expect(pipe.requestShutdown).toHaveBeenCalledOnce();
  });

  it('does not terminate a process when ownership becomes unobservable at shutdown', async () => {
    const processManager = createProcessManager();
    const client = {
      getHealth: vi.fn()
        .mockResolvedValueOnce(health('unavailable'))
        .mockResolvedValueOnce(health('unavailable'))
        .mockResolvedValueOnce(health('reachable')),
    };
    const pipe = createPipe();
    const runtime = new McpWorkersManagerRuntime({
      processManager,
      client: client as unknown as Pick<McpWorkersClient, 'getHealth'>,
      resolveLaunchSpec: vi.fn().mockResolvedValue(launchSpec),
      createShutdownPipe: vi.fn().mockResolvedValue(pipe),
      readinessTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
      delay: async () => undefined,
    });
    await runtime.startOrAttach();

    processManager.getObservation = vi.fn().mockResolvedValue(observation('unobservable'));
    await expect(runtime.shutdown()).resolves.toMatchObject({
      state: 'blocked',
      ownership: 'none',
    });
    expect(processManager.stop).not.toHaveBeenCalled();
  });
});
