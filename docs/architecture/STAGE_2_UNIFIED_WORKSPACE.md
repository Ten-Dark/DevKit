# Stage 2 — Unified Workspace MVP

**Status:** Implementation and technical acceptance complete on Windows 11 x64. Workspace shell, MCP vertical slice, OS secret-protection adapter, Local/Obsidian Storage foundations, Multi-AI Aggregator launch integration, MCPWorkers authenticated API v1 integration and Manager Runtime supervisor are implemented. Live KeePassXC-backed Karakeep credential resolution is verified through the restricted connection-only workflow; no bookmark content was accessed. Live scoped-token authentication, API v1 Definition/Instance discovery, owned Manager lifecycle and the NSIS-installed existing-data-root workflow are verified. Direct LocalMCP/Tunnel lifecycle controls have been retired; MCPWorkers is the sole Worker management path. Final Stage 2 audit is complete. Integrated into `main` on 2026-11-28 via fast-forward from `feat/unified-workspace-mvp`.
**Target platform:** Windows 11 x64\\
**Branch:** `feat/unified-workspace-mvp`\\
**Baseline:** `main` after Runtime PR #13\\
**Latest recorded validation:** 2026-11-28 — `npm run check` passed: **549/549 tests across 54 files**, TypeScript clean and ESLint clean. `npm run build` passed, including Windows native process-control integration, fault-injection and packaged-ASAR provider tests. Development Electron E2E passed **4/4**; packaged Electron E2E passed **6/6**, including managed MCP stdio lifecycle and crash containment. Development and packaged MCPWorkers sidecar lifecycle tests passed against isolated temporary data roots, including API v1 readiness and graceful named-pipe shutdown. The NSIS-installed Dev Toolbox 1.0.4 acceptance passed **1/1**: a persisted existing data-root selection was loaded, the installed app started and owned the Manager, API readiness and Services UI were verified, and closing DevKit gracefully shut down only its owned Manager. Installer and uninstaller ran in an isolated temporary directory. Live KeePassXC-backed Karakeep credential resolution returned `connected` without reading bookmark content. Live MCPWorkers acceptance verified scoped-token resolution, authenticated API v1 access, Definition/Instance discovery (3/3), owned Manager lifecycle, and external Manager attach without stopping the external process.

This document defines the Stage 2 delivery boundary and acceptance criteria. It is subordinate to [ROADMAP.md](../ROADMAP.md), [PRODUCT_VISION.md](../PRODUCT_VISION.md), and the architecture contracts.

## 1. Outcome

Deliver the first coherent DevKit workspace experience that connects the accepted Runtime foundation to real services and integrations. The workspace is the single entry point: DevKit Runtime owns the lifecycle of DevKit-managed components, while external systems retain their own ownership boundaries.

The MVP must let a developer:

1. Open one workspace shell and see useful, real workspace/service state.
2. Discover and manage selected existing local services without silently taking ownership of them.
3. Discover MCP servers, configure connections, connect/disconnect, and inspect the tools exposed by a server.
4. Persist non-secret configuration and protect credentials using OS-backed storage.
5. Browse selected local knowledge sources; verify Karakeep connection/authentication status only, without accessing bookmark content.
6. Establish explicit Vault and Storage boundaries without pretending that the complete product Vault already exists.

This is a vertical slice, not a general-purpose service marketplace or AI agent platform.

## 2. Boundaries and ownership

### 2.1 Runtime-owned processes

Only processes explicitly registered as DevKit-managed services may be started, stopped, restarted, or terminated by Runtime. Runtime owns their PID/process-tree lifecycle and cleanup.

### 2.2 Connected external services

MCPWorkers is the single management integration for LocalMCP and LocalMCP-Tunnel. Those worker applications remain independent products; DevKit manages them through MCPWorkers Public API v1. Multi-AI Aggregator, Karakeep and Obsidian remain separate integrations.

