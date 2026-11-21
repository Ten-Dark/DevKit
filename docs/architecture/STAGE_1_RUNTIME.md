# Stage 1 — DevKit Runtime

**Status:** Implementation complete; Windows production-readiness work remains
**Branch:** `feat/runtime-mvp`
**Architecture baseline:** [Stage 0 Foundation](STAGE_0_FOUNDATION.md)
**Platform decision:** [ADR-012 — Platform support and extensibility](ARCHITECTURE_DECISIONS.md#adr-012--platform-support-is-adapter-driven-windows-is-the-first-production-target)

## MVP outcome

The Runtime MVP provides a local, adapter-driven service lifecycle inside the DevKit workspace. A user can register a DevKit-managed local process, inspect process and readiness health, review dependency-aware startup plans, explicitly approve and execute a plan, stop/restart eligible services, inspect recent lifecycle events, and remove a registration without deleting service files or data.

**Windows is the only supported platform for this MVP.** Linux and macOS are intentionally deferred until Windows has passed the production-readiness gate. The current implementation and tests must not be described as cross-platform support.

## Platform architecture and scalability

Cross-platform extensibility is required now; implementing or supporting additional operating systems is not.

- Runtime domain contracts, dependency planning, service state, orchestration policy and renderer-facing APIs remain OS-independent.
- The `ServiceAdapter` contract declares supported `platforms` and `capabilities`. `AdapterRegistry` validates both the adapter and each service against the active platform; unsupported combinations are rejected.
- The built-in `process.local` adapter declares `platforms: ['win32']`. This is an intentional support boundary, not a temporary runtime fallback.
- `ProcessManager` owns shared lifecycle orchestration and delegates OS-specific process creation, ownership and termination to `ProcessControlProvider`. Windows-specific behavior stays inside `WindowsProcessControlProvider`; the domain and renderer contracts remain OS-independent.
- Each additional OS must implement its own `ProcessControlProvider` for spawn options, process identity and ownership verification, graceful termination, process-tree handling, force-stop semantics and executable/path rules. Do not add platform-specific branches to `ProcessManager`.
- Keep common persistence, operation serialization, dependency orchestration, readiness policy and event semantics above the platform strategy.
- A future platform adapter must pass its own filesystem, permission, process-tree, packaging, recovery and packaged integration tests. Node.js API availability or successful compilation is not sufficient evidence of support.
- Do not add Linux/macOS code paths, CI targets or dependencies during the Windows MVP unless a concrete Windows requirement needs them.

### Windows production-readiness gate

Before expanding platform scope, validate the Windows implementation across packaged installation, update/uninstall and rollback; workspace ownership and permissions; process start/readiness/stop/restart; application restart and orphan-process scenarios; process-tree behavior; path/environment edge cases; backup/recovery; security review; supported Windows versions; and repeatable packaged E2E tests.

## Delivered work packages

| # | Work package | Status | Implementation |
| --- | --- | --- | --- |
| 1 | Workspace bootstrap | Complete | Canonical per-user workspace root, owner manifest, symlink/path checks and Electron single-instance lock |
| 2 | Config migration | Complete | Versioned workspace settings; legacy settings copied atomically and retained |
| 3 | Core contracts | Complete | Service ownership, capabilities, process observation, health, dependencies and runtime events |
| 4 | Registry persistence | Complete | Validated versioned JSON, bounded size/count, serialized writes, atomic replacement and validated backup recovery |
| 5 | Event/logging foundation | Complete | Structured JSONL lifecycle events, correlation IDs, redaction, bounded event size and log rotation |
| 6 | Adapter registry | Complete | Explicit adapter registration, platform/capability/config validation |
| 7 | Process manager | Complete (MVP scope) | Shared lifecycle orchestration delegates OS-specific spawn and termination to a Process Control Provider; current Windows provider manages a session-scoped direct-child reference only |
| 8 | Health/readiness | Complete | Separate process and aggregate state, bounded loopback HTTP readiness probe, stale-result protection |
| 9 | Dependency engine | Complete | Required/optional dependencies, version/capability checks, topological startup plans and cycle blockers |
| 10 | Core IPC | Complete | Narrow typed preload surface, trusted renderer sender validation, input validation, operation IDs and audit events |
| 11 | Services UI | Complete | Registration, service list/details, dependency/startup plan review, lifecycle controls and confirmation flows |
| 12 | Integration and acceptance | Complete | Runtime, IPC, process, registry, health, workspace and renderer tests |

## Runtime safety boundaries

- Only explicitly registered `managed` services can use the built-in local process adapter. Connected services are not accepted by this adapter.
- The process manager launches an absolute executable path with an argument array. The Windows provider calls `CreateProcessW` directly; it does not invoke a command shell or accept shell command strings.

- Windows process creation uses the native Node-API addon: `CreateProcessW(CREATE_SUSPENDED)` → `AssignProcessToJobObject()` → `ResumeThread()`. A private Job Object uses `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; force-stop terminates the complete group and waits for `ActiveProcesses === 0`. Native process and Job Object handles remain in memory; a persisted PID is never authority to reattach or terminate after restart. Graceful shutdown remains unsupported.
- **Windows stop is forceful, not graceful.** The native provider uses a private Job Object to contain the managed process and descendants from the first instruction. `TerminateJobObject` force-stops the complete group; the manager waits for the Job Object to become empty. An application-level graceful shutdown protocol is not implemented.
- A service cannot be unregistered while its process may still be running or while registered dependents reference it. Unregistering removes only the registry entry; it does not delete files or service data.
- Startup execution requires an exact match between the approved service sequence and the current plan. Dependencies are started in provider-first order and must pass readiness before dependents start.
- If a startup plan fails, rollback attempts to stop only services started by that plan, in reverse order. Pre-existing ready services are not stopped.
- Stop/restart is blocked while transitive dependents are running, degraded or unknown.
- HTTP readiness probes are restricted to loopback HTTP(S) URLs, bounded timeouts and expected status codes. Redirects are not followed.
- Environment inheritance is allowlisted; secret-like environment variable names are rejected until Vault integration exists.
- The Runtime currently does not install services, update binaries, execute arbitrary commands, manage connected-service lifecycles, or implement Vault cryptography.

## Workspace layout

The initial workspace is rooted at `app.getPath('userData')/workspace`. Runtime data is grouped into dedicated directories for configuration, registry, services, service data, runtimes, workflows, events, logs, cache, backups and the future Vault. The workspace manifest carries a stable UUID, schema version, owner marker and timestamps.

## Validation

Latest validation recorded for the implementation branch:

- `npm run build`: passed.
- `npm run check`: passed.
- TypeScript: no errors.
- ESLint: no errors; 6 existing `no-explicit-any` warnings remain in `tests/e2e/dev.spec.ts` and `tests/e2e/packaged.spec.ts`.
- Vitest: **395 tests passed across 35 test files**.
- Native `postbuild` hook (`npm run test:native:windows`): passed; runs automatically after `npm run build` and verifies process-tree termination, kill-on-close, argument/environment boundaries and Electron provider loading.
- `npm run test:e2e:dev`: **2/2 Electron development smoke tests passed**, including preload API availability and Home rendering.
- `npm run pack`: passed; electron-builder produced `dist-electron/win-unpacked` for Windows x64.
- `npm run test:e2e:packaged`: **3/3 packaged Electron smoke tests passed**, including `app.isPackaged` and updater API availability.
- `git diff --check`: passed.

These checks validate the recorded Windows x64 development and packaged flows. They do not establish production readiness, support for every Windows configuration, or Linux/macOS compatibility.

## Known limitations and follow-up

- The Windows Process Control Provider declares `gracefulShutdown: false`, `processTreeManagement: true` and `ownershipVerification: 'native-process-handle'`. Native Job Object containment is implemented and integration-tested; remaining production gates are documented in [WINDOWS_PROCESS_CONTROL.md](./WINDOWS_PROCESS_CONTROL.md).
- The current process ownership model deliberately does not reattach to PIDs after app restart. A future platform-specific ownership strategy must preserve the no-kill-unknown-process invariant.

- Startup readiness currently uses process observation and an optional loopback HTTP probe; advanced functional probes, retries/backoff policies and continuous monitoring remain future work.
- Dependency version constraints support a deliberately small syntax (`=`, `>=`, `^`, `~`, `*`), not full SemVer ranges.
- Service definitions are registered and lifecycle-managed, but installation/update/uninstall of binaries and runtime dependencies are out of scope.
- Vault, Storage Hub, MCP Hub integration, Inspector, automatic recovery and team collaboration remain separate roadmap stages.

## Acceptance status

The Windows Runtime MVP implementation, automated checks, development Electron smoke tests and packaged Electron smoke tests pass. The implementation is not yet declared production-ready. Complete the Windows production-readiness gate before approving a production release or expanding platform scope. Linux/macOS remain future targets and are not part of current acceptance.
