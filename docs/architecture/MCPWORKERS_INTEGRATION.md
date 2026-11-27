# MCPWorkers Integration — DevKit Stage 2

**Status:** The authenticated API v1 client, KeePassXC scoped-client-token resolution path, Definition/Instance discovery, on-demand health checks and explicit Worker Instance lifecycle controls are implemented. The Runtime supervisor uses the existing Runtime `ProcessManager` to attach to a healthy external Manager or launch a configured sidecar, waits for API and shutdown-pipe readiness, and requests graceful shutdown only for a process launched by this DevKit session. The Manager sidecar is bundled with the Electron-hosted Node runtime; no global Node installation is needed at app runtime. External-Manager attach E2E and development/packaged/NSIS-installed sidecar smoke tests pass. Live scoped-token authentication, API v1 discovery and an isolated DevKit Runtime-owned Manager lifecycle have been verified. Still open: the full installed-app Runtime lifecycle using a selected existing data root, the final post-integration Stage 2 audit, and explicit integration approval. Runtime Service Registry registration and Services UI ownership/data-root controls are implemented.
**Target:** DevKit Stage 2 — Unified Workspace MVP.
**Related project:** `C:\Users\Sondr\Projects\MCPWorkers`
**Contract:** MCPWorkers Public API v1 and Worker Contract v1.
**Last source review:** 2026-11-28.

## 1. Decision

MCPWorkers is the single management integration for LocalMCP, LocalMCP-Tunnel and Chat2Agent Worker Instances. DevKit integrates as an independent API client; MCPWorkers remains independently usable and owns Worker Instance management. DevKit Runtime separately owns the lifecycle of the MCPWorkers Manager process only when DevKit launched it.

DevKit must not maintain three parallel direct lifecycle integrations as the long-term architecture.

## 2. Ownership boundary

- MCPWorkers owns Worker Definitions, Worker Instances, Registry persistence, package installations, worker configuration, worker lifecycle, health observations, activation journals and failover decisions.
- DevKit owns workspace UI, user-facing consent, connection diagnostics and presentation of sanitized API results.
- DevKit MUST use the documented versioned `/v1` API. It MUST NOT read or write MCPWorkers Registry files, edit worker installation/configuration files, or launch/terminate worker processes directly.
- Worker Instance lifecycle operations are explicit user actions through API v1. DevKit Runtime may start/attach the Manager as a workspace dependency, but Manager startup must not start Worker Instances. No automatic worker start, package activation, recovery, failover or lifecycle replay is introduced by DevKit.
- Existing LocalMCP, LocalMCP-Tunnel and Chat2Agent installations remain untouched during integration development. No live cutover or migration is implied.

## 3. API and security contract

- Default API endpoint: `http://127.0.0.1:43127`.
- `GET /v1/health` is the only unauthenticated liveness endpoint.
- Authenticated calls use a separately revocable scoped client token, not the Manager root token.
- Calls originate from DevKit's trusted Electron Main Process only.
- Manager rejects requests carrying `Origin` or `Cookie`; browser-originated requests are unsupported.
- The client token never enters Renderer state, preload return values, browser storage, logs, command-line arguments, worker configuration or diagnostics.
- DevKit does not read the private DPAPI token file or MCPWorkers Registry/auth files.
- API calls use loopback-only HTTP, reject redirects, use bounded timeouts, validate response shapes and sanitize errors.
- Manager/API liveness, authenticated client status and per-Instance health are separate states.

### 3.1 Client credential provisioning

MCPWorkers implements a named external client registry with hash-only token storage, route scopes and independent revocation. Provision the DevKit client from an interactive MCPWorkers Manager terminal:

```powershell
npm --prefix platform/worker-manager run start -- client create --id devkit --label DevKit --secret-ref "Dev Secrets / MCPWorkers / DevKit" --scopes workers.read,workers.health,workers.lifecycle
```

The Manager generates the client token directly in KeePassXC and returns only non-secret metadata. It stores only the token hash. Manage/revoke with:

```powershell
npm --prefix platform/worker-manager run start -- client list
npm --prefix platform/worker-manager run start -- client revoke devkit
```

DevKit resolves the entry using its KeePassXC Secret Provider. On explicit Connect/Unlock, the master password is entered in a separate visible PowerShell secure-string prompt; it never enters Renderer state or preload IPC. The Main Process passes it to KeePassXC CLI through stdin and uses it only for the unlock attempt. DevKit stores only an OS-encrypted KeePassXC reference and keeps the resolved client token in Main Process memory while unlocked. After application restart, the user unlocks again.