- DevKit must use the documented MCPWorkers API v1 for worker definitions, instances, health and lifecycle. It must not read or mutate Manager Registry files, worker configuration files, package directories or worker processes directly.
- MCPWorkers API calls originate from DevKit's trusted Electron Main Process; the renderer receives only sanitized status and metadata. Authentication uses a separately revocable scoped client token provisioned by MCPWorkers into KeePassXC. DevKit persists only an OS-encrypted KeePassXC reference and keeps the resolved token in Main Process memory while unlocked. The master password is requested through a separate PowerShell secure-string prompt and never enters Renderer state or preload IPC. Private DPAPI token-file parsing is prohibited.
- MCPWorkers remains authoritative for worker process ownership, Registry state and lifecycle. DevKit requests supported operations through API v1 and must not claim Runtime ownership of worker processes.
- A service with no safe stop contract must be shown as start-only or externally controlled, with an explicit stop hint.
- Multi-AI Aggregator is launch-only: DevKit opens the selected executable and never force-terminates the application.
- Direct LocalMCP and LocalMCP-Tunnel lifecycle adapters have been retired after MCPWorkers acceptance. All Worker Instance discovery, health and lifecycle actions use MCPWorkers Public API v1; the external Tunnel runtime remains externally owned and is never stopped by DevKit. DevKit Runtime starts/attaches the MCPWorkers Manager according to ownership rules. Starting the Manager must not auto-start Worker Instances. Unrelated connected services and launch-only desktop applications remain opt-in.

See [MCPWORKERS_INTEGRATION.md](MCPWORKERS_INTEGRATION.md) for the full integration contract and acceptance sequence.

### 2.3 MCP servers

The MCP Hub manages connection configuration and connection lifecycle. Stage 2 discovers server metadata and lists advertised tools.

Actual tool invocation, agent autonomy, permission grants, and multi-step orchestration are deferred until a separate trust/consent model is approved. A Registry listing is untrusted metadata, not authorization to execute a package.

## 3. MVP scope

### 3.1 Workspace shell and Dashboard

- Stable navigation for Home, Services, MCP Library, Storage, and Settings.
- Home summarizes live Runtime service, MCPWorkers Manager API liveness, MCP connection, and Storage source state. The Services page displays authenticated Definition/Instance summaries when the client is unlocked.
- Loading, empty, unavailable, error, and connected states are explicit.
- Navigation and core interactions remain responsive while service queries run.
- Karakeep status probes use a short bounded timeout so an unavailable remote source does not stall the workspace indefinitely.

### 3.2 Services and external integrations

- Runtime Services manages only DevKit-registered processes.
- Services contains the authenticated MCPWorkers API v1 connection and Worker Instance panel. The MCP & Integrations page no longer exposes direct LocalMCP or LocalMCP-Tunnel lifecycle controls; MCPWorkers is the sole Worker management path. Multi-AI Aggregator remains a separate launch-only integration; MCP connections retain their independent lifecycle.
- UI labels and available controls must reflect actual ownership and capabilities.
- Worker start/stop/restart actions are sent only through MCPWorkers API v1 after explicit user action; the Manager's observed result is authoritative.
- Multi-AI Aggregator requires explicit executable selection, validates the selected regular file, detects the process by exact executable path, and launches detached. DevKit does not provide a force-stop action.
- Authenticated MCPWorkers calls use the scoped KeePassXC client-token contract. Do not read the private DPAPI token file or expose the token to renderer/logs.
- Package installation/activation, config editing, credential-reference management, activation recovery and failover remain MCPWorkers-owned and are deferred from the first DevKit integration slice.
- MCPWorkers Manager is started/attached through the DevKit workspace lifecycle according to ownership rules; all other external integrations remain opt-in unless a future explicit managed-component policy is approved.
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
- On Windows, stdio connections use ManagedStdioClientTransport: a trusted bootstrap waits on a per-connection named-pipe handshake, the native provider verifies and attaches that direct child to a kill-on-close Job Object, and only then is the configured command launched. All command-wrapper and MCP-server descendants inherit the Job Object.
- Connect, list tools, disconnect, remove, and recover persisted connection metadata.
- Redact secrets from logs and surfaced errors.
- Do not expose decrypted credentials to the renderer.
- Tool invocation remains outside this stage until a separate authorization model is approved.

### 3.4 Vault and Storage foundations

#### OS secret-protection adapter

- MCP and Karakeep credentials use `OsSecretStore`, a main-process adapter over Electron `safeStorage`.
- It fails closed if OS-backed encryption is unavailable and validates encrypted payloads.
- **Important boundary:** `OsSecretStore` is not the full product Vault. It does not implement an independent Locked/Unlocked state, master-key hierarchy, unlock UX, recovery, backup, or cross-device migration. Those remain open architecture work.

