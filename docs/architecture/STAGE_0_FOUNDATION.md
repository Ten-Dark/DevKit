# Stage 0 — Architecture Foundation

**Status:** Complete — implementation-ready baseline established

**Next stage:** Stage 1 — DevKit Runtime
**Scope:** Documentation and architecture decisions only. No runtime code or dependencies are changed in this stage.

## 1. Stage outcome

Turn the DevKit product vision into a concrete, proportionate architecture that can guide the first working platform MVP without prematurely building the entire future platform.

Stage 0 is successful when the team can begin Stage 1 without guessing about:

- Where DevKit-owned data and runtimes live.
- Which process owns privileged operations.
- How services and MCP integrations are represented and managed.
- How process state differs from health and readiness.
- How dependencies are declared and safely orchestrated.
- How secrets, existing storage products and external installations are protected.
- How the existing Dev Toolbox application evolves without losing its working features.
- What exactly must be delivered and tested in the Runtime MVP.

## 2. Verified current implementation baseline

The following facts were checked against the current main branch before planning:

| Area | Current implementation |
| --- | --- |
| Desktop shell | Electron 45.4.1 |
| UI | React 18.3.1 |
| Language/build | TypeScript 5.6, Vite 8 |
| Development runtime | Node.js 22.23.5 pinned by .nvmrc |
| Main process | Electron main process registers settings, window, XMind, Project Markdown and updater handlers |
| Renderer boundary | Preload exposes a typed window.api surface through contextBridge |
| Browser security | contextIsolation, nodeIntegration disabled and sandbox enabled |
| IPC | Central registration helper prevents duplicate handlers; privileged handlers live in main process |
| Filesystem security | Explicitly authorized base/output paths, canonical path checks and guarded file access |
| Settings | JSON settings file under Electron app.getPath('userData'), atomic replacement and serialized writes |
| UI navigation | Home, Tools and Settings, with Project to Markdown and XMind to Markdown workflows |
| Packaging | Windows x64 NSIS installer; updater uses GitHub Releases |
| Validation | ESLint, TypeScript, Vitest, Playwright development/packaged E2E and packaging validation |

The current application is a useful foundation, not yet a service-management platform. The architecture must extend its existing security boundaries rather than bypass or replace them.

## 3. Baseline architecture decisions

The normative decisions are maintained in [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md). The short form is:

1. Keep Electron as the desktop shell for the first MVP.
2. Host modular, Electron-independent Core domain code in the main process initially; do not introduce an always-running daemon before a proven need.
3. Give DevKit one explicit workspace root separate from application binaries and user project directories.
4. Track resource ownership as managed or connected; connected resources are never implicitly adopted, moved or deleted.
5. Use domain modules and declared adapters rather than a monolithic service or premature generic plugin marketplace.
6. Use capability-based service lifecycle operations and safe direct process spawning; never construct shell commands from configuration.
7. Track process observations separately from health/readiness.
8. Use versioned JSON with atomic writes and serialized mutations for the first registry; use structured append-only events with bounded retention. Defer a database until evidence warrants it.
9. Keep Vault separate from ordinary configuration; do not select cryptographic dependencies until a focused security review validates the library and key-management design.
10. Integrate Karakeep, Obsidian, MCP servers and MultiAggregator through distinct provider/service adapters; do not duplicate their authoritative data.
11. Keep Inspector independent from Core and read-only by default. Execution of repository-defined scripts requires explicit trust and execution policy.
12. Ordinary uninstall preserves workspace data. Complete Purge is a separate ownership-verified operation.

## 4. Target logical architecture

~~~text
┌──────────────────────────────────────────────────────────────┐
│                     DevKit Workspace                         │
│ Overview · Projects · Workflows · Services · MCP · Storage   │
│ Vault · Inspector · Monitoring · Toolbox · Runtime · Settings│
└──────────────────────────────┬───────────────────────────────┘
                               │ typed, validated IPC
┌──────────────────────────────▼───────────────────────────────┐
│                    DevKit Core Host                           │
│ Workspace · Configuration · Policy · Service Registry        │
│ Dependency Graph · Lifecycle · Events · Authorization         │
└──────────────┬─────────────────┬─────────────────┬────────────┘
               │                 │                 │
        Runtime adapters   Provider adapters   Inspector API
        Process/OS         MCP/Storage/CI      Separate worker
        Service lifecycle  Karakeep/Obsidian   Bounded analysis
               │                 │                 │
        Managed or          Connected or       Project/build
        connected services  managed providers  inspection targets
~~~

Core owns coordination and stable contracts. Workspace owns presentation and user interaction. Extensions own provider-specific behavior. Inspector consumes declared APIs and events but is not required for Core startup or safe shutdown.

## 5. Workspace ownership and storage layout

The workspace root is separate from the installer directory and from arbitrary user project folders. The initial Windows default is beneath Electron's per-user application data location. The root is configurable by an explicit user action; portable mode is a future explicit option.

Logical structure:

