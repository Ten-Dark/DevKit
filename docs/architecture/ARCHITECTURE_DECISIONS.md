# DevKit Architecture Decisions

**Stage:** 0 — Architecture Foundation

**Status:** Baseline decisions for the MVP; revisit only when new evidence or a concrete integration requires it.

**Scope:** Product and architecture decisions that unblock Stage 1 (DevKit Runtime).


This document turns the product vision into implementation constraints. It deliberately distinguishes decisions that are fixed for the first MVP from choices that remain gated by security or integration validation.

## ADR-001 — Keep Electron as the desktop shell; host Core in the main process initially

**Decision**

- Keep the existing Electron + React + TypeScript application as the product shell for the first platform MVP.
- Implement Core as framework-independent TypeScript domain modules, hosted by the Electron main process.
- Keep Electron APIs, filesystem access, process creation and privileged operations in the main process or narrowly scoped platform adapters.
- Keep the renderer unprivileged. Expose validated, typed capability APIs through preload/IPC.
- Do not introduce a separate always-running daemon or a second backend process in Stage 1.

**Rationale**

The current application already has a working Electron main/preload/renderer boundary, secure BrowserWindow settings, validated IPC, filesystem authorization and an established test/build pipeline. Replacing the shell or introducing a daemon before a real lifecycle requirement exists would expand the MVP and migration risk without delivering user value.

**Evolution gate**

Consider a separate Core host only when a proven requirement exists: services must be controlled while the UI is closed, multiple UI clients must share one Core instance, stronger process isolation is required, or headless workflows must run independently. The domain contracts must not depend on Electron so this extraction remains possible.

## ADR-002 — One explicit DevKit workspace root owns DevKit-managed state

**Decision**

- Separate application binaries from workspace data and managed service resources.
- Introduce one canonical, configurable workspaceRoot resolved by a dedicated path service.
- Initial Windows default: a DevKit-owned directory beneath Electron's per-user application data location. Do not assume the current application install directory is writable or suitable for persistent state.
- Allow an explicitly selected workspace root in a later settings flow. A portable/USB mode may select a root beside a portable marker, but must not be inferred from arbitrary executable paths.
- Store only references to user projects and external vaults; do not silently copy their contents into the DevKit workspace.

**Initial logical layout**

~~~tex
<workspaceRoot>/
  workspace.json             # workspace ID, schema version, ownership marker
  config/                    # non-secret, versioned application/service config
  registry/                  # service and adapter registrations
  services/<service-id>/     # DevKit-provisioned service files, if any
  service-data/<service-id>/ # mutable service data, if any
  runtimes/<runtime>/<version>/
  workflows/                 # local workflow definitions
  events/                    # structured lifecycle and health events
  logs/                      # operational logs, secret-redacted
  cache/                     # regenerable cache only
  backups/                   # explicit backups and recovery metadata
  vault/                     # encrypted vault container and metadata
~~~

Directories are created lazily when a capability is enabled. Do not create empty infrastructure for features that do not yet exist.

**Ownership rules**

Every resource is either managed (created/provisioned by DevKit and covered by an ownership record) or connected (pre-existing or externally owned). A connected resource may be observed or operated only through explicitly granted capabilities. It is never eligible for automatic deletion or migration.

## ADR-003 — Core is a set of domain modules, not a monolithic service

**Decision**

Organize Core around domain responsibilities and stable contracts:

- Workspace and configuration.
- Service registry and adapter registry.
- Process/runtime lifecycle.
- Health/readiness and dependency graph.
- Orchestration policy.
- Structured events and diagnostics.
- Security/authorization primitives.
- Storage-provider and vault interfaces.

Keep UI components, provider-specific API clients and platform-specific process behavior outside the domain model. Use dependency injection at module boundaries; avoid a generic plugin framework until real adapters prove the required extension surface.

## ADR-004 — Service lifecycle is adapter-driven and capability-based

**Decision**

A service registration describes the resource; its adapter performs provider-specific operations. An adapter declares its ID/version, supported platforms, management mode, required permissions, configuration schema, dependencies and supported capabilities.

The common adapter surface is capability-based and may include:

- validateConfig
- getStatus
- healthCheck and readinessCheck
- start, stop, restar
- getLogs
- install, update, backup, restore, uninstall only when explicitly supported

Unsupported operations must not appear as available controls. uninstall is allowed only for DevKit-managed resources with a verified ownership record.

**Process safety**