#### Local Folder and Obsidian

- The **Local Folder** provider supports a user-selected directory. It lists directories, searches names, and returns metadata only; it does not read file contents or modify files.
- A selected folder is recognized as an **Obsidian Vault** only when its actual `.obsidian` directory is present.
- Obsidian mode exposes read-only Markdown previews for `.md` files up to 256 KiB.
- Hidden entries and known internal directories (`.obsidian`, `.git`, `.trash`, `node_modules`, `.devkit`) are excluded from browsing/search.
- Listing returns at most 100 entries and scans at most 2,500 directory entries. Search is bounded by 2,500 visited entries, depth 6, and at most 100 results.
- The selected root is persisted under the DevKit workspace config boundary. Disconnect removes only the stored reference, never source data.
- Reject symlink roots and symlink traversal. Reject absolute paths, traversal segments, and non-regular metadata targets. Obsidian note reads revalidate the opened file and enforce the size cap.
- Write, delete, bulk mutation, and synchronization are not exposed.

#### Karakeep

- The accepted integration is connection/authentication status only. DevKit calls only the identity/status endpoint needed to verify the API key; bookmark listing, pagination, search and content preview are prohibited in the current workflow.
- The API key is resolved through the user's existing KeePassXC secret reference in the main process. The master password is requested through the separate secure PowerShell prompt; it never enters Renderer state or preload IPC. The raw key is never returned to the renderer, persisted in plaintext or copied into a competing credential store.
- HTTPS is required for remote hosts. Plain HTTP is permitted only for loopback. Redirects are rejected.
- Connection/status probes are bounded to 2.5 seconds. No bookmark API operation is exposed to the renderer or invoked by startup, connect or refresh.
- The adapter may retain internal bookmark methods for compatibility only if they are unreachable from the accepted UI workflow and covered by tests proving no calls occur.
- DevKit does not read, create, edit, archive, delete, index, download or synchronize Karakeep bookmark data. Disconnect removes only DevKit's stored connection reference.
- The user confirmed the connection status as `Connected`. Regression tests must prove that startup, connect and refresh do not call bookmark list/search/read methods.

### 3.5 Persistence

- Persist workspace selection, integration configuration, MCP connection metadata, Storage source references, and the selected Multi-AI Aggregator executable under the DevKit-owned workspace/config boundary.
- Use atomic writes and reject symlink/non-regular-file destinations.
- Keep secrets encrypted and redact them from diagnostics.
- Version persisted schemas and provide a safe migration path before changing schema versions.
- Do not migrate, overwrite, or delete existing user data without explicit authorization.

## 4. Current implementation baseline

The current WIP on `feat/unified-workspace-mvp` contains:

- MCP Hub manager and official Registry client.
- Saved stdio and Streamable HTTP connections.
- `OsSecretStore` adapter over Electron `safeStorage`; no plaintext fallback.
- Single-flight connection attempts, bounded connect/tool-discovery timeouts, pending-connection tracking, and shutdown cleanup.
- Main-process native trust confirmation before a saved MCP connection is launched or a remote endpoint is contacted.
- Direct LocalMCP/Tunnel status and lifecycle adapters have been retired from the MCP & Integrations workflow; Worker management is routed exclusively through MCPWorkers API v1.
- Multi-AI Aggregator adapter with native executable selection, path validation, process detection, launch-only behavior, and no force-stop.
- Home workspace overview for Runtime services, MCPWorkers Manager API liveness, MCP connections, and Storage sources; Services contains authenticated Definition/Instance summaries and explicit lifecycle controls.
- Storage provider contract for local/Obsidian sources in `src/shared/storage.ts`.
- Local Folder and Obsidian Vault adapters, main-process IPC, preload API, persisted source reference, bounded browsing/search/Markdown preview, and focused tests.
- Karakeep connection-only adapter using the KeePassXC secret reference, with bounded authentication/status verification and no bookmark access in the accepted workflow.
- MCP Library, Services, Storage renderer surfaces, IPC/preload contracts, documentation, and focused tests.
- Development and packaged E2E coverage for the complete MCP stdio lifecycle: add, native trust confirmation, connect, discover a tool, disconnect, and remove.

