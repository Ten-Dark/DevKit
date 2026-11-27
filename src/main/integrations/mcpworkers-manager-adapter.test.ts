import { describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '../core/adapter-registry.js';
import type { ProcessObservation } from '../core/contracts.js';
import {
  MCPWORKERS_MANAGER_SERVICE,
  type McpWorkersManagerRuntime,
  type McpWorkersManagerRuntimeState,
} from './mcpworkers-manager-runtime.js';
import { createMcpWorkersManagerAdapter } from './mcpworkers-manager-adapter.js';

function observation(
  state: ProcessObservation['state'],
  identityVerified: boolean,
  ownership?: ProcessObservation['ownership'],
): ProcessObservation {
  return { state, observedAt: new Date().toISOString(), identityVerified, ...(ownership ? { ownership } : {}) };
}

function createRuntime(state: McpWorkersManagerRuntimeState) {
  return {
    getState: vi.fn().mockReturnValue(state),
    getProcessObservation: vi.fn().mockResolvedValue(
      observation(
        state.state === 'managed' || state.state === 'external' ? 'present' : 'absent',
        state.ownership === 'devkit' || state.ownership === 'none',
        state.ownership === 'devkit' ? 'managed' : state.ownership === 'external' ? 'external' : undefined,
      ),
    ),
    startOrAttach: vi.fn().mockResolvedValue(state),
    shutdown: vi.fn().mockResolvedValue(state),
  } as unknown as McpWorkersManagerRuntime;
}

describe('MCPWorkers Manager Runtime adapter', () => {
  it('registers as a DevKit-managed Runtime service with the dedicated adapter', () => {
    const registry = new AdapterRegistry();
    registry.register(createMcpWorkersManagerAdapter(createRuntime({
      state: 'unavailable',
      ownership: 'none',
      detail: 'Manager is not running.',
    })));
    expect(registry.validateService(MCPWORKERS_MANAGER_SERVICE)).toMatchObject({
      valid: true,
      errors: [],
    });
  });

  it('accepts only an empty adapter config', () => {
    const adapter = createMcpWorkersManagerAdapter(createRuntime({
      state: 'external',
      ownership: 'external',
      detail: 'External Manager attached.',
    }));
    expect(adapter.validateConfig({})).toEqual({ valid: true, errors: [] });
    expect(adapter.validateConfig({ executablePath: 'node.exe' }).valid).toBe(false);
  });

  it('reports an external Manager as present without verified DevKit ownership', async () => {
    const runtime = createRuntime({
      state: 'external',
      ownership: 'external',
      detail: 'External Manager attached.',
    });
    const adapter = createMcpWorkersManagerAdapter(runtime);

    await expect(adapter.getStatus!({} as never, { operationId: 'test' })).resolves.toMatchObject({
      state: 'present',
      identityVerified: false,
      ownership: 'external',
    });
    expect(adapter.healthCheck).toBeDefined();
  });

  it('delegates Runtime start to the start-or-attach supervisor', async () => {
    const runtime = createRuntime({
      state: 'managed',
      ownership: 'devkit',
      pid: 1234,
      detail: 'Started by DevKit.',
    });
    const adapter = createMcpWorkersManagerAdapter(runtime);

    await adapter.start!({} as never, { operationId: 'test' });
    expect(runtime.startOrAttach).toHaveBeenCalledOnce();
  });

  it('refuses to stop an externally owned Manager', async () => {
    const runtime = createRuntime({
      state: 'external',
      ownership: 'external',
      detail: 'External Manager attached.',
    });
    const adapter = createMcpWorkersManagerAdapter(runtime);

    await expect(adapter.stop!({} as never, { operationId: 'test' })).rejects.toThrow(/externally owned/);
    expect(runtime.shutdown).not.toHaveBeenCalled();
  });

  it('delegates stop only for a DevKit-managed Manager', async () => {
    const runtime = createRuntime({
      state: 'managed',
      ownership: 'devkit',
      pid: 1234,
      detail: 'Started by DevKit.',
    });
    const adapter = createMcpWorkersManagerAdapter(runtime);

    await adapter.stop!({} as never, { operationId: 'test' });
    expect(runtime.shutdown).toHaveBeenCalledOnce();
  });
});