- Spawn an executable with a separate argument array and shell disabled; never interpolate configuration into a shell command.
- Validate executable and working-directory paths, environment-variable names and allowed capabilities before launch.
- Do not pass secret values in ordinary persisted service configuration or logs; use secret references when Vault is available.
- Track only processes started by the adapter. Persist enough identity metadata to revalidate a process after restart; if identity cannot be proven, report unknown rather than terminating a PID.
- Stop gracefully first. Any forced termination is adapter-defined, bounded and restricted to the process tree DevKit can prove it owns.
- A connected service may be monitored without lifecycle permission. Start/stop/update/delete permissions are independent grants.

## ADR-005 — Separate process state from service health and readiness

**Decision**

Persist and display raw observations separately from the aggregate service state.

Aggregate states:

- running: required health/readiness checks pass.
- stopped: known not to be running.
- failed: a known failure prevents operation.
- degraded: partially available or an important dependency/check is impaired.
- unknown: evidence is missing, stale or insufficient.

A live process is not proof of a healthy API. A successful TCP connection is not proof that a service is ready for a workflow. Each probe records its type, result, timestamp, duration and sanitized diagnostic. Stale and late responses must not overwrite newer state.

## ADR-006 — Start with versioned local files; defer a database until evidence requires i

**Decision for the first Runtime MVP**

- Store small registry/configuration documents as versioned JSON with runtime validation.
- Use atomic write/replace and a serialized mutation queue, following the existing settings persistence pattern.
- Use an append-only structured event log with rotation/retention for lifecycle and health events.
- Acquire a single-instance application lock before mutating workspace state.
- Migrate existing settings without dropping favorites, recents or tool preferences.
- Do not add SQLite or another database in Stage 1.

**Revisit when**

Query volume, concurrent writers, event retention, transactional relationships or team synchronization exceed the file-store model. A database decision must include Electron/Windows packaging, native dependency and migration implications.

## ADR-007 — Vault is separate from ordinary configuration and is local-firs

**Decision**

- Secret values never belong in plain JSON configuration, service manifests, logs, telemetry, crash reports or Inspector context packs.
- Configurations store opaque secret references.
- Vault is a separately permissioned subsystem with an explicit locked/unlocked lifecycle.
- Use established, reviewed cryptographic libraries and standard authenticated encryption; do not implement cryptographic primitives or key derivation.
- A master passphrase or an equivalently strong user-controlled unlock mechanism is the source of authority. OS credential storage may optionally wrap a vault key for convenience, but must not silently downgrade to plaintext or make the vault undecryptable when the OS account changes.
- Encrypted export/backup and recovery must be designed before Vault is considered production-ready.

**Implementation gate**

Select and pin the concrete cryptographic library, KDF, AEAD mode, key hierarchy, memory-hardness parameters and recovery format in a dedicated security decision before implementing Vault. Validate the library's maintenance, audit history, Electron packaging and supported platforms. The likely candidate family is Argon2id plus an authenticated-encryption construction such as XChaCha20-Poly1305, subject to that review.

## ADR-008 — Integrate existing stores; do not replace them

**Decision**

- Karakeep is a provider-backed source for bookmarks, links and quick notes. Integrate through its supported API and store only endpoint/configuration plus secret references in DevKit.
- Obsidian is a filesystem/vault provider. Register the user's selected vault path and use documented file-level operations; do not assume an undocumented API or take ownership of the vault.
- MCP servers are protocol integrations with separate transport and lifecycle concerns. Support local stdio and remote HTTP transports through adapters; a connected endpoint does not imply DevKit owns its server process.
- LocalMCP, LocalMCP-Tunnel and other MCP installations are connected resources until explicitly adopted/migrated.
- MultiAggregator is a service/project integration, not a storage provider. Its build and lifecycle behavior belongs behind a service adapter.
- Use official provider APIs and the maintained MCP SDK where applicable. Validate exact capabilities against each real installation during its integration stage.

**Data rule**

Provider data remains authoritative in its original system. DevKit may provide unified discovery/navigation and supported operations, but must not create a competing duplicate knowledge store.

## ADR-009 — Inspector is isolated from Core and read-only by defaul

**Decision**

- Inspector has its own run lifecycle, findings store and permission profile.
- Core and service lifecycle must continue to work if Inspector is unavailable.
- Passive inspection is read-only and does not execute repository scripts.
- Running tests, builds, package managers or other project-defined commands requires a trusted-project policy and explicit execution authorization; commands run with bounded time/resources and without inherited secrets by default.
- Deterministic tool results and AI-assisted findings are stored and presented separately.
- Inspector cannot edit code, apply migrations, restart services or publish releases without a separate user-authorized action.
- Self-inspection uses a bounded target snapshot and must not recursively trigger itself.

