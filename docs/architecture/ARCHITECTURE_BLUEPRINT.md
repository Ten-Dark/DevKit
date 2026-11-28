# DevKit Architecture Blueprin

**Status:** Target architecture with Stage 0 baseline decisions recorded. See [Architecture Decisions](ARCHITECTURE_DECISIONS.md) and [Stage 0 Foundation](STAGE_0_FOUNDATION.md).

## 1. Architecture objectives

- Keep the application, managed runtime and service integrations modular.
- Separate product UI from privileged process, filesystem and secret operations.
- Make service ownership, dependencies, health and lifecycle explicit.
- Support Windows first while preserving a platform-neutral core contract and platform adapters for Linux and macOS.
- Integrate existing tools without requiring immediate migration or replacement.
- Keep the architecture proportionate to each MVP; do not implement future infrastructure before a real vertical slice needs it.

## 2. Logical layers

```tex
DevKit Workspace (UI / workflows / user interaction)
                  |
          Application API / IPC
                  |
DevKit Core (policy, registry, orchestration, lifecycle)
       |          |          |          |
    Runtime     Vault     Storage    Inspector API
       |          |          |          |
Platform      Secret     Storage    Analysis
Adapters      Providers  Adapters   Providers
       |
Service / MCP / Project Extensions
```

### DevKit Core

Owns stable domain contracts and coordination:

- Service Registry and resource ownership metadata.
- Dependency Graph and dependency validation.
- Lifecycle and orchestration policy engine.
- Runtime and process-manager interfaces.
- Configuration and structured event/logging interfaces.
- Health/readiness model and monitoring event contracts.
- Authorization checks for privileged actions.
- Vault and storage provider interfaces (not necessarily their UI).

Core should not contain service-specific shell commands, provider-specific API details or UI presentation logic.

### DevKit Workspace

The desktop application and user-facing workflows:

- Overview, Projects, Workflows, Services, MCP Hub, Storage, Vault, Inspector, Monitoring, Toolbox, Runtime and Settings.
- User consent and confirmation flows for sensitive operations.
- Status visualization, dependency exploration, logs and inspection reports.
- Calls into Core through a narrow, validated application API/IPC boundary.

The renderer must not receive unrestricted filesystem, process, credential or network privileges. Continue the existing Electron security posture: context isolation, disabled Node integration, sandboxing where supported, and validated main-process IPC.

### DevKit Extensions

Extensions implement declared contracts for:

- Service and MCP adapters.
- Platform-specific process, filesystem, startup and packaging operations.
- Storage and knowledge providers.
- Git, issue tracker, CI, AI-agent and other integrations.
- Optional developer tools and workflow steps.

Extensions must declare capabilities, permissions, configuration schema, ownership behavior and supported lifecycle operations. Unknown extensions must not be allowed to execute arbitrary privileged actions by default.

### Inspector

Inspector is a separately managed subsystem. It consumes service telemetry, project metadata, build artifacts and tool outputs through explicit interfaces. Its failure must not prevent Core from safely reporting or stopping services. Inspector can inspect DevKit itself, but self-inspection must avoid recursive unbounded runs.

## 3. Runtime and managed workspace

DevKit uses one predictable workspace root with explicit subdirectories for configuration, registry, managed services, runtimes, events, logs, cache, backups and Vault. The initial layout and ownership rules are defined in [Stage 0 Foundation](STAGE_0_FOUNDATION.md); platform adapters resolve the actual OS path.

Rules:

1. Prefer app-local or workspace-local runtimes and dependencies over global Node.js, Python or package-manager installations.
2. Use platform adapters for process creation, signals, filesystem permissions, symlinks, service registration and packaging.
3. Do not virtualize every service. Use a managed process and isolated directory by default; use containers or other isolation only where required and supported.
4. Distinguish DevKit-provisioned resources from connected pre-existing resources.
5. Track every created OS-level registration or external side effect so uninstall can reverse it safely.
6. Do not silently modify PATH, global package stores, shell profiles or unrelated user configuration.

### Removal modes