## 5. Validation evidence — Windows 11 x64

- `npm run check`: **549/549 tests**, 54 test files; TypeScript passed; ESLint reported 0 errors and 0 warnings (2026-11-28).
- `npm run lint`: passed with 0 warnings.
- `npm run build`: passed, including native attach-before-launch ownership checks, command-wrapper descendant containment, Windows lifecycle stress, fault-injection, packaged-ASAR provider, crash-containment checks, and MCPWorkers sidecar bundling.
- `npm run test:manager-sidecar`: passed against an isolated temporary data root; the Electron-hosted Manager started, exposed API v1 health, connected to the Runtime named pipe, and shut down gracefully.
- Development Electron E2E: **4/4** on 2026-11-27, including Storage navigation, Storage status IPC, and a real stdio MCP lifecycle through the main-process trust gate; the MCP fixture spawns a descendant and both command and descendant PIDs are confirmed exited after disconnect.
- `npm run dist:from-build`: passed on 2026-11-27; Windows x64 NSIS installer generated for version 1.0.4 in `dist/` (kept separate from the TypeScript/Vite `dist-electron/` input).
- `npm run validate:asar`: passed; **7,109 files** and all required entry points/native resources verified, including the Manager sidecar ESM bundle and its vendored `yauzl`, `pend`, and `buffer-crc32` dependencies.
- `npm run test:manager-sidecar:packaged`: passed against the unpacked packaged executable.
- Packaged Electron E2E: **6/6** against the unpacked app, including managed MCPWorkers Manager ownership, MCP stdio lifecycle and crash containment.
- Live external-Manager attach E2E: **1/1**; the Runtime Service Registry reports the external Manager as running while retaining `identityVerified: false` and `ownership: external`; the UI disables shutdown, and the Manager remained healthy after DevKit closed.
- NSIS-installed application E2E: installer and uninstaller exit code **0**; installed app loaded the persisted existing data-root selection, started and owned the Manager, passed API readiness and Services UI assertions, then gracefully shut down only its owned Manager. Full installed-app E2E passed **1/1**; temporary installation directory and data root were removed.
- Installer remains unsigned because no signing certificate is configured on the validation host.

A pre-MCPWorkers-liveness `npm run release:check` baseline also passed on 2026-11-27, including unit/integration checks, development E2E, native build tests, NSIS packaging, ASAR validation and packaged E2E; `npm audit --audit-level=moderate` reported 0 vulnerabilities. This is historical baseline evidence and is superseded for ordinary build/test/package-E2E status by the latest 549-test / 4-of-4 development E2E / 6-of-6 packaged E2E snapshot in the document header and acceptance section. It does not establish live Manager authentication or Runtime lifecycle acceptance. Isolated installed NSIS installation/uninstallation E2E remains prior evidence from 2026-11-24.

## 6. Lifecycle hardening and current review status

- Connection attempts are single-flight per connection ID.
- In-flight connections are tracked; `closeAll()` marks the hub as shutting down, cancels pending clients, waits for bounded cleanup, and then closes active sessions.
- MCP connect and tool-discovery handshakes have explicit timeouts.
- Disconnect and remove operations account for pending sessions and cannot remove a connection while it is connecting.
- A native main-process confirmation dialog is required before a local executable/package is launched or a remote MCP endpoint is contacted.
- The MCP & Integrations page exposes no direct LocalMCP/Tunnel lifecycle controls; Worker management is centralized through MCPWorkers.
- Multi-AI Aggregator is explicitly launch-only and is never force-terminated by DevKit.
- Storage rejects path traversal and symlink traversal, limits directory/search work, and exposes no write/delete methods.
- Obsidian content reads are restricted to Markdown files up to 256 KiB.
- Karakeep credentials resolve through the configured KeePassXC reference in the main process; the connection-only provider returned `connected`. Connection probes are bounded and bookmark operations are not invoked.
- OS secret protection is isolated from the MCP Hub and Karakeep adapter, while the complete Vault lifecycle remains explicitly unresolved.

Historical validation of transitional direct adapters (not the selected Stage 2 acceptance target):