**Isolation evolution**

Begin with a separate worker boundary for bounded analysis. Use a dedicated utility/child process with restricted environment and filesystem access for execution-capable checks; do not run untrusted project scripts in the privileged Electron main process.

## ADR-010 — Local-first individual workflow precedes team collaboration

**Decision**

Stage 1–3 are local-first and useful for one developer without a required DevKit-hosted backend, subscription or always-on server. Workflow definitions and service adapters remain provider-agnostic. Team sharing, roles, shared secrets, centralized policy and synchronized workspaces are later extensions built on explicit collaboration providers.

This does not prevent integrating GitHub, issue trackers, CI providers or remote MCP endpoints in the local MVP.

## ADR-011 — Application removal and workspace purge are different operations

**Decision**

- Ordinary application uninstall removes application binaries and registrations created by the installer; it preserves the workspace and managed data by default.
- Complete Purge is a separate, explicit operation with a preview of every resource to be removed.
- Purge is limited to resources covered by DevKit ownership records and canonical paths under the workspace root, plus explicitly recorded OS registrations created by DevKit.
- Connected services, external project folders, Obsidian vaults, Karakeep databases and other external data are never removed by a DevKit purge.
- Offer export/backup before purge, require confirmation, log the result and report any cleanup that could not be completed.
- Never claim that the host OS is pristine if third-party/global resources remain or permissions prevent cleanup.

## ADR-012 — Platform support is adapter-driven; Windows is the first production targe

**Decision**

- Windows is the only supported platform for the Runtime MVP and the first production-readiness milestone. Linux and macOS are explicitly deferred until the Windows implementation has passed its production acceptance criteria.
- Cross-platform extensibility is an architectural requirement now; cross-platform implementation and support are not.
- Keep Runtime domain contracts, dependency planning, service state, orchestration policy and UI independent of OS-specific APIs.
- Keep platform availability explicit in adapter metadata. An adapter must declare supported platforms and capabilities; registration and execution must reject unsupported combinations rather than silently falling back.
- Treat the current `ProcessManager` as shared lifecycle orchestration. Before adding another OS, introduce a narrow platform process-control boundary for OS-dependent spawn options, process identity/ownership verification, graceful termination, process-tree handling and force-stop semantics. Keep persistence, operation serialization, readiness orchestration and dependency policy above that boundary.
- Implement and validate each future platform strategy independently. Do not claim platform support based on TypeScript compilation or Node.js API compatibility alone.
- Do not add speculative Linux/macOS branches, CI targets or platform-specific dependencies before the Windows production gate is met.

**Rationale**

Node.js provides portable process primitives, but process ownership, signal behavior, process-tree termination, executable resolution, filesystem semantics, packaging and OS permissions still require platform-specific validation. A declared platform list alone is not sufficient evidence of safe lifecycle behavior.

**Windows production gate**

Before expanding platform scope, Windows must pass the defined production checklist: packaged installation/update/uninstall and rollback; workspace ownership and permission checks; process start/readiness/stop/restart across failure and application-restart scenarios; child-process and orphan handling; path and environment edge cases; recovery and backup validation; security review; supported Windows versions; and repeatable packaged E2E validation.

**Future platform expansion gate**

For each new OS, provide a dedicated platform process-control implementation, adapter capability declaration, filesystem/path and permission validation, packaging lifecycle, CI/build coverage, and packaged smoke/integration tests. The shared Runtime Core should require no OS-specific branching to support the new target. Reopen this ADR only when Windows production readiness is demonstrated and a concrete platform target is approved.

## ADR-013 — Vault uses pluggable Secret Providers; no provider is mandatory

**Decision**

- Separate secret references from secret values. Persist provider identity and provider-specific references only; resolve values at the point of use in the privileged process.
- Support three provider modes as distinct choices:
  - **Local:** DevKit-managed encrypted local storage. The current `OsSecretStore` is only the OS-backed encryption primitive; it is not yet the complete Local Vault, and it does not establish unlock, key hierarchy, backup or recovery behavior.
  - **KeePassXC:** optional external provider. Use an explicit entry reference such as `entryPath`; do not migrate, rewrite or take ownership of the user's KeePassXC database or existing provider configuration. KeePassXC is not a mandatory or globally canonical source.
  - **Manual:** ephemeral, in-memory credentials entered for the current operation/session. Never persist them; do not silently fall back to a global or previously saved secret reference.
