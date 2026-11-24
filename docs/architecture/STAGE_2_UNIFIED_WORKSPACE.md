# Stage 2 — Unified Workspace MVP

**Status:** In progress — workspace shell, MCP vertical slice, OS secret-protection adapter, and read-only Local Folder Storage provider implemented; full stage acceptance remains open  
**Target platform:** Windows 11 x64  
**Branch:** `feat/unified-workspace-mvp`  
**Baseline:** `main` after Runtime PR #13  
**Last validation:** 2026-11-24

This document defines the Stage 2 delivery boundary and acceptance criteria. It is subordinate to [ROADMAP.md](../ROADMAP.md), [PRODUCT_VISION.md](../PRODUCT_VISION.md), and the architecture contracts.

## 1. Outcome

Deliver the first coherent DevKit workspace experience that connects the accepted Runtime foundation to real services and integrations.

The MVP must let a developer:

1. Open one workspace shell and see useful, real workspace/service state.
2. Discover and manage selected existing local services without silently taking ownership of them.
3. Discover MCP servers, configure connections, connect/disconnect, and inspect the tools exposed by a server.
4. Persist non-secret configuration and protect credentials using OS-backed storage.
5. Establish explicit Vault and Storage boundaries, with an initial read-only Storage provider.

This is a vertical slice, not a general-purpose service marketplace or AI agent platform.

## 2. Boundaries and ownership

### 2.1 Runtime-owned processes

Only processes explicitly registered as DevKit-managed services may be started, stopped, restarted, or terminated by Runtime. Runtime owns their PID/process-tree lifecycle and cleanup.

### 2.2 Connected external services

Existing applications such as LocalMCP, LocalMCP Tunnel Edition, Chat2Agent, Karakeep, and Obsidian remain independent products.

- DevKit may inspect their status through documented CLI, HTTP, file, or adapter interfaces.
- DevKit may invoke their supported start/stop commands only when the user explicitly requests the operation and the integration advertises that capability.
- DevKit must not claim Runtime ownership of an external process it did not launch and track.
- A service with no safe stop contract must be shown as start-only or externally controlled, with an explicit stop hint.
- DevKit must not auto-start external services on application launch.

### 2.3 MCP servers

The MCP Hub manages connection configuration and connection lifecycle. Stage 2 discovers server metadata and lists advertised tools.

Actual tool invocation, agent autonomy, permission grants, and multi-step orchestration are deferred until a separate trust/consent model is approved. A Registry listing is untrusted metadata, not authorization to execute a package.

## 3. MVP scope

### 3.1 Workspace shell and Dashboard

- Stable navigation for Home, Services, MCP Library, Storage, and Settings.
- Home summarizes live Runtime service, local integration, MCP connection, and Storage source state.
- Loading, empty, unavailable, error, and connected states are explicit.
- Navigation and core interactions remain responsive while service queries run.

### 3.2 Services and external integrations

- Runtime Services manages only DevKit-registered processes.
- MCP & Integrations exposes LocalMCP, LocalMCP Tunnel Edition, Chat2Agent, and MCP connections as connected external systems with their own lifecycle boundaries.
- UI labels and available controls must reflect actual ownership and capabilities.
- LocalMCP Tunnel remains start-only from DevKit; the user stops it from its visible PowerShell session with Ctrl+C.
- No external integration starts automatically on DevKit launch.
- Service operations use bounded execution, safe argument/path handling, and explicit timeouts.
- DevKit never kills a PID merely because a status probe reported it; stop operations use the integration's documented control interface or a Runtime-owned process handle.

### 3.3 MCP Hub and Registry