### 3.2 Granted scopes

- `workers.read`: Definition/Instance list and detail.
- `workers.health`: explicit per-Instance health checks.
- `workers.lifecycle`: explicit start/stop/restart.

Definition mutation, package operations, worker configuration, credential management, recovery and failover are not exposed by the DevKit client.

## 4. Implemented Stage 2 integration

1. Connection state: unavailable, API reachable, configured/locked, connected, unauthorized, insufficient scope, incompatible API and request error.
2. Read-only Definition/Instance discovery.
3. Per-Instance runtime state, health state, enabled state, role, priority and verified capabilities.
4. Explicit on-demand health checks.
5. Explicit start/stop/restart controls with confirmation and Manager-owned execution.
6. Clear distinction between desired configuration (`enabled`) and observed runtime state (`runtimeState`).
7. Bounded requests, sanitized errors and no token-bearing diagnostics.
8. Worker Instance lifecycle remains explicit; Manager startup and shutdown are coordinated by DevKit Runtime under the ownership policy below.

MCPWorkers remains authoritative for advanced package, credential, activation, recovery and failover workflows.

## 4.1 DevKit Runtime ownership of the Manager

- Register MCPWorkers Manager as a DevKit-managed workspace component with a declared health endpoint, startup timeout, readiness check, dependencies and shutdown policy.
- When the workspace starts, first probe the configured loopback endpoint. If a compatible healthy Manager is already running, attach to it as externally owned; do not claim process ownership.
- If no compatible Manager is running, DevKit Runtime launches the packaged/managed Manager component and records verified process-tree ownership before treating it as managed.
- When the workspace stops, DevKit gracefully stops the Manager only if this Runtime session launched and owns it. If the Manager was already running externally, leave it running.
- `ProcessObservation.identityVerified` and lifecycle ownership are separate. A healthy external Manager is represented as `state: present`, `identityVerified: false`, `ownership: external`; the Runtime may report it healthy after the HTTP readiness probe, while both the adapter and UI continue to forbid stop/unregister actions.
- If Manager startup fails, report a degraded/unavailable workspace dependency with actionable diagnostics; do not silently fall back to direct LocalMCP/Tunnel/Chat2Agent lifecycle control.
- Manager startup does not automatically start Worker Instances. Worker start/stop/restart remains an explicit, separately confirmed API v1 action.
- DevKit builds the Manager CLI into `dist-electron/mcpworkers-manager/manager.mjs` from the sibling MCPWorkers source checkout and includes it as `resources/mcpworkers-manager/manager.mjs` in the installer. At runtime, DevKit launches that bundle through its own Electron executable with `ELECTRON_RUN_AS_NODE=1`; it does not depend on global Node or a manually opened terminal.
- The Manager data root is passed through the non-secret `MCPWORKERS_DATA_ROOT` environment setting. Development defaults to the existing sibling `MCPWorkers/.mcpworkers` directory. Packaged builds use the existing data root selected through Services; DevKit persists only that path in `mcpworkers-manager-runtime.json` under its own user-data directory. `DEVKIT_MCPWORKERS_DATA_ROOT` remains an optional deployment override. The selected root must already contain a regular `registry/registry.json`; the Manager may provision its own DPAPI-protected daemon token under that root if one does not exist. DevKit does not create a new data-root directory or migrate existing data.
- DevKit creates a random per-session Windows named pipe and passes its path to the Manager as `DEVKIT_MCPWORKERS_SHUTDOWN_PIPE`. The Manager sends a readiness handshake and listens for a shutdown request. Runtime waits for graceful exit, then uses its verified process handle for bounded fallback termination only if necessary. The pipe path is transient and is not a credential.

## 5. Migration policy

- LocalMCP, LocalMCP-Tunnel and Chat2Agent are managed through MCPWorkers after the integration is accepted. Current direct DevKit adapters remain transitional and must not be removed until live and packaged acceptance is complete.
- Do not invoke old direct lifecycle scripts in parallel with MCPWorkers.
- Multi-AI Aggregator remains a separate launch-only integration.
- Local Folder and Obsidian remain DevKit Storage providers.
- Karakeep remains connection/authentication status only. DevKit must not list, search, preview, index, download or otherwise access bookmarks.
- Preserve all existing installations, configurations, running processes and user data. No migration or cutover without explicit approval.