- Allow provider selection at workspace/global level with explicit per-integration or per-resource overrides. A local override must not inherit another resource's secret reference.
- Keep references for distinct integrations separate. Credentials for LocalMCP-Tunnel must never be conflated with another integration's reference, even when they share a provider.
- Resolve secrets only in the main process immediately before the operation that needs them. Inject them through the narrowest supported runtime environment/input channel; never pass them as command-line arguments or expose them to renderer, Registry metadata, ordinary configuration, logs or diagnostics.
- A provider must declare availability, validation and supported operations. Provider failure must fail closed; no plaintext fallback.
- Keep provider adapters replaceable. Do not hard-code KeePassXC assumptions into MCP, Runtime or service domain contracts.

**Rationale**

The user already has connected credential workflows and may choose local protected configuration or KeePassXC for different resources. DevKit should unify access through a provider boundary without imposing one password manager, duplicating credential stores or coupling services directly to a specific provider.

**Implementation boundary**

The OS-backed encryption adapter and encrypted MCP credential persistence are implemented. The initial main-process SecretProvider contract/registry, KeePassXC CLI adapter, separate PowerShell secure-console master-password prompt, and Karakeep secret-reference persistence/resolution path are implemented with unit coverage. The master password is not passed in CLI arguments or through the renderer IPC payload; it is entered in the separate PowerShell prompt and piped to KeePassXC CLI through stdin. The interactive prompt and actual database/entry path still require live runtime verification. Additional provider adapters, Manual ephemeral flow, provider-wide configuration UX, and the complete Local Vault unlock/recovery lifecycle remain unimplemented. Do not claim authenticated KeePassXC-to-Karakeep acceptance until the live unlock and API tests pass.

## ADR-014 — Workspace Runtime owns managed component lifecycle; MCPWorkers owns Worker Instances

**Status:** Accepted product direction for Stage 2 integration.

**Decision**

- DevKit Runtime is the single lifecycle authority for processes explicitly registered as DevKit-managed workspace components.
- MCPWorkers Manager is registered as a managed component. DevKit starts it when required by workspace startup, attaches to an already-running healthy Manager where possible, and monitors its health.
- DevKit may stop the Manager only when the current Runtime session can prove that DevKit launched and owns that process tree. If the Manager was already running externally, DevKit must leave it running on workspace shutdown.
- Workspace shutdown stops DevKit-owned components in reverse dependency order with bounded graceful shutdown and verified cleanup.
- Starting the Manager does not start all Worker Instances.
- MCPWorkers remains the sole authority for Worker Definitions/Instances, their configuration, installation, health and lifecycle. DevKit uses the supported Public API v1 and does not manipulate worker processes or Manager Registry files directly.
- Do not require a manually opened terminal or a globally installed development Node.js runtime in the final packaged workflow. The packaged Manager runtime/sidecar strategy must be validated before acceptance.

**Rationale**

DevKit is the user's single workspace entry point. Requiring a separate manual Manager startup violates that product contract. At the same time, DevKit must not become a second MCPWorkers process manager or terminate a Manager it did not launch.

## ADR-015 — MCP Library and Skills Library are separate catalogues

**Status:** Accepted product direction; Skills Library implementation deferred beyond Stage 2.

**Decision**

- MCP Library discovers and manages MCP server definitions/connections through the official MCP Registry API and other explicitly configured publisher-controlled sources.
- Skills Library discovers and manages agent Skills through official APIs where available, or official repository/release interfaces where no API exists. Do not assume one universal Skills API.
- A Skill is not an MCP server. Skills may declare MCP dependencies, but installation/activation and dependency authorization remain separate explicit actions.
- Both catalogues preserve source provenance, publisher, version, compatibility, declared requirements and trust state.
- Browsing never executes packages or activates Skills. Third-party content is untrusted until reviewed.
- Source adapters own provider-specific API behavior; normalized catalogue contracts remain in DevKit. Do not build a broad marketplace framework before concrete adapters justify it.
- Skills permissions must be explicit and enforced by the host runtime where possible. If enforcement is unavailable, disclose the limitation and do not claim sandboxing.

**Rationale**

MCP servers expose protocol capabilities and have transport/process concerns. Skills provide instructions or agent capability packages and have separate installation, activation and trust concerns. Combining them would blur ownership and permissions.

## Decision review policy

Reopen a decision only when a real integration, test, security review, packaging constraint or user requirement provides new evidence. Record the changed decision and migration impact here; do not repeatedly re-audit settled decisions without a trigger.
