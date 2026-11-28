import net, { type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ProcessManager, ProcessLaunchSpec } from '../core/process-manager.js';
import type { ProcessObservation, ServiceDefinition } from '../core/contracts.js';
import type { McpWorkersClient } from './mcpworkers-client.js';

export const MCPWORKERS_MANAGER_SERVICE: ServiceDefinition = {
  id: 'mcpworkers-manager',
  name: 'MCPWorkers Manager',
  version: '1.0.0',
  adapterId: 'mcpworkers.manager',
  owner: { kind: 'managed', resourceId: 'mcpworkers-manager' },
  capabilities: ['status', 'health', 'start', 'stop'],
  platforms: ['win32'],
  dependencies: [],
  readinessProbe: {
    type: 'http',
    url: 'http://127.0.0.1:43127/v1/health',
    timeoutMs: 2_500,
    expectedStatusCodes: [200],
  },
  config: {},
};

export type McpWorkersManagerRuntimeState =
  | { state: 'external'; ownership: 'external'; detail: string }
  | { state: 'managed'; ownership: 'devkit'; pid?: number; detail: string }
  | { state: 'unavailable'; ownership: 'none'; detail: string }
  | { state: 'blocked'; ownership: 'none'; detail: string };

export interface RuntimeShutdownPipeServer {
  readonly path: string;
  waitForConnection(timeoutMs: number): Promise<void>;
  requestShutdown(): Promise<void>;
  close(): Promise<void>;
}