- **LocalMCP:** the installed `%APPDATA%/npm/localmcp.cmd` lifecycle was exercised. Initial state was stopped; `start` succeeded and `status` reported running; `stop` succeeded and final `status` reported stopped. The initial state was restored.
- **LocalMCP Tunnel Edition:** the existing HTTP health endpoint at `127.0.0.1:8765/healthz` returned HTTP 200 and `tunnel-client` was present. DevKit status discovery recognized it as running. It was not stopped or restarted because this is an externally managed active session; DevKit correctly exposes no stop action.
- **Chat2Agent:** the service remains stopped. `node start-ngrok.mjs --preflight` and syntax checks for the start/status/stop/supervisor/inspection scripts passed. `service-status.mjs --json` returned `kind: stopped`; `stop-service.mjs` returns nonzero for an already-stopped service, so DevKit now treats that state as an idempotent no-op. The adapter parses `kind` and `managerOwned`, allowing shutdown of an unhealthy process only when ownership is confirmed. `start.bat` was not rerun because it creates a public ngrok tunnel; a previous attempt failed because the installed DevSpace package could not resolve `drizzle-orm/package.js`, so actual start remains unverified. This is historical evidence; Chat2Agent was retired from DevKit and removed from the local profile on 2026-11-28.
- **Karakeep connection status:** the user confirmed `Connected` using the restricted connection-only workflow. This closes the service connection-status check. DevKit must not list, search, preview, index, download or otherwise access bookmark content.
- **Karakeep credential provenance:** verified through the configured KeePassXC SecretProvider reference and connection-only provider path; `connectWithSecretReference` and `getStatus()` returned `connected`. No bookmark list/search/read/preview/download/index operations were invoked. Do not copy the LocalMCP-Tunnel credential into DevKit or expose secrets.
- Registry client/UI acceptance, service ownership labels, bounded status-query behavior, and renderer responsiveness checks are complete.

### Stage-level audit outcome — 2026-11-27

The 2026-11-27 Stage 2 audit was completed before the authenticated MCPWorkers client and Services UI were added. It covered Runtime/MCP process ownership, IPC/preload boundaries, local lifecycle adapters, OS-backed secret handling, Storage path and read-only boundaries, Karakeep connection handling, renderer UX/accessibility contracts, and packaged Windows behavior. It fixed Chat2Agent's already-stopped/degraded shutdown handling, rejected bookmark URLs containing embedded credentials, and corrected ToolCard's nested interactive semantics and fixed-height text overflow. At audit time, validation was 500/500 tests across 48 files; TypeScript and ESLint clean; native build passed; development E2E 3/3; ASAR validation passed (7,093 files); packaged E2E 5/5; `npm audit` and `npm audit --omit=dev` reported 0 vulnerabilities. No P0 DevKit defect was identified. This remains historical audit evidence; the final MCPWorkers lifecycle audit is recorded below. The Home layout preview confirmed the card overflow is resolved; a formal WCAG conformance audit was not performed.

## 7. Acceptance criteria

Stage 2 is complete only when all criteria below are met.

### Workspace and Services

- [x] Dashboard shows live Runtime, MCPWorkers Manager API liveness, MCP connection and Storage source state.
- [x] Services shows authenticated MCPWorkers Definition/Instance summaries after KeePassXC unlock; Home separately reports Manager/API liveness.
- [x] Services clearly labels Runtime-managed processes separately from MCPWorkers-managed Worker Instances; MCPWorkers is the sole LocalMCP/Tunnel Worker management path and no direct lifecycle controls remain.
- [x] MCPWorkers connection, per-Instance status/health and explicit lifecycle requests are wired through API v1 with bounded requests and sanitized auth/scope errors. HTTP 409 conflict handling is covered by unit tests; a live stale-state conflict fixture is deferred because the Manager exposes no deterministic fixture and is not a Stage 2 blocker.
- [x] MCPWorkers Manager and worker lifecycle operations are represented with clear ownership labels; the Manager is the sole authority for worker process operations.
- [x] Multi-AI Aggregator requires explicit executable selection and is launch-only.
- [x] A Runtime supervisor attaches to a compatible external Manager without claiming process ownership, or starts the configured Manager sidecar through Runtime ProcessManager; only a process launched by the current DevKit session is eligible for shutdown.
- [x] Expose Manager ownership/runtime state, existing data-root selection and explicit Connect/Launch / owned-only shutdown controls through the Services UI.
- [x] Starting the MCPWorkers Manager does not automatically start Worker Instances.
- [x] Other connected external services and launch-only desktop applications are not auto-started.
- [x] MCPWorkers API requests use bounded timeouts and async UI states; lifecycle operations use a longer explicit operation timeout.