## 6. Implementation and remaining acceptance

Completed in the current working tree:
- [x] Main-process-only API v1 client and bounded loopback liveness probe.
- [x] KeePassXC-based scoped client-token resolution path and OS-encrypted reference persistence.
- [x] Main-process IPC and narrow preload surface.
- [x] Authenticated Definition/Instance discovery, on-demand health checks and explicit lifecycle requests.
- [x] UI connection states and per-Instance metadata/actions.
- [x] Manager Runtime supervisor using the existing Runtime ProcessManager, with healthy external attach, configured sidecar start, API/pipe readiness and owned-only shutdown.
- [x] Bundle the Manager CLI and launch it through Electron's embedded Node runtime; no global Node or manual terminal is required at app runtime.
- [x] Register MCPWorkers Manager in the DevKit Runtime Service Registry through a dedicated adapter.
- [x] Expose Manager ownership/runtime state, existing data-root selection and Connect/Launch / owned-only shutdown controls through Services.
- [x] Keep external process identity and lifecycle ownership separate; a healthy external Manager can be reported running while stop remains forbidden.
- [x] External-Manager attach E2E passes; the external Manager remains healthy after DevKit closes.
- [x] DevKit checks pass: 551/551 tests across 54 files; TypeScript and ESLint clean (2026-11-28).
- [x] Development E2E 4/4 and packaged E2E 5/5 after the latest integration changes.
- [x] Sidecar lifecycle smoke tests pass against development, unpacked packaged and NSIS-installed executables, using isolated temporary data roots and verifying API v1 readiness plus graceful named-pipe shutdown.
- [x] Live DevKit → KeePassXC → scoped token → authenticated Manager API flow verified; Definition/Instance discovery returned 3/3 without reading Manager Registry files.
- [x] Live DevKit Runtime-owned Manager start/readiness/ownership/graceful-shutdown verified against an isolated Manager/data root; the owned process exited cleanly and an unrelated external Manager remained healthy.
- [x] KeePassXC-backed Karakeep credential resolution verified separately using the connection-only provider; bookmark content was not accessed.

Remaining:
- [ ] Verify the full DevKit Runtime-managed lifecycle in an NSIS-installed app using the selected existing data root; current installed validation covers the sidecar itself and isolated packaged lifecycle.
- [ ] Complete the final comprehensive Stage 2 audit after Manager lifecycle integration.
- [ ] Retire direct LocalMCP/Tunnel/Chat2Agent lifecycle adapters only after the MCPWorkers workflow is accepted and the user explicitly authorizes retirement.
- [ ] Retire direct LocalMCP/Tunnel/Chat2Agent lifecycle adapters only after the MCPWorkers workflow is accepted.

## 7. Acceptance criteria

- The client credential is distinct from the Manager root token and is independently revocable.
- MCPWorkers stores only a hash of each client token.
- DevKit uses only the agreed scopes and documented API v1 routes.
- Authentication and API calls remain in the trusted Main Process.
- Renderer receives only sanitized status and worker metadata.
- Worker health is distinct from Manager/API liveness.
- Explicit lifecycle requests use API v1 and reflect the Manager's observed result.
- DevKit Runtime starts/attaches to the Manager according to workspace lifecycle and ownership rules; it stops only a Manager process it launched.
- No Worker Instance is automatically started, stopped, restarted, updated, activated or failed over by opening DevKit.
- Existing live installations and configurations remain unchanged during acceptance.
- TypeScript, lint, focused integration tests, full Stage 2 checks and packaged E2E pass.
- Stage documentation records authentication design, limitations and test evidence.

## 8. Normative source documents

MCPWorkers repository:
- `docs/PROJECT-PLAN.md`
- `docs/integrations/DEVKIT_INTEGRATION.md`
- `docs/architecture/WORKER-CONTRACT-v1.md`
- `docs/architecture/WORKER-MANAGER-MVP.md`
- `docs/api/MCPWORKERS-API-v1.md`
- `docs/architecture/MANAGED-DATA-LAYOUT-v1.md`
- `docs/architecture/ACTIVATION-JOURNAL-v1.md`
- `docs/architecture/FAILOVER-POLICY-v1.md`

The API v1 contract is authoritative for DevKit integration. Internal Registry, token-file and adapter implementation details are not public integration contracts.