export interface McpWorkersManagerRuntimeOptions {
  processManager: Pick<ProcessManager, 'start' | 'stop' | 'getObservation'>;
  client: Pick<McpWorkersClient, 'getHealth'>;
  resolveLaunchSpec: () => Promise<ProcessLaunchSpec | null>;
  createShutdownPipe?: () => Promise<RuntimeShutdownPipeServer>;
  readinessTimeoutMs?: number;
  readinessPollIntervalMs?: number;
  shutdownTimeoutMs?: number;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createNamedPipeServer(): Promise<RuntimeShutdownPipeServer> {
  if (process.platform !== 'win32') {
    throw new Error('MCPWorkers Manager Runtime sidecar is currently supported only on Windows.');
  }

  const pipePath = '\\\\.\\pipe\\devkit-mcpworkers-' + randomUUID();
  const server: Server = net.createServer();
  let socket: Socket | undefined;
  let ready = false;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  let readyPromise: Promise<void> | undefined;
  let closed = false;

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    server.listen(pipePath);
  });

  server.on('error', () => {
    if (!ready) readyReject?.(new Error('MCPWorkers Manager Runtime shutdown channel failed.'));
  });

  server.on('connection', (candidate) => {
    if (socket || closed) {
      candidate.destroy();
      return;
    }
    socket = candidate;
    candidate.setEncoding('utf8');
    let buffer = '';
    candidate.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 128) {
        readyReject?.(new Error('MCPWorkers Manager sent an invalid Runtime handshake.'));
        candidate.destroy();
        return;
      }
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';
      if (lines.includes('READY') && !ready) {
        ready = true;
        readyResolve?.();
      }
    });
    candidate.on('close', () => {
      if (!ready) readyReject?.(new Error('MCPWorkers Manager closed its Runtime handshake before readiness.'));
    });
    candidate.on('error', () => {
      if (!ready) readyReject?.(new Error('MCPWorkers Manager Runtime handshake failed.'));
    });
  });

  return {
    path: pipePath,
    waitForConnection(timeoutMs) {
      if (ready) return Promise.resolve();
      if (!readyPromise) {
        let timeout: NodeJS.Timeout;
        readyPromise = new Promise<void>((resolve, reject) => {
          readyResolve = () => {
            clearTimeout(timeout);
            resolve();
          };
          readyReject = (error) => {
            clearTimeout(timeout);
            reject(error);
          };
          timeout = setTimeout(
            () => readyReject?.(new Error('MCPWorkers Manager did not connect to the Runtime shutdown channel.')),
            timeoutMs,
          );
        });
      }
      return readyPromise;
    },
    async requestShutdown() {
      if (!ready || !socket || socket.destroyed || !socket.writable) {
        throw new Error('MCPWorkers Manager Runtime shutdown channel is not connected.');
      }
      await new Promise<void>((resolve, reject) => {
        socket!.write('shutdown\n', (error) => {
          if (error) reject(error);
          else {
            socket!.end();
            resolve();
          }
        });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      socket?.destroy();
      await new Promise<void>((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
    },
  };
}

export class McpWorkersManagerRuntime {
  private readonly processManager: McpWorkersManagerRuntimeOptions['processManager'];
  private readonly client: McpWorkersManagerRuntimeOptions['client'];
  private readonly resolveLaunchSpec: McpWorkersManagerRuntimeOptions['resolveLaunchSpec'];
  private readonly createShutdownPipe: () => Promise<RuntimeShutdownPipeServer>;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollIntervalMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly now: () => number;
  private readonly delay: (ms: number) => Promise<void>;
  private state: McpWorkersManagerRuntimeState = {
    state: 'unavailable',
    ownership: 'none',
    detail: 'MCPWorkers Manager has not been checked.',
  };
  private shutdownPipe?: RuntimeShutdownPipeServer;
  private startedByThisSession = false;
  private startPromise?: Promise<McpWorkersManagerRuntimeState>;
  private shutdownPromise?: Promise<McpWorkersManagerRuntimeState>;

  constructor(options: McpWorkersManagerRuntimeOptions) {
    this.processManager = options.processManager;
    this.client = options.client;
    this.resolveLaunchSpec = options.resolveLaunchSpec;
    this.createShutdownPipe = options.createShutdownPipe ?? createNamedPipeServer;
    this.readinessTimeoutMs = Math.max(500, options.readinessTimeoutMs ?? 15_000);
    this.readinessPollIntervalMs = Math.max(25, options.readinessPollIntervalMs ?? 250);
    this.shutdownTimeoutMs = Math.max(500, options.shutdownTimeoutMs ?? 8_000);
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? wait;
  }

  getState(): McpWorkersManagerRuntimeState {
    return this.state;
  }

  async refreshState(): Promise<McpWorkersManagerRuntimeState> {
    if (this.startedByThisSession) {
      const observation = await this.processManager.getObservation(MCPWORKERS_MANAGER_SERVICE.id);
      if (observation.state === 'present' && observation.identityVerified) {
        this.state = {
          state: 'managed',
          ownership: 'devkit',
          ...(observation.pid ? { pid: observation.pid } : {}),
          detail: 'MCPWorkers Manager was started by DevKit Runtime and remains process-owned.',
        };
        return this.state;
      }
      if (observation.state === 'unobservable'
        || (observation.state === 'present' && !observation.identityVerified)) {
        this.state = {
          state: 'blocked',
          ownership: 'none',
          detail: 'Manager process ownership can no longer be verified; DevKit will not terminate it.',
        };
        return this.state;
      }

      this.startedByThisSession = false;
      await this.shutdownPipe?.close();
      this.shutdownPipe = undefined;
      this.state = {
        state: 'unavailable',
        ownership: 'none',
        detail: 'The DevKit-managed MCPWorkers Manager process is no longer running.',
      };
    }

    const health = await this.client.getHealth();
    if (health.state === 'reachable') {
      this.state = {
        state: 'external',
        ownership: 'external',
        detail: 'A compatible MCPWorkers Manager is running externally. DevKit attached without taking process ownership.',
      };
    } else if (health.state !== 'unavailable') {
      this.state = {
        state: 'blocked',
        ownership: 'none',
        detail: health.detail || 'The configured MCPWorkers endpoint is responding but is not compatible.',
      };
    } else {
      this.state = {
        state: 'unavailable',
        ownership: 'none',
        detail: health.detail || 'MCPWorkers Manager is not reachable.',
      };
    }
    return this.state;
  }

  async getProcessObservation(): Promise<ProcessObservation> {
    const state = await this.refreshState();
    if (state.state === 'managed') {
      const observation = await this.processManager.getObservation(MCPWORKERS_MANAGER_SERVICE.id);
      return observation.state === 'present'
        ? { ...observation, ownership: 'managed' }
        : observation;
    }
    if (state.state === 'external') {
      return {
        state: 'present',
        observedAt: new Date().toISOString(),
        identityVerified: false,
        ownership: 'external',
      };
    }
    if (state.state === 'blocked') {
      return {
        state: 'unobservable',
        observedAt: new Date().toISOString(),
        identityVerified: false,
        ownership: 'unknown',
      };
    }
    return {
      state: 'absent',
      observedAt: new Date().toISOString(),
      identityVerified: true,
    };
  }

  startOrAttach(): Promise<McpWorkersManagerRuntimeState> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startOrAttachInternal().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async startOrAttachInternal(): Promise<McpWorkersManagerRuntimeState> {
    const currentState = await this.refreshState();
    if (currentState.state !== 'unavailable') return currentState;

    const launchSpec = await this.resolveLaunchSpec();
    if (!launchSpec) {
      this.state = {
        state: 'unavailable',
        ownership: 'none',
        detail: 'MCPWorkers Manager is not running and no managed sidecar/data directory is configured.',
      };
      return this.state;
    }

    const pipe = await this.createShutdownPipe();
    this.shutdownPipe = pipe;

    // Recheck immediately before spawn to reduce the external-start race.
    const health = await this.client.getHealth();
    if (health.state === 'reachable') {
      await pipe.close();
      this.shutdownPipe = undefined;
      this.state = {
        state: 'external',
        ownership: 'external',
        detail: 'A compatible MCPWorkers Manager became available. DevKit attached without taking process ownership.',
      };
      return this.state;
    }
    if (health.state !== 'unavailable') {
      await pipe.close();
      this.shutdownPipe = undefined;
      this.state = {
        state: 'blocked',
        ownership: 'none',
        detail: health.detail || 'The configured MCPWorkers endpoint is responding but is not compatible.',
      };
      return this.state;
    }

    try {
      const process = await this.processManager.start(MCPWORKERS_MANAGER_SERVICE, {
        ...launchSpec,
        env: {
          ...(launchSpec.env ?? {}),
          DEVKIT_MCPWORKERS_SHUTDOWN_PIPE: pipe.path,
        },
      });
      this.startedByThisSession = true;
      await Promise.all([
        pipe.waitForConnection(this.readinessTimeoutMs),
        this.waitForApiReadiness(),
      ]);
      const observation = await this.processManager.getObservation(MCPWORKERS_MANAGER_SERVICE.id);
      this.state = {
        state: 'managed',
        ownership: 'devkit',
        ...(observation.pid ? { pid: observation.pid } : process.pid ? { pid: process.pid } : {}),
        detail: 'MCPWorkers Manager was started by DevKit Runtime and passed its API readiness check.',
      };
      return this.state;
    } catch (error) {
      await this.stopOwnedProcess();
      this.state = {
        state: 'unavailable',
        ownership: 'none',
        detail: error instanceof Error ? error.message : 'MCPWorkers Manager startup failed.',
      };
      return this.state;
    }
  }

  private async waitForApiReadiness(): Promise<void> {
    const deadline = this.now() + this.readinessTimeoutMs;
    while (this.now() < deadline) {
      const health = await this.client.getHealth();
      if (health.state === 'reachable') return;
      if (health.state !== 'unavailable') {
        throw new Error(health.detail || 'MCPWorkers Manager returned an incompatible API response.');
      }
      const observation = await this.processManager.getObservation(MCPWORKERS_MANAGER_SERVICE.id);
      if (observation.state === 'exited') {
        throw new Error('MCPWorkers Manager exited before its API became ready.');
      }
      if (observation.state === 'unobservable') {
        throw new Error('MCPWorkers Manager process ownership became unobservable during startup.');
      }
      await this.delay(this.readinessPollIntervalMs);
    }
    throw new Error('MCPWorkers Manager API did not become ready within ' + this.readinessTimeoutMs + ' ms.');
  }

  shutdown(): Promise<McpWorkersManagerRuntimeState> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.shutdownInternal().finally(() => {
      this.shutdownPromise = undefined;
    });
    return this.shutdownPromise;
  }

  private async shutdownInternal(): Promise<McpWorkersManagerRuntimeState> {
    const startup = this.startPromise;
    if (startup) await startup.catch(() => undefined);
    await this.refreshState();

    if (!this.startedByThisSession) {
      await this.shutdownPipe?.close();
      this.shutdownPipe = undefined;
      return this.state;
    }

    try {
      await this.shutdownPipe?.requestShutdown();
    } catch {
      // The bounded observation below decides whether a force-stop is required.
    }

    const deadline = this.now() + this.shutdownTimeoutMs;
    let observation: ProcessObservation = await this.processManager.getObservation(MCPWORKERS_MANAGER_SERVICE.id);
    while (observation.state === 'present' && this.now() < deadline) {
      await this.delay(this.readinessPollIntervalMs);
      observation = await this.processManager.getObservation(MCPWORKERS_MANAGER_SERVICE.id);
    }

    if (observation.state === 'present' && observation.identityVerified) {
      await this.processManager.stop(MCPWORKERS_MANAGER_SERVICE);
    } else if (observation.state === 'unobservable' || observation.state === 'present') {
      this.state = {
        state: 'blocked',
        ownership: 'none',
        detail: 'Manager process ownership could not be verified at shutdown; DevKit left it untouched.',
      };
      await this.shutdownPipe?.close();
      this.shutdownPipe = undefined;
      this.startedByThisSession = false;
      return this.state;
    }

    await this.shutdownPipe?.close();
    this.shutdownPipe = undefined;
    this.startedByThisSession = false;
    this.state = {
      state: 'unavailable',
      ownership: 'none',
      detail: 'DevKit-owned MCPWorkers Manager was shut down.',
    };
    return this.state;
  }

  private async stopOwnedProcess(): Promise<void> {
    if (!this.startedByThisSession) {
      await this.shutdownPipe?.close();
      this.shutdownPipe = undefined;
      return;
    }
    try {
      await this.shutdownPipe?.requestShutdown();
    } catch {
      // Fall through to bounded process observation.
    }
    const deadline = this.now() + this.shutdownTimeoutMs;
    let observation = await this.processManager.getObservation(MCPWORKERS_MANAGER_SERVICE.id);
    while (observation.state === 'present' && this.now() < deadline) {
      await this.delay(this.readinessPollIntervalMs);
      observation = await this.processManager.getObservation(MCPWORKERS_MANAGER_SERVICE.id);
    }
    if (observation.state === 'present' && observation.identityVerified) {
      await this.processManager.stop(MCPWORKERS_MANAGER_SERVICE);
    }
    await this.shutdownPipe?.close();
    this.shutdownPipe = undefined;
    this.startedByThisSession = false;
  }
}