### MCP

- [x] Registry search, cursor pagination, result metadata/details, and request errors are covered by client and renderer acceptance tests.
- [x] Manual stdio and Streamable HTTP configurations are validated in main.
- [x] First execution requires explicit native trust confirmation.
- [x] Secrets are encrypted and never exposed to renderer or logs.
- [x] Reopening DevKit restores connection metadata without auto-connecting.
- [x] Connect is single-flight per connection ID.
- [x] Failed or timed-out handshakes clean up child processes/transports.
- [x] Shutdown handles pending and active connections deterministically.
- [x] Pending-connect disconnect/remove and application shutdown verify that the direct stdio child exits.
- [x] Native Windows command-wrapper test verifies cmd.exe, its Node launcher and the Node server descendant all exit when the managed Job Object is terminated.
- [x] Tool discovery is accurate; tool invocation remains out of scope until its separate authorization model is approved.
- [x] Development and packaged E2E complete add → trust confirmation → connect → list tools → disconnect → remove for a real local stdio fixture that spawns a child process; both the configured server and its descendant are confirmed exited.

### MCPWorkers integration

- [x] Main-process MCPWorkers API v1 client implemented: loopback-only HTTP, bounded health/API/lifecycle timeouts, redirect rejection, response validation and sanitized errors.
- [x] Live-verify Manager liveness, KeePassXC scoped-token resolution and authenticated API v1 requests; Definition/Instance discovery returned 3/3. Lifecycle conflict responses are sanitized and covered by unit tests; a live stale-state conflict scenario remains a follow-up only if the Manager can provide a deterministic fixture.
- [x] Implement the Manager Runtime supervisor, external attach path, sidecar launch through Electron's embedded Node runtime and per-session graceful-shutdown channel.
- [x] Live-verify Manager API readiness and owned-process graceful shutdown using an isolated Manager instance through the DevKit Runtime; ProcessManager ownership was confirmed and the process exited cleanly after the named-pipe shutdown.
- [x] Verify the full DevKit Runtime-managed startup/attach/shutdown workflow in an NSIS-installed app with a persisted user-selected existing data root. Installed-app E2E passed 1/1 on 2026-11-28 using an isolated existing MCPWorkers data root; ownership, API readiness, Services UI and graceful owned-only shutdown were verified.
- [x] Verify external Manager attach and confirm DevKit never stops it: packaged E2E reports `ownership: external`, the shutdown action is disabled, and the live Manager remains healthy after DevKit closes.
- [x] Use MCPWorkers' separately revocable scoped client-token provisioning into KeePassXC; no private DPAPI token-file parsing.
- [x] Resolve KeePassXC client token in Electron Main Process only; persist only the OS-encrypted reference and keep the token out of renderer, logs and command-line arguments.
- [x] List Worker Definitions and Instances through authenticated API v1 without accessing Registry files.
- [x] Show per-Instance runtime state, health state, enabled state, role, priority and verified capabilities.
- [x] Support explicit on-demand health checks.
- [x] Route explicit start/stop/restart requests only through API v1 with confirmation and Manager-authoritative results; HTTP 409 lifecycle conflicts return a sanitized message and are covered by unit tests.
- [x] Register MCPWorkers Manager in the Runtime Service Registry through a dedicated adapter; Runtime start/stop delegates to the existing ProcessManager-backed supervisor.
- [x] Runtime supervisor implements owned-only Manager lifecycle: it attaches to a healthy external Manager without ownership, and only shuts down a Manager launched by the current DevKit session. Isolated live DevKit Runtime acceptance passed: ownership was verified, graceful named-pipe shutdown completed, and the Manager process exited cleanly.
- [x] Worker Instance lifecycle remains explicit and is routed only through MCPWorkers API v1; Manager startup does not start all workers.
- [x] Keep package installation/activation, configuration editing, credential management, recovery and failover under MCPWorkers ownership.

### Vault and Storage

