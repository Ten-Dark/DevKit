# Stage 1 — DevKit Runtime

**Status:** Implementation complete; release review in progress
**Branch:** `feat/runtime-mvp`
**Architecture baseline:** [Stage 0 Foundation](STAGE_0_FOUNDATION.md)

## MVP outcome

The Runtime MVP provides a local, adapter-driven service lifecycle inside the DevKit workspace. A user can register a DevKit-managed local process, inspect process and readiness health, review dependency-aware startup plans, explicitly approve and execute a plan, stop/restart eligible services, inspect recent lifecycle events, and remove a registration without deleting service files or data.

The initial built-in process adapter is Windows-only. It uses direct executable paths and argument arrays with `shell: false`; Linux/macOS adapters are not part of this stage.

## Delivered work packages

| # | Work package | Status | Implementation |
| --- | --- | --- | --- |
| 1 | Workspace bootstrap | Complete | Canonical per-user workspace root, owner manifest, symlink/path checks and Electron single-instance lock |
| 2 | Config migration | Complete | Versioned workspace settings; legacy settings copied atomically and retained |
| 3 | Core contracts | Complete | Service ownership, capabilities, process observation, health, dependencies and runtime events |
| 4 | Registry persistence | Complete | Validated versioned JSON, bounded size/count, serialized writes, atomic replacement and validated backup recovery |
| 5 | Event/logging foundation | Complete | Structured JSONL lifecycle events, correlation IDs, redaction, bounded event size and log rotation |
| 6 | Adapter registry | Complete | Explicit adapter registration, platform/capability/config validation |
| 7 | Process manager | Complete | Direct spawn, `shell: false`, bounded args/env, persisted ownership evidence, graceful/forced stop and conservative restart recovery |
| 8 | Health/readiness | Complete | Separate process and aggregate state, bounded loopback HTTP readiness probe, stale-result protection |
| 9 | Dependency engine | Complete | Required/optional dependencies, version/capability checks, topological startup plans and cycle blockers |
| 10 | Core IPC | Complete | Narrow typed preload surface, trusted renderer sender validation, input validation, operation IDs and audit events |
| 11 | Services UI | Complete | Registration, service list/details, dependency/startup plan review, lifecycle controls and confirmation flows |
| 12 | Integration and acceptance | Complete | Runtime, IPC, process, registry, health, workspace and renderer tests |

## Runtime safety boundaries

- Only explicitly registered `managed` services can use the built-in local process adapter. Connected services are not accepted by this adapter.
- The process manager launches an absolute executable path with an argument array and `shell: false`; it does not accept shell command strings.
- Stop operations act through a child-process handle created by the current ProcessManager session. A PID recovered from a previous application session is treated as unobservable and is never reattached to or terminated.
- Clearing an unobservable ownership record requires an explicit user confirmation. It does not terminate the process.
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

Latest validation on the current working tree:

- `npm run build`: passed.
## Validation

Latest validation on the current working tree:

- `npm run build`: passed.
- `npm run check`: passed.
- TypeScript: no errors.
- ESLint: no errors; 6 existing `no-explicit-any` warnings remain in `tests/e2e/dev.spec.ts` and `tests/e2e/packaged.spec.ts`.
- Vitest: **388 tests passed across 34 test files**.
- `npm run test:e2e:dev`: **2/2 Electron development smoke tests passed**, including preload API availability and Home rendering.
- `npm run pack`: passed; electron-builder produced `dist-electron/win-unpacked` for Windows x64.
- `npm run test:e2e:packaged`: **3/3 packaged Electron smoke tests passed**, including `app.isPackaged` and updater API availability.
- `git diff --check`: passed. Windows reports non-blocking LF/CRLF working-copy notices.

The test suite includes focused coverage for contracts, adapter validation, registry persistence/recovery, process lifecycle, health/readiness, dependency planning, runtime orchestration, trusted IPC, settings/workspace bootstrap, and Services UI behavior. The packaged smoke tests validate the Windows x64 artifact in this environment; they do not establish support for Linux or macOS.

## Acceptance status

The Windows Runtime MVP implementation, automated checks, development Electron smoke tests and packaged Electron smoke tests pass. The remaining work is final source/diff review, commit and PR review/merge through the repository's normal process. Do not interpret this as cross-platform release readiness.
## Known limitations and follow-up

- Built-in local process adapter currently targets `win32` only.
- The current process ownership model deliberately does not reattach to PIDs after app restart. A future platform-specific ownership strategy must preserve the no-kill-unknown-process invariant.
- Startup readiness currently uses process observation and an optional loopback HTTP probe; advanced functional probes, retries/backoff policies and continuous monitoring remain future work.
- Dependency version constraints support a deliberately small syntax (`=`, `>=`, `^`, `~`, `*`), not full SemVer ranges.
- Service definitions are registered and lifecycle-managed, but installation/update/uninstall of binaries and runtime dependencies are out of scope.
- Vault, Storage Hub, MCP Hub integration, Inspector, automatic recovery and team collaboration remain separate roadmap stages.

## Acceptance status

The Runtime MVP implementation and automated checks are complete. Before release, finish the final diff review, correct formatting findings, perform a packaged Electron smoke test where the environment permits, and merge through the repository's normal PR process. Do not mark the release complete solely on the basis of unit tests.
