# Windows Process Control — implementation design

**Status:** design target; native Job Object integration is not implemented yet.
**Current implementation:** `ProcessControlProvider` contract plus a Windows provider that wraps the current session's Node `ChildProcess` reference. That wrapper is not a native OS process handle. Graceful shutdown and descendant-process containment are explicitly unsupported.

## Goals

- Keep `ProcessManager` responsible for shared lifecycle orchestration, persistence, dependency policy, readiness and runtime events.
- Keep Windows process creation, native process identity, process-tree containment and termination inside `WindowsProcessControlProvider`.
- Never terminate a process based only on a PID recovered from a previous DevKit session.
- Never silently fall back to PID-based tree killing when native ownership cannot be established.

## Required Windows mechanism

Use a Windows Job Object per managed service instance. A Job Object groups processes and allows the operating system to apply process limits and terminate the group as a unit. Child processes created through the normal process-creation path join the job by default, unless breakaway behavior is explicitly enabled. DevKit must not enable breakaway for managed services.

Microsoft references:

- [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- [TerminateJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject)

## Safe process creation sequence

A process must not be allowed to create descendants before it is contained by its Job Object. Assigning a normally spawned process after it has started leaves a race in which it may create a child before assignment.

The native implementation must therefore provide a controlled creation sequence:

1. Create a non-inheritable Job Object with a restrictive security descriptor.
2. Configure required limits, including kill-on-last-handle-close for the managed service lifetime.
3. Create the service process in a suspended state using the Windows process-creation API.
4. Assign the suspended process to the Job Object.
5. Verify assignment succeeded; if not, terminate the still-suspended process and close all native handles.
6. Resume the primary thread only after successful assignment.
7. Return an owned process/job handle bundle to the provider and then let `ProcessManager` persist the started state.

The current Node `child_process.spawn()` abstraction does not expose the native process/thread handles or suspended-creation flags needed for this sequence. The implementation therefore requires a narrowly scoped native Node-API addon or an equivalent audited native helper. A post-spawn PID assignment is not an acceptable substitute for this guarantee.

## Ownership and recovery

- Keep the process handle and Job Object handle in memory for the lifetime of the managed instance.
- Do not make a persisted PID sufficient authority to reopen, attach to or terminate a process after DevKit restarts.
- Persist service ID, PID for diagnostics, start timestamp, executable identity evidence, owner token and provider version as audit metadata only.
- Configure kill-on-close so a DevKit crash or orderly shutdown closes the last Job Object handle and the operating system terminates the contained service tree.
- If Job Object assignment or ownership verification fails, fail closed. Do not start the service in an unmanaged mode.
- If DevKit itself is already inside a Windows Job Object and nested assignment is rejected or incompatible, report an actionable error. Do not fall back to `taskkill`, process-name matching or PID-only termination.

## Shutdown semantics

Job Object termination is forceful. It is not a graceful-shutdown protocol.

- Keep `gracefulShutdown` false until a separate, explicit service shutdown contract exists and is validated.
- A future graceful contract must be opt-in per service, bounded by a timeout, authenticated or otherwise restricted to the local managed instance, and independently tested.
- On graceful timeout or failure, use the owned Job Object as the forceful fallback.
- Use Job Object accounting/notifications to confirm the managed group has no active processes before reporting a complete tree shutdown.
- Never describe a Windows `child.kill('SIGTERM')` call as graceful; Node documents that supported Windows signals terminate abruptly.

## Provider contract requirements

The shared provider contract must continue to expose capabilities rather than implying every OS supports the same behavior:

- `gracefulShutdown`: false until a cooperative shutdown protocol is implemented.
- `processTreeManagement`: true only when the Job Object owns the root process before it can create descendants and the provider can confirm the group is empty.
- `ownershipVerification`: the current provider reports only a session-scoped child reference; the production target must hold and operate through native process and Job Object handles.
- Spawn options, executable/path rules, process identity, graceful shutdown, force termination and handle cleanup remain provider responsibilities.

`ProcessManager` continues to own serialized mutations, service state transitions, persistence, dependency/readiness policy, rollback policy and lifecycle event semantics.

## Acceptance tests before enabling process-tree capability

- A fixture process starts one child and one grandchild; stopping the service terminates the entire contained tree.
- A child attempts to create descendants immediately at startup; none can escape before Job Object assignment.
- DevKit exits normally and unexpectedly; kill-on-close leaves no managed descendants.
- A graceful shutdown request succeeds; force termination is not called.
- A graceful shutdown request times out; Job Object force termination completes and the group-empty condition is verified.
- Job Object creation, configuration or assignment fails; the service is not resumed and no unmanaged process remains.
- Nested Job Object restrictions and host-managed job scenarios fail closed with actionable diagnostics.
- Breakaway behavior is disabled and tested.
- Repeated start/stop/restart cycles do not leak native handles.
- Packaged Windows x64 E2E verifies the native addon is loaded from the installed app and the same lifecycle behavior works outside the development environment.