- **Remove application:** remove the application binaries while preserving the user's workspace data and managed services for later reinstallation, with clear disclosure of what remains.
- **Complete Purge:** stop managed processes gracefully, remove DevKit-created registrations and managed runtimes/services/configuration/data/secrets/logs/backups as selected by the user, and verify cleanup. Never delete connected resources or paths whose ownership cannot be proven.

Complete Purge must be explicit, confirmed, auditable and preceded by an appropriate backup/export opportunity. Some OS-owned files or resources may require elevated permissions; report incomplete cleanup rather than claiming the host is pristine.

## 4. Service and MCP integration contracts

Services and MCP servers are registered through adapters. A common lifecycle surface may include:

- `install` / `provision` (when supported)
- `configure`
- `start`, `stop`, `restart`
- `update`
- `healthCheck` / `readinessCheck`
- `getStatus`, `getLogs`
- `backup`, `restore` (when supported)
- `uninstall` (only for DevKit-owned resources)

Not every adapter supports every operation. Capabilities must be declared and the UI must not offer unsupported actions. Existing installations should be connectable in place; adoption or migration must be explicit and reversible where possible.

## 5. Service intelligence and orchestration

Core maintains a dependency graph of registered services and workflow requirements. The graph is used to:

- Explain direct and transitive dependencies.
- Show the impact of a failed or unavailable component.
- Determine which declared components are required by a service or workflow.
- Validate readiness before a dependent operation begins.
- Produce a safe startup and shutdown order.
- Detect cycles, missing registrations and incompatible requirements.

The system must never infer permission to launch an arbitrary process merely because a dependency is mentioned. All managed actions require a registered adapter, explicit ownership/capability declarations and an applicable user policy.

See [Service Intelligence & Orchestration](SERVICE_INTELLIGENCE.md).

## 6. Vault and Storage

Vault stores secrets; Storage provides access to user content. They have separate data models and security requirements.

Vault must use established cryptographic libraries and a reviewed key-management approach. Do not invent cryptography. Protect secrets at rest, restrict access by capability, avoid logging secret values, support encrypted backup/recovery and record security-relevant access events. The vault is a high-value failure and compromise boundary; plan recovery and least privilege accordingly.

Storage integrates Karakeep, Obsidian, filesystem locations and future providers. Prefer provider APIs and stable links. Do not rewrite or take ownership of provider data unless the user explicitly provisions it as DevKit-managed data.

## 7. Data and event boundaries

- Use versioned schemas for persisted configuration and registry records.
- Store secrets separately from ordinary service configuration; ordinary config should contain secret references, not secret values.
- Emit structured lifecycle and health events with timestamps, source, resource ID, correlation ID and sanitized details.
- Keep operational logs separate from user content and secret material.
- Define retention and export behavior for events, logs and inspection results.
- Make state transitions idempotent where possible and protect against stale asynchronous results.

## 8. Security boundaries

- Least privilege for Core, adapters and child processes.
- Explicit capability declarations and user authorization for privileged actions.
- No arbitrary command execution from untrusted extension metadata.
- Validate all IPC inputs and filesystem paths in the privileged process.
- Redact credentials and tokens from logs, errors, telemetry and Inspector context packs.
- Confirm destructive actions and keep an audit trail.
- Verify update artifact integrity; use atomic replacement and rollback where practical.
- Back up before migrations or destructive operations.

## 9. Cross-platform strategy

The domain model and contracts should be platform-neutral. OS-specific operations belong behind adapters. Windows is the initial supported target because the current product and packaging are Windows-first. Linux and macOS support should be added through explicit platform implementation and CI validation, not by assuming that Windows process, path or packaging behavior is portable.

## 10. Architectural decision policy

For each major capability, record the problem, considered options, decision, consequences and migration path in [Architecture Decisions](ARCHITECTURE_DECISIONS.md). Avoid deciding every future implementation detail up front. Promote a proposed abstraction to a required Core contract only when at least one real integration needs it and a second use case validates its generality, unless a security boundary requires earlier standardization.