- [x] MCP OS-backed secret-protection adapter fails closed if encryption is unavailable.
- [x] Storage provider contract exposes explicit capabilities.
- [x] Local Folder provider validates bounded listing/search/metadata operations.
- [x] Obsidian vault detection and bounded Markdown preview are implemented; general Local Folder remains metadata-only.
- [x] Karakeep connection-only status is confirmed by the user as `Connected`.
- [x] Route KeePassXC master-password entry through the separate secure PowerShell prompt in Main Process; Renderer sends only the Karakeep URL and secret reference.
- [x] Verify the intended KeePassXC-backed Karakeep credential resolution end-to-end: the configured KeePassXC reference resolves and the connection-only provider reports `connected`; bookmark content remains untouched.
- [x] The accepted Karakeep scope is connection-only; bookmark listing, search, preview, indexing and downloads are not used by DevKit.
- [x] Full product Vault unlock, key hierarchy, recovery, and provider registry/resolver are explicitly outside Stage 2; the OS-backed secret-protection boundary is documented and must not be represented as a complete Vault.


### Quality and delivery

- [x] Unit, integration, lint and TypeScript checks pass (549 tests / 54 files on 2026-11-28; 0 ESLint warnings).
- [x] Development Electron E2E covers the managed MCP stdio lifecycle, descendant cleanup and Storage navigation (4/4 on 2026-11-28).
- [x] Final packaged Electron E2E after MCPWorkers lifecycle integration and direct-adapter retirement (6/6 on 2026-11-28).
- [x] MCPWorkers Manager sidecar lifecycle smoke tests pass in development and unpacked packaged app using isolated temporary data roots; each verifies API v1 readiness and graceful named-pipe shutdown. Full NSIS-installed Runtime lifecycle with a persisted existing data root also passes (1/1).
- [x] Live external Manager attach E2E passes (1/1): Runtime Service Registry shows the external service as running without ownership, UI shutdown is disabled, and the external Manager remains healthy after DevKit closes.
- [x] Isolated NSIS installation and full installed-app Runtime E2E verified on 2026-11-28: installer/uninstaller exit codes 0, installed app lifecycle E2E 1/1, and temporary installation directory removed.
- [x] Storage tests cover path traversal, symlink handling, persistence, unavailable roots, bounded search/listing, Obsidian Markdown reads, and read-only capabilities.
- [x] Karakeep connection-only regression tests prove that startup/connect/refresh do not invoke bookmark list/search/read methods (10/10 Storage UI tests pass).
- [x] Multi-AI Aggregator tests cover executable validation, persisted selection, process detection, launch-only behavior, and no force-stop.
- [x] Secret-store tests cover encryption, decryption, invalid payloads, and fail-closed behavior.
- [x] MCP disconnect, timeout, pending-connect cancellation, and shutdown cleanup are covered by focused tests and the real stdio E2E lifecycle.
- [x] Direct stdio child no-orphan coverage passes for pending cancellation and shutdown.
- [x] Native Windows Job Object regression verifies command-wrapper descendant cleanup (cmd.exe → batch wrapper → Node launcher → Node server); this exercises the Windows process topology used by npm/npx .cmd launchers.
- [x] ManagedStdioClientTransport attaches its trusted bootstrap to a native Job Object before it launches the configured MCP command; native attachment rejects non-child PIDs.
- [x] Initial Stage 2 security, architecture, and UX audit completed on 2026-11-27 before MCPWorkers Manager lifecycle integration; scope and findings are recorded in section 6.
- [x] Stage 2 implementation and validation documentation updated on the feature branch.
- [x] Final post-MCPWorkers-lifecycle validation and pre-integration audit completed on 2026-11-28; findings and evidence are recorded in the final audit section below.
- [x] Final integration into `main` was authorized and completed on 2026-11-28 via fast-forward.

### Final Stage 2 audit outcome — 2026-11-28

The final review was performed after MCPWorkers Manager lifecycle integration, NSIS-installed Runtime acceptance, and retirement of the transitional direct LocalMCP/Tunnel lifecycle controls.

**Scope reviewed**

- Runtime ownership and shutdown rules for DevKit-managed versus externally managed MCPWorkers Manager processes.
- MCPWorkers API v1 authentication, scoped-token handling, Definition/Instance discovery, health and explicit lifecycle requests.
- Persisted existing data-root selection and installed-app startup/readiness/shutdown.
- External Manager attach behavior and protection of the independently running LocalMCP Tunnel runtime.
- Main/renderer IPC boundary, direct integration lifecycle controls, and Services/MCP UI ownership messaging.
- NSIS packaging, ASAR contents, native Windows process control, and relevant unit/integration/E2E coverage.
- Stage 2 delivery documentation and roadmap consistency.