~~~text
<workspaceRoot>/
  workspace.json
  config/
  registry/
  services/
  service-data/
  runtimes/
  workflows/
  events/
  logs/
  cache/
  backups/
  vault/
~~~

Create directories lazily. Store project paths and provider references, not copies of source repositories, Obsidian vaults or Karakeep data. Secrets are stored only in the encrypted Vault; all other configuration stores secret references.

### Ownership classification

| Resource | Owner | Default DevKit behavior |
| --- | --- | --- |
| DevKit binaries | Installer | Update/remove through installer |
| Workspace root and registry | DevKit | Manage and back up |
| Runtime provisioned by DevKit | DevKit | Manage lifecycle and remove only through explicit purge |
| Service installed by DevKit | DevKit | Manage only declared capabilities |
| Existing local MCP/service | External until adopted | Connect and observe; lifecycle only when granted |
| Karakeep instance/database | External provider | Use supported API; never delete |
| Obsidian vault | User | Access selected path; never delete |
| Project repository | User/Git provider | Store reference and inspect under project policy |
| Credentials/tokens | Vault | Encrypt, scope access and redact from diagnostics |

### Removal contract

- Application uninstall leaves workspace data intact by default.
- Complete Purge previews the ownership manifest and selected data scope, offers backup/export, requires explicit confirmation, and removes only verified DevKit-owned resources.
- If ownership or path identity cannot be proven, skip deletion and report the remaining resource.
- External resources and connected services are never recursively removed by DevKit.

## 6. Service, MCP and dependency contracts

A registered service declares identity, owner, adapter, version, supported capabilities, platform support, configuration schema, dependencies, health/readiness probes and log source.

Adapter capabilities are explicit. An adapter that can report status but cannot start a process must not expose a Start action. An adapter may operate a connected service only when the user has granted that exact capability.

### State model

Store raw process state and probe results, then derive an aggregate state:

- running — required checks pass.
- stopped — known not to be running.
- failed — known failure prevents operation.
- degraded — partially available or an important check/dependency is impaired.
- unknown — no sufficiently fresh evidence.

A process existing does not imply an API is ready. Health results have timestamps, bounded timeouts, sanitized diagnostics and stale-result protection.

### Dependency and orchestration policy

Dependencies are declared edges from consumer to provider, marked required/optional and tied to a capability or compatible version where relevant. Detect cycles and missing providers. For a requested workflow, calculate a dependency plan and explain blockers.

Initial policy is manual/confirm-before-action. Automatic start may be enabled later only for registered adapters and pre-approved non-destructive actions. Never launch or terminate arbitrary processes based on inferred dependencies.

## 7. Vault and Storage boundaries

### Vault

Vault is a local-first encrypted secret store with explicit locked/unlocked state and opaque secret references. Cryptographic library, KDF, AEAD, key hierarchy, recovery and encrypted backup format must be selected in a dedicated security decision before implementation. No custom cryptography, plaintext fallback or secret logging.

### Storage

- Karakeep: provider adapter over its supported API for bookmarks, links and quick notes.
- Obsidian: selected local vault path and supported filesystem-level operations.
- Files/project stores: references and bounded access policies.
- MultiAggregator: service/project adapter, not a Storage provider.

Each provider advertises read/write/search capabilities separately. Provider data remains authoritative in its original store.

### MCP Hub

Treat MCP protocol connectivity and local process lifecycle as separate concerns. Support transport-specific adapters (local stdio and remote HTTP where supported). Store endpoint/command metadata separately from secret values. An MCP endpoint being connected does not mean DevKit owns the server or can stop/uninstall it.

## 8. Inspector boundary

Inspector has independent runs, findings, permissions and retention. Passive inspection is read-only. Deterministic checks (tests, lint, build, static analysis) are recorded separately from AI-assisted analysis. Executing project scripts requires a trusted-project policy, explicit authorization, bounded resources and a restricted environment. No source modification, migration, restart or release action is implicit.

Inspector can observe DevKit itself using a bounded snapshot and must not recursively inspect its own outputs.

## 9. Migration from the current Dev Toolbox

Migration is incremental and non-destructive:

1. Preserve the existing Electron shell, navigation, Home/Tools/Settings pages, Project to Markdown and XMind to Markdown workflows.
2. Introduce workspace path resolution before moving any persisted data.
3. Keep the current settings file readable. Add a versioned migration that copies existing settings into the new config location atomically, verifies the result and retains the source until a successful subsequent startup/backup confirms migration.
4. Do not change the installer appId, updater channel or release artifact naming as part of Runtime MVP.
5. Do not move or modify existing MCP, Karakeep, Obsidian, MultiAggregator or project installations during initial registration.
6. Add new Workspace sections incrementally; avoid a large-bang renderer rewrite.
7. Keep existing preload/IPC capabilities stable while adding narrowly scoped, validated service APIs.

## 10. Stage 1 — DevKit Runtime MVP implementation plan

### MVP outcome

