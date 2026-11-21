import { randomUUID } from 'node:crypto'
import { dialog, type IpcMainInvokeEvent } from 'electron'
import { mainWindow } from '../window.js'
import type { RuntimeCore } from './runtime-core.js'
import { registerTrustedRuntimeIpcHandler } from './secure-ipc.js'

const SERVICE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function assertServiceId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SERVICE_ID_PATTERN.test(value)) {
    throw new Error('Invalid service identifier.')
  }
}


function assertApprovedServiceIds(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((id) => typeof id !== 'string' || !SERVICE_ID_PATTERN.test(id)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('Approved service identifiers are invalid.')
  }
}

async function runMutation<T>(
  runtime: RuntimeCore,
  operationId: string,
  operation: string,
  serviceId: string | undefined,
  action: () => Promise<T>,
): Promise<T> {
  await runtime.eventLogger.emit({
    type: 'runtime.operation.started',
    level: 'info',
    correlationId: operationId,
    ...(serviceId ? { serviceId } : {}),
    message: `Runtime operation '${operation}' started.`,
  })
  try {
    const result = await action()
    await runtime.eventLogger.emit({
      type: 'runtime.operation.completed',
      level: 'info',
      correlationId: operationId,
      ...(serviceId ? { serviceId } : {}),
      message: `Runtime operation '${operation}' completed.`,
    }).catch((error: unknown) => {
      console.error('[DevKit Runtime] Could not persist operation completion event:', error)
    })
    return result
  } catch (error) {
    await runtime.eventLogger.emit({
      type: 'runtime.operation.failed',
      level: 'error',
      correlationId: operationId,
      ...(serviceId ? { serviceId } : {}),
      message: `Runtime operation '${operation}' failed.`,
      details: { error: error instanceof Error ? error.message : 'Unknown error.' },
    }).catch(() => undefined)
    throw error
  }
}

export function registerRuntimeHandlers(runtime: RuntimeCore): void {
  registerTrustedRuntimeIpcHandler('runtime:selectExecutable', async () => {
    const options = {
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Windows executable', extensions: ['exe', 'com'] }],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  registerTrustedRuntimeIpcHandler('runtime:selectWorkingDirectory', async () => {
    const options = { properties: ['openDirectory'] as Array<'openDirectory'> }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  registerTrustedRuntimeIpcHandler('runtime:listServices', async (_event: IpcMainInvokeEvent) => {
    return runtime.listServices()
  })

  registerTrustedRuntimeIpcHandler('runtime:getServiceDetails', async (_event, serviceId: unknown) => {
    assertServiceId(serviceId)
    return runtime.getServiceDetails(serviceId)
  })

  registerTrustedRuntimeIpcHandler('runtime:getStartPlan', async (_event, serviceId: unknown) => {
    assertServiceId(serviceId)
    return runtime.getStartPlan(serviceId)
  })

  registerTrustedRuntimeIpcHandler(
    'runtime:registerService',
    async (_event, definition: unknown) => {
      const candidate = definition as { id?: unknown } | null
      const serviceId = candidate && typeof candidate.id === 'string' && SERVICE_ID_PATTERN.test(candidate.id)
        ? candidate.id
        : undefined
      return runMutation(runtime, randomUUID(), 'register-service', serviceId, () =>
        runtime.registerService(definition),
      )
    },
  )

  registerTrustedRuntimeIpcHandler(
    'runtime:executeStartPlan',
    async (_event, serviceId: unknown, approvedServiceIds: unknown) => {
      assertServiceId(serviceId)
      assertApprovedServiceIds(approvedServiceIds)
      return runMutation(runtime, randomUUID(), 'start-plan', serviceId, () =>
        runtime.executeStartPlan(serviceId, approvedServiceIds),
      )
    },
  )

  registerTrustedRuntimeIpcHandler(
    'runtime:stopService',
    async (_event, serviceId: unknown) => {
      assertServiceId(serviceId)
      return runMutation(runtime, randomUUID(), 'stop-service', serviceId, () =>
        runtime.stopService(serviceId),
      )
    },
  )

  registerTrustedRuntimeIpcHandler(
    'runtime:restartService',
    async (_event, serviceId: unknown) => {
      assertServiceId(serviceId)
      return runMutation(runtime, randomUUID(), 'restart-service', serviceId, () =>
        runtime.restartService(serviceId),
      )
    },
  )

  registerTrustedRuntimeIpcHandler(
    'runtime:acknowledgeUnobservableStopped',
    async (_event, serviceId: unknown, confirmedStopped: unknown) => {
      assertServiceId(serviceId)
      if (confirmedStopped !== true) throw new Error('Explicit stopped-state confirmation is required.')
      return runMutation(runtime, randomUUID(), 'acknowledge-stopped-process', serviceId, () =>
        runtime.acknowledgeUnobservableStopped(serviceId, true),
      )
    },
  )

  registerTrustedRuntimeIpcHandler(
    'runtime:unregisterService',
    async (_event, serviceId: unknown) => {
      assertServiceId(serviceId)
      return runMutation(runtime, randomUUID(), 'unregister-service', serviceId, () =>
        runtime.unregisterService(serviceId),
      )
    },
  )

  registerTrustedRuntimeIpcHandler('runtime:getRecentEvents', async (_event, limit: unknown) => {
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 1_000)) {
      throw new Error('Event limit must be an integer between 1 and 1000.')
    }
    return runtime.getRecentEvents((limit as number | undefined) ?? 100)
  })
}