- Search and inspect official MCP Registry metadata with pagination.
- Permit manual configuration for stdio and Streamable HTTP transports.
- Persist connection metadata separately from secrets.
- Encrypt environment values, headers, sensitive endpoint data, and local command arguments through the main-process OS secret-protection adapter.
- If OS-backed encryption is unavailable, fail closed and do not persist credentials in plaintext.
- Require explicit user confirmation before first execution of a Registry package or manually configured local executable, enforced in the main process.
- Validate package references, transport configuration, environment keys, headers, working directory, and endpoint URLs in the main process.
- Remote HTTP endpoints must use HTTPS; plain HTTP is allowed only for loopback. Reject URL credentials, query strings, fragments, and redirects.
- Connect, list tools, disconnect, remove, and recover persisted connection metadata.
- Redact secrets from logs and surfaced errors.
- Do not expose decrypted credentials to the renderer.
- Tool invocation remains outside this stage until a separate authorization model is approved.

### 3.4 Vault and Storage foundations

- MCP credential encryption is isolated behind `OsSecretStore`, a main-process adapter over Electron `safeStorage`.
- `OsSecretStore` fails closed if OS-backed encryption is unavailable and validates encrypted payloads.
- **Important boundary:** `OsSecretStore` is not the full product Vault. It does not implement an independent Locked/Unlocked state, master-key hierarchy, unlock UX, recovery, backup, or cross-device migration. The provider direction is now recorded in [ADR-013](ARCHITECTURE_DECISIONS.md#adr-013--vault-uses-pluggable-secret-providers-no-provider-is-mandatory): Local encrypted storage, optional KeePassXC references, and ephemeral Manual credentials. The provider registry/resolver and end-to-end provider flows remain future implementation work.
- Define a Storage provider contract with explicit health and capabilities: list, search, metadata, read, write, delete, and sync.
- Implement a first real **Local Folder** provider, usable for a user-selected local folder or an Obsidian vault directory.
- The provider is read-only: it lists directories, searches names, and returns metadata; it does not read file contents or modify files.
- Listing returns at most 100 entries and scans at most 2,500 directory entries; search is bounded by 2,500 visited entries, depth 6, and at most 100 results. Both operations stream directory entries instead of materializing an unbounded directory listing.
- Hidden entries and known internal directories (`.obsidian`, `.git`, `.trash`, `node_modules`, `.devkit`) are excluded from browsing/search.
- The selected root is persisted under the DevKit workspace config boundary. Disconnect removes only the stored reference, never source data.
- Reject symlink roots and symlink traversal. Reject absolute paths, traversal segments, and non-regular metadata targets.
- Write, delete, bulk mutation, content reads, and synchronization are not exposed.
- Karakeep and Obsidian-specific APIs, content indexing, and richer workflows remain follow-on adapters; connecting a vault directory is not equivalent to a complete Obsidian integration.

### 3.5 Persistence

- Persist workspace selection, integration configuration, MCP connection metadata, and Storage source references under the DevKit-owned workspace/config boundary.
- Use atomic writes and reject symlink/non-regular-file destinations.
- Keep secrets encrypted and redact them from diagnostics.
- Version persisted schemas and provide a safe migration path before changing schema versions.
- Do not migrate, overwrite, or delete existing user data without explicit authorization.

## 4. Current implementation baseline

The current uncommitted WIP on `feat/unified-workspace-mvp` contains:

- MCP Hub manager and official Registry client.
- Saved stdio and Streamable HTTP connections.
- `OsSecretStore` adapter over Electron `safeStorage`; no plaintext fallback.
- Single-flight connection attempts, bounded connect/tool-discovery timeouts, pending-connection tracking, and shutdown cleanup.
- Main-process native trust confirmation before a saved MCP connection is launched or contacted.
- Local integration status/control adapters for LocalMCP, LocalMCP Tunnel Edition, and Chat2Agent.
- Home workspace overview for Runtime services, local integrations, MCP connections, and Storage.
- Storage provider contract in `src/shared/storage.ts`.
- Local Folder Storage provider, main-process IPC, preload API, persisted source reference, read-only browsing/search/metadata UI, and focused tests.
- Development and packaged E2E coverage for the complete MCP stdio lifecycle: add, native trust confirmation, connect, discover a tool, disconnect, and remove.
- MCP Library, Services, Storage renderer surfaces, IPC/preload contracts, documentation, and focused tests.

### Validation evidence — Windows 11 x64

- `npm run check`: **448/448 tests**, 43 test files; ESLint and TypeScript passed without warnings or errors.
- `npm run build`: passed, including Windows native lifecycle stress, fault-injection, packaged-ASAR provider, and crash-containment checks.
- Development Electron E2E: **3/3**, including Storage navigation and a real stdio MCP lifecycle through the main-process trust gate.
- `npm run dist`: passed; Windows x64 NSIS installer generated for version 1.0.4.
- `npm run validate:asar`: passed; **7,085 files** and all required entry points/native resources verified.
- Packaged Electron E2E: **5/5** against the unpacked app, including the MCP stdio lifecycle.
- Isolated NSIS install: exit code **0**; packaged Electron E2E **5/5** against the installed executable; uninstaller exit code **0**; temporary installation directory removed.
- Installer remains unsigned because no signing certificate is configured on the validation host.

These checks establish a materially stronger Stage 2 baseline, not full Stage 2 acceptance or broad production readiness.

## 5. Lifecycle hardening and current review status

- Connection attempts are single-flight per connection ID.
- In-flight connections are tracked; `closeAll()` marks the hub as shutting down, cancels pending clients, waits for bounded cleanup, and then closes active sessions.
- MCP connect and tool-discovery handshakes have explicit timeouts.
- Disconnect and remove operations account for pending sessions and cannot remove a connection while it is connecting.
- A native main-process confirmation dialog is required before a local executable/package is launched or a remote MCP endpoint is contacted.
- LocalMCP Tunnel is correctly advertised as start-only.
- Storage rejects path traversal and symlink traversal, limits directory/search work, and exposes no write/delete/content-read methods.
- OS secret protection is isolated from the MCP Hub, while the complete Vault lifecycle remains explicitly unresolved.

Remaining review before Stage 2 acceptance:

- Complete a focused race review for disconnect/remove and forced application shutdown; add proof that no MCP child process is orphaned.
- Validate LocalMCP/Chat2Agent scripts against the actual configured Projects root; mocked adapter tests do not establish that external installations are available or compatible.
- Decide whether Stage 2 requires a real Karakeep or Obsidian adapter, or whether the Local Folder provider is sufficient for the Storage foundation milestone.
- Complete the Services/ownership UX review and verify bounded status queries under failure.
- Implement the documented Secret Provider registry/resolver and provider-specific flows when the Vault vertical slice is scheduled; keep KeePassXC optional and Manual ephemeral. Do not duplicate or mutate the user's existing KeePassXC database/configuration.
- Conduct one comprehensive Stage 2 audit after the remaining planned task chain.

The current WIP is still not a completed or accepted Stage 2.

## 6. Security and reliability requirements

- All privileged actions are validated again in the main process.
- Renderer IPC handlers use the trusted-runtime IPC boundary.
- No arbitrary shell command construction from renderer input.
- Stdio execution uses argument arrays and `shell: false`, except for the narrowly validated Registry `npx` launch path on Windows.
- Registry metadata is untrusted input; package references must pass a strict grammar before execution.
- Remote endpoints reject insecure transport, redirects, embedded credentials, query strings, and fragments.
- Secrets are encrypted at rest, redacted from logs, and never returned to renderer.
- Every subprocess/transport has a bounded startup/operation timeout and cleanup path.
- Shutdown waits for or cancels pending MCP connection attempts before exiting.
- No external integration starts automatically on DevKit launch.
- Storage paths remain within the user-selected root and are not followed through symlinks.
- Existing services, files, and settings are preserved unless migration is explicitly requested.

## 7. Acceptance criteria

Stage 2 is complete only when all criteria below are met.

### Workspace and Services

- [x] Dashboard shows live Runtime, local integration, MCP, and Storage source state.
- [ ] Services and MCP & Integrations clearly distinguish DevKit-managed services from connected external services in all relevant workflows.
- [ ] Status, start, and stop behavior is correct for every advertised action, including failure and unavailable states.
- [x] Start-only integrations clearly explain how the user controls/stops them externally.
- [x] No service starts automatically on DevKit launch.
- [ ] Service queries are bounded and the UI remains responsive during failures/timeouts.

### MCP

- [ ] Registry search, pagination, server details, and error states are fully covered by acceptance tests.
- [x] Manual stdio and Streamable HTTP configurations are validated in main.
- [x] First execution requires explicit native trust confirmation.
- [x] Secrets are encrypted and never exposed to renderer or logs.
- [x] Reopening DevKit restores connection metadata without auto-connecting.
- [x] Connect is single-flight per connection ID.
- [x] Failed or timed-out handshakes clean up child processes/transports.
- [x] Shutdown handles pending and active connections deterministically.
- [x] Disconnect/remove and shutdown races are covered by explicit no-orphan process tests.
- [x] Tool discovery is accurate; tool invocation remains out of scope until its separate authorization model is approved.
- [x] Development and packaged E2E complete add → trust confirmation → connect → list tools → disconnect → remove for a real local stdio fixture.

### Vault and Storage

- [x] MCP OS-backed secret-protection adapter fails closed if encryption is unavailable.
- [x] Storage provider contract exposes explicit capabilities.
- [x] Storage provider exposes health and explicit read/write/delete/sync capabilities.
- [x] Local Folder provider validates bounded listing/search/metadata operations.
- [x] Write/delete/sync and file-content reads are unavailable.
- [x] Vault provider direction is documented: Local, optional KeePassXC, and ephemeral Manual; secret references are separate from values.
- [ ] Full product Vault provider registry/resolver, Locked/Unlocked lifecycle, key hierarchy, recovery, and provider end-to-end flows are implemented.
- [ ] Karakeep or Obsidian-specific adapter is selected and separately reviewed if required for Stage 2.

### Quality and delivery

- [x] Unit, integration, and TypeScript checks pass (448 tests / 43 files).
- [x] Development Electron E2E covers the MCP primary connection lifecycle and Storage navigation (3/3).
- [x] Packaged Electron E2E covers the MCP primary connection lifecycle and Storage navigation (5/5), including isolated NSIS installation.
- [x] Storage tests cover path traversal, symlink handling, persistence, unavailable roots, bounded search/listing, and read-only capabilities.
- [x] Secret-store tests cover encryption, decryption, invalid payloads, and fail-closed behavior.
- [x] Disconnect and application shutdown tests prove MCP child processes exit after cancellation/cleanup.
- [ ] One comprehensive Stage 2 security, architecture, and UX audit is completed after the task chain.
- [x] Stage 2 implementation and validation documentation updated on the feature branch.
- [ ] Final integration into `main` is authorized and completed.

## 8. Explicitly out of scope

- Autonomous AI agents and automatic tool execution.
- Marketplace-style one-click installation of arbitrary third-party software.
- Remote team collaboration, roles, and shared policies.
- Multi-platform release support before Windows production gates are satisfied.
- Broad two-way synchronization or destructive Storage operations.
- Replacing LocalMCP, Chat2Agent, Karakeep, Obsidian, or other specialist applications.
- Claiming the OS secret-protection adapter is the complete product Vault.

## 9. Delivery workflow

1. Validate the restored WIP against the current Runtime baseline.
2. Complete the workspace shell, Services/Integrations ownership behavior, and bounded status workflows.
3. Complete MCP discovery/configuration/connection lifecycle and packaged acceptance.
4. Add the bounded OS secret-protection and Storage provider slices.
5. Close disconnect/remove/forced-shutdown race coverage.
6. Decide the minimum real knowledge-store adapter needed for Stage 2.
7. Conduct one stage-level security, architecture, and UX audit.
8. Fix actionable findings, rerun acceptance checks, update docs, and integrate Stage 2.

Do not expand scope before the first coherent workflow is reliable.