**Findings and disposition**

- No P0 or P1 defects were identified in the reviewed Stage 2 scope.
- The separate direct LocalMCP/Tunnel controls duplicated MCPWorkers' Worker lifecycle authority and could create conflicting status/actions. They have been retired; MCPWorkers API v1 is now the sole Worker management path.
- Packaged E2E processes now use an isolated DEVKIT_USER_DATA_DIR, preventing a running user DevKit instance from colliding with the test instance's single-instance lock or persistent configuration.
- The installed-app acceptance now verifies the persisted existing data-root selection, Manager ownership, API readiness, Services UI state, and graceful shutdown of only the Manager launched by that installed DevKit instance.
- External Manager attach remains non-owning. DevKit does not stop it. The external Tunnel runtime on port 8765 remains independent and was not restarted or terminated.
- A live stale-state HTTP 409 conflict scenario remains deferred because the Manager does not expose a deterministic fixture; response sanitization and conflict handling are covered by unit tests. This is not a Stage 2 blocker.

**Final validation evidence**

- npm run check: 549/549 tests across 54 files; TypeScript and ESLint clean.
- npm run build: passed, including Windows native process-control and fault-injection suites.
- Development Electron E2E: 4/4.
- Packaged Electron E2E: 6/6.
- NSIS-installed Runtime E2E: 1/1.
- Development and packaged MCPWorkers sidecar lifecycle tests: passed.
- npm run validate:asar: passed, 7,109 files.
- npm audit --audit-level=moderate: 0 vulnerabilities.
- git diff --check: passed.
- Manager API v1 health and external Tunnel /healthz were rechecked after validation; both returned healthy. The Manager was restored to its prior running state. The Tunnel remained on its original PID.

**Known non-blocking limitations**

- Windows 11 x64 is the only validated target for this stage; Linux/macOS require separate platform adapters and packaged acceptance.
- The NSIS installer is unsigned because no signing certificate is configured on the validation host.
- A formal WCAG conformance audit was not performed.
- The full product Vault lifecycle, autonomous agents, tool invocation and team workflows remain outside Stage 2.

**Audit result:** Stage 2 implementation and technical acceptance criteria are satisfied. Stage 2 was integrated into `main` on 2026-11-28 via fast-forward; no merge commit was required.

## 8. Explicitly out of scope

- Autonomous AI agents and automatic tool execution.
- Marketplace-style one-click installation of arbitrary third-party software.
- Remote team collaboration, roles, and shared policies.
- Multi-platform release support before Windows production gates are satisfied.
- Two-way Karakeep synchronization, Obsidian plugin workflows, content indexing, attachment downloads, and destructive Storage operations.
- Replacing LocalMCP, Karakeep, Obsidian, or other specialist applications.
- Additional SecretProvider adapters, Manual ephemeral secret entry, provider-wide configuration UX, and a complete product Vault lifecycle.
- Additional credential providers beyond the verified KeePassXC reference/SecretProvider path, or any credential flow that would require reading unrelated entries or duplicating secrets.
- Claiming the OS secret-protection adapter is the complete product Vault.

## 9. Delivery workflow

1. Validate the restored WIP against the current Runtime baseline.
2. Complete the workspace shell, Services/Integrations ownership behavior, and bounded status workflows.
3. Complete MCP discovery/configuration/connection lifecycle and packaged acceptance.
4. Complete the OS secret-protection adapter, Local/Obsidian provider, and Karakeep connection-only authentication workflow.
5. [x] Close disconnect/remove/forced-shutdown race coverage and verify Windows process-tree cleanup for nested MCP launch processes.
6. [x] Complete live, packaged and NSIS-installed acceptance of the MCPWorkers Public API v1 integration using a persisted existing data root; preserve Karakeep as connection/authentication-only.
7. [x] Conduct one stage-level security, architecture, and UX audit (2026-11-27).
8. Fix actionable findings, rerun acceptance checks, update docs, and integrate Stage 2.

Do not expand scope before the first coherent workflow is reliable.
