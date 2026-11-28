import type { ServiceAdapter } from '../core/adapter-registry.js';
import type { HealthCheckResult, ProcessObservation } from '../core/contracts.js';
import type { McpWorkersManagerRuntime } from './mcpworkers-manager-runtime.js';

function getObservation(runtime: McpWorkersManagerRuntime): Promise<ProcessObservation> {
  return runtime.getProcessObservation();
}

function getHealth(runtime: McpWorkersManagerRuntime): HealthCheckResult[] {
  const state = runtime.getState();
  return [{
    id: 'mcpworkers-manager-api',
    type: 'http',
    state: state.state === 'managed' || state.state === 'external'
      ? 'pass'
      : state.state === 'blocked' ? 'unknown' : 'fail',
    checkedAt: new Date().toISOString(),
    durationMs: 0,
    message: state.detail,
  }];
}

export function createMcpWorkersManagerAdapter(runtime: McpWorkersManagerRuntime): ServiceAdapter {
  return {
    id: 'mcpworkers.manager',
    version: '1.0.0',
    platforms: ['win32'],
    capabilities: ['status', 'health', 'start', 'stop'],
    validateConfig(config) {
      if (!config || typeof config !== 'object' || Array.isArray(config)
        || Object.keys(config).length > 0) {
        return { valid: false, errors: ['MCPWorkers Manager adapter config must be an empty object.'] };
      }
      return { valid: true, errors: [] };
    },
    async getStatus() {
      return getObservation(runtime);
    },
    async healthCheck() {
      return getHealth(runtime);
    },
    async start() {
      await runtime.startOrAttach();
      return getObservation(runtime);
    },
    async stop() {
      if (runtime.getState().state === 'external') {
        throw new Error('Cannot stop an externally owned MCPWorkers Manager.');
      }
      await runtime.shutdown();
      return getObservation(runtime);
    },
  };
}
