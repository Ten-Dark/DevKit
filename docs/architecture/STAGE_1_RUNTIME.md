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

Latest validation on 2026-11-22:

- `npm run check`: passed; **423 tests across 39 files**, TypeScript clean, ESLint 0 errors and 6 existing `no-explicit-any` warnings in the E2E specs.
- `npm run build`: passed; production and fault-injection native addons compiled with MSVC for Electron 45.4.1 x64, renderer build completed, and the native `postbuild` suite passed.
- Native postbuild coverage: owner-crash containment, 100 lifecycle cycles (process handles 189 -> 188), compatible/breakaway-enabled/constrained parent Job Object scenarios, and **20/20 direct fault-injection cases** (handles 180 -> 181).
- Packaged-ASAR Electron provider postbuild: 50 lifecycle cycles passed with stable process handles (709 -> 709); main-process crash-containment passed.
- Extended stress evidence from the same Windows 11 x64 host: 5,000 native lifecycle cycles and 2,000 packaged-ASAR Electron cycles passed within the configured +3 process-handle tolerance.
- Soak harness smoke run: **73 seconds, 7,654 cycles, 233 samples**, process handles 177 -> 177. This validates the harness path but does not replace the required two-hour soak.
- The full two-hour native soak is currently running as the Windows Scheduled Task `DevKitRuntimeSoakStage1`; completion is pending. Its stdout/stderr and exit code are recorded in a unique subdirectory under `%TEMP%`.
- `npm run validate:asar`: passed; the Windows package contains all 7,076 ASAR files, all 20 required runtime files, and the native addon in unpacked resources.
- Latest Electron E2E: development **2/2** and packaged **4/4** passed, including preload/API availability, packaged-mode verification, updater API availability and managed-service crash containment.
- `npm audit` and `npm audit --omit=dev`: **0 vulnerabilities**.
- Earlier isolated NSIS-installed E2E on this host: **4/4** passed, including installed Runtime crash containment.

These checks validate the recorded Windows x64 development, packaged and isolated per-user NSIS-installed flows on the current Windows 11 host. The two-hour soak and broader Windows-version compatibility gates remain open. This evidence does not establish support for every Windows configuration or Linux/macOS compatibility.

## Known limitations and follow-up

- The Windows Process Control Provider declares `gracefulShutdown: false`, `processTreeManagement: true` and `ownershipVerification: 'native-process-handle'`. Native Job Object containment is implemented and integration-tested; remaining production gates are documented in [WINDOWS_PROCESS_CONTROL.md](./WINDOWS_PROCESS_CONTROL.md).
- The current process ownership model deliberately does not reattach to PIDs after app restart. A future platform-specific ownership strategy must preserve the no-kill-unknown-process invariant.

- Startup readiness currently uses process observation and an optional loopback HTTP probe; advanced functional probes, retries/backoff policies and continuous monitoring remain future work.
- Dependency version constraints support a deliberately small syntax (`=`, `>=`, `^`, `~`, `*`), not full SemVer ranges.
- Service definitions are registered and lifecycle-managed, but installation/update/uninstall of binaries and runtime dependencies are out of scope.
- Vault, Storage Hub, MCP Hub integration, Inspector, automatic recovery and team collaboration remain separate roadmap stages.

## Acceptance status

The Windows Runtime MVP implementation, automated checks, development Electron smoke tests, packaged Electron smoke tests and one-host NSIS-installed crash-containment validation pass. The implementation is not yet declared production-ready. Complete the remaining Windows production-readiness gates before approving a production release or expanding platform scope. Linux/macOS remain future targets and are not part of current acceptance.