A user can register a local service, see truthful process and service health, inspect its declared dependencies, and start/stop/restart only the process instance that DevKit is authorized to manage. The registry and lifecycle history persist inside the DevKit workspace. Existing toolbox workflows continue to work.

### In-scope task chain

| Order | Work package | Deliverable |
| --- | --- | --- |
| 1 | Workspace bootstrap | Canonical root resolver, workspace manifest, directory ownership and single-instance protection |
| 2 | Config migration | Versioned config schema and safe migration of existing settings |
| 3 | Core contracts | Service definition, owner, adapter capability, process observation, health result and event types |
| 4 | Registry persistence | Validated versioned JSON store, atomic writes, serialized mutations and recovery from invalid data |
| 5 | Event/logging foundation | Structured lifecycle events, correlation IDs, redaction and bounded log rotation |
| 6 | Adapter registry | Explicit adapter registration, capability validation and config validation |
| 7 | Process manager | Safe direct spawn, process identity tracking, graceful stop, bounded escalation and cancellation |
| 8 | Health/readiness | Process check plus configurable HTTP readiness probe with timeout and stale-response protection |
| 9 | Dependency engine | Required/optional edges, missing dependency detection, topological plan and cycle rejection |
| 10 | Core IPC | Narrow typed APIs with sender validation, schema validation, authorization and operation IDs |
| 11 | Services UI | Service list/detail, truthful state, dependency summary, logs and supported lifecycle controls |
| 12 | Integration and acceptance | End-to-end service lifecycle test; verify existing Home, Tools, Settings, XMind and Project Markdown flows |

### Explicitly out of scope

- Vault cryptography and credential import.
- Full Karakeep or Obsidian UI/search integration.
- Broad MCP auto-discovery or marketplace.
- Automatic updates/uninstall of connected services.
- Full Inspector analysis pipeline.
- Team sync, accounts, hosted backend or cloud workspace.
- Linux/macOS production support.
- Complete Purge implementation.
- Arbitrary shell command execution or unrestricted process management.

### Stage 1 acceptance criteria

1. Workspace root is resolved deterministically and has an ownership manifest.
2. Existing settings migrate without losing favorites, recents or tool preferences; failed migration leaves the original intact.
3. Registry mutations are validated, serialized and crash-safe enough for the single-instance MVP.
4. Events and logs are structured, bounded and do not contain secret values.
5. Invalid adapter configuration, unregistered actions and unsupported capabilities are rejected.
6. Process start uses direct executable + argument vector with shell disabled; the process working directory and environment are validated.
7. DevKit can stop only a process it launched and can still prove it owns; unknown processes are not killed.
8. Process state and service health are distinct and timestamps are visible.
9. Dependency plans identify missing nodes and reject cycles before execution.
10. Lifecycle actions are explicit and auditable; dependency startup is manual/confirm-first.
11. The Services UI accurately reflects the Core state and never offers unsupported operations.
12. Existing application workflows pass regression checks and the Windows development build remains valid.

## 11. Stage 1 risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Stale PID or PID reuse leads to killing an unrelated process | Persist process identity evidence; revalidate executable, start time and ownership marker; report unknown instead of terminating |
| Service process spawns descendants | Adapter-specific process-tree strategy; bounded graceful shutdown; test child-process behavior on Windows |
| Shell injection through service configuration | Direct spawn with shell disabled, separate args, strict schema and path validation |
| Health probe reports stale success after restart | Per-run generation/correlation ID; discard late responses |
| Workspace move corrupts settings | Do not move data in the first migration; copy/verify/retain source and support rollback |
| Secrets leak into logs or Inspector | Secret references only; centralized redaction; tests with sentinel credentials |
| Connected resource is mistaken for managed | Required owner field and capability grants; no destructive action without ownership proof |
| Future platform support becomes Windows-specific | Platform interface from first implementation; Windows adapter first; platform behavior covered by tests |

## 12. Stage 0 acceptance checklist

- [x] Product vision, target users, goals and non-goals are documented.
- [x] Current implementation baseline is verified against source and package metadata.
- [x] Core, Workspace, Extensions and Inspector boundaries are defined.
- [x] Workspace root, data ownership and removal modes are specified.
- [x] Service/MCP adapter and process safety contracts are defined.
- [x] Health/readiness state model and dependency orchestration policy are defined.
- [x] Vault and Storage boundaries and security gates are documented.
- [x] Inspector autonomy and execution boundaries are documented.
- [x] Migration strategy preserves existing application features and data.
- [x] Stage 1 task chain, scope, risks and acceptance criteria are implementation-ready.

## 13. Stage exit

Stage 0 is documentation-only and has no application runtime changes. Its output is this foundation, the architecture decision record and the linked product/Inspector/service documents. Stage 1 can now begin with workspace bootstrap and config migration; do not reopen settled architecture questions without new evidence.

At Stage 1 completion, perform the agreed comprehensive stage audit, corrections and validation, then update the roadmap and release notes before integration.
