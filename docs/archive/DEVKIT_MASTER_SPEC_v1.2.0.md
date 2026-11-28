# DevKit — Master Product & Architecture Specification

**Document:** `DEVKIT_MASTER_SPEC_v1.2.0.md`
**Document version:** `1.2.0`
**Versioning scheme:** Semantic Versioning for documentation (MAJOR.MINOR.PATCH; independent of the DevKit application version)
**Source status:** Prepared canonical replacement for v1.1.1; activate as the sole active Project master source only after the user replaces the previous Project source
**Supersedes:** `DEVKIT_MASTER_SPEC_v1.1.1.md`, `DEVKIT_MASTER_SPEC_v1.1.0.md`, `DEVKIT_MASTER_SPEC_v1.0.2.md`, `DEVKIT_MASTER_SPEC_v1.0.1.md`, and the earlier unversioned snapshots (`DEVKIT_MASTER_SPEC.md`, `DEVKIT_MASTER_SPEC_UPDATED.md`, and `DEVKIT_MASTER_SPEC_SYNCED.md`); retain them as historical archives
**Product:** DevKi
**Positioning:** Independent Developer Workspace Platform
**Document role:** Primary product, architecture, scope, and development-context source
**Last consolidated:** 2026-11-28 (adds the AI Agent Development Control Plane decision, MCPWorkers ownership boundaries, project Agent Profiles, single-agent development workflow, and staged enablement backlog)
**Status:** Living specification — decisions, targets, implementation status, and open questions are explicitly separated.

---

## 0. How to use this documen

### Canonical source identity and document versioning

This specification uses its own version number. **The document version is not the DevKit product version, package version, release version, Git tag, or schema version.** It tracks changes to this source document only.

- **Canonical source:** `DEVKIT_MASTER_SPEC_v1.2.0.md` — this is the prepared replacement for v1.1.1. It becomes active only after the user replaces the previous Project source and designates v1.2.0 as the sole active master source.
- **Version format:** `MAJOR.MINOR.PATCH`.
  - **MAJOR** — a substantial change to the product vision, core architecture, scope, or foundational decisions that makes the previous master specification materially incompatible or obsolete.
  - **MINOR** — a meaningful addition or approved change to product capabilities, architecture, roadmap, or decisions that remains compatible with the existing specification.
  - **PATCH** — corrections, clarifications, refreshed verification results, and metadata/editorial updates that do not change the intended product direction or architecture.
- **Filename rule:** every published snapshot uses the explicit version in its filename: `DEVKIT_MASTER_SPEC_vMAJOR.MINOR.PATCH.md`. Never create ambiguous names such as `FINAL`, `LATEST`, `NEW`, `UPDATED`, or `SYNCED` as the only version identifier.
- **Single-source rule:** keep only one version designated as the active canonical master source in the Project's source list. Older versions may be retained as archives, but must be clearly marked historical and must not be used as current instructions.
- **Update rule:** when publishing a new version, update the version in this header, the filename, the revision history below, and any explicit references to the canonical filename in the document. Do not silently overwrite an older versioned snapshot.
- **Promotion rule:** a newly generated file becomes authoritative only after it has been reviewed and deliberately added to the Project as the active source. Until then, the previously designated canonical source remains authoritative.
- **Conflict rule:** if two copies claim to be current, prefer the highest explicitly designated canonical version, not merely the file with the newest timestamp. If canonical status is unclear, stop and resolve the source designation rather than combining versions by assumption.

### Revision history

| Document version | Date | Change type | Summary | Source status |
|---|---|---|---|---|
| `1.0.0` | 2026-11-24 | Initial versioned baseline | Establishes explicit document-only versioning and consolidates the verified Runtime PR #13 state with the initial Stage 2 snapshot. | Historical; retain as the previous version |
| `1.0.1` | 2026-11-24 | PATCH | Reconciles Stage 2 scope and acceptance, records verified 487-test/build/package/installed-app results, documents the remaining process-tree and live-integration gates, and updates the current repository state. | Historical; retain as the previous version |
| `1.0.2` | 2026-11-24 | PATCH | Implements managed MCP stdio process-tree ownership with attach-before-launch Job Object containment; records 488-test, development, packaged, installed-NSIS, and ASAR bootstrap-runtime validation; updates Stage 2 acceptance and remaining gates. | Historical; retain as previous version |
| `1.1.0` | 2026-11-27 | MINOR | Adds explicit DevKit-owned lifecycle management for MCPWorkers Manager; separates MCP Library and Skills Library; defines Services Hub/local-service ownership; records the three planned developer utilities (Color Converter & Palette, Port Inspector, Project Inspector); clarifies Stage 2 gates and the post-Stage-2 feature sequence. | Superseded by 1.1.1; retain as historical |
| `1.1.1` | 2026-11-27 | PATCH | Removes conflicting status claims; confirms Karakeep connection-only status; separates implemented MCPWorkers API/UI work from the still-open Runtime Manager lifecycle and live acceptance; aligns current validation evidence, stage gates, roadmap order, and canonical-source wording. | Historical; retain in the repository |
| `1.2.0` | 2026-11-28 | MINOR | Defines DevKit as the AI Agent Development Control Plane; separates DevKit configuration, MCPWorkers runtime ownership, and agent consumers; adds project Agent Profiles, single-agent Change-Scoped Development, tool-selection policy, ADR and AGENTS templates, and a staged implementation backlog. | Prepared canonical replacement; replace v1.1.1 in the Project sources |

This document consolidates the available DevKit decisions as of 2026-11-28. Version 1.2.0 is a documentation MINOR update: it adds the AI Agent Development Infrastructure direction and task plan without changing the existing Stage 2 acceptance gates or claiming that the planned integrations are implemented. The new architecture and backlog are detailed in docs/architecture/AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md and docs/plans/AI_AGENT_DEVELOPMENT_ENABLEMENT.md. This file is a prepared replacement for v1.1.1; the user must replace the old Project source explicitly before v1.2.0 becomes authoritative.

It is not a claim that every described feature already exists. Read status labels carefully.

### Status vocabulary

- **[DECIDED]** — explicitly agreed direction or constraint.
- **[CURRENT]** — known implementation or project state reported in prior work. It may need repository verification before acting.
- **[TARGET]** — intended product capability, not necessarily implemented.
- **[PROPOSAL]** — recommended design direction that still requires validation or an explicit decision.
- **[OPEN]** — unresolved question or decision.
- **[DEFERRED]** — intentionally outside the current MVP or postponed.

When current repository state conflicts with an older conversation summary, the actual Git repository and its latest verified state take precedence. Never infer that a feature is implemented merely because it appears in this specification or roadmap.

### Source-of-truth hierarchy

1. Current repository state, tests, release artifacts, and verified runtime behavior.
2. Explicitly accepted architectural decisions and ADRs in the repository.
3. This master specification for product intent, boundaries, and consolidated context.
4. Feature specifications and roadmap documents.
5. Conversation history and agent assumptions.

This file should not replace useful focused documents. It should point to them and define the product-level context. Avoid maintaining contradictory copies of detailed implementation specifications.

---

# 1. Executive summary

DevKit is intended to evolve from a small desktop developer-toolbox application into an **independent, portable, extensible workspace platform for software developers and engineering teams**.

Its purpose is to give a developer one coherent environment from which they can access, organize, operate, inspect, and coordinate their development tools, services, data, credentials, projects, and workflows.

DevKit is not intended to become another IDE, another notes application, another bookmark manager, or a monolithic replacement for every service. Existing specialist tools should remain useful and independently understandable. DevKit should connect them through consistent integrations, lifecycle management, a unified interface, and shared platform capabilities.

The platform should eventually coordinate:

- Developer identity, authentication material, credentials, API keys, and tokens.
- MCP servers and their tools, APIs, dependencies, configurations, startup, and lifecycle.
- Knowledge and storage systems such as Karakeep and Obsidian.
- AI services and Multi-AI Aggregator.
- Local and external services, processes, and development infrastructure.
- Projects, repositories, build systems, test workflows, packaging, and releases.
- An independent Inspector subsystem that monitors services, detects changes, evaluates updates, runs checks, and produces actionable reports.
- Personal and team-oriented development workflows.

The central product idea:

> **DevKit is the developer's independent workspace: one controlled environment for the tools, data, services, and workflows that make software development possible.**

The central architectural idea:

> **DevKit owns and manages its workspace. The host operating system provides execution capabilities, but should not become the accidental owner of the workspace's data, service configuration, or lifecycle.**

The central development principle:

> **Build complete, useful MVPs in substantial logical stages. Validate and audit after a stage is complete, fix actionable findings, record the result, and then move forward. Do not turn development into an endless sequence of speculative audits.**

---

# 2. Product identity and vision

## 2.1 Name and positioning

**Name:** DevKi
**Product category:** Independent Developer Workspace Platform
**Short positioning:** The Developer's Independent Workspace.

The name retains the original meaning of a developer toolkit, but the product ambition is broader than a collection of utilities.

## 2.2 Product vision

DevKit should become a single entry point for the developer's working environment. A developer should not need to remember which application owns a particular service, where its configuration is stored, how it is started, which runtime it needs, or where its operational state can be inspected.

The platform should make those relationships discoverable and manageable.

A user should be able to:

1. Open DevKit and see the state of their workspace.
2. Access connected tools and services from one interface.
3. Find and use knowledge stored in connected knowledge systems.
4. Manage MCP servers, integrations, and AI tooling.
5. Start, stop, update, and inspect managed services.
6. Work with projects and development workflows.
7. Understand failures through Inspector reports.
8. Move the workspace to another supported machine or operating system with a controlled migration process.
9. Remove the managed workspace without leaving unmanaged application data and service installations behind.

## 2.3 Target users

**[DECIDED]** DevKit should not be designed exclusively for its original owner. It should be useful to a wider developer audience.

Target user groups:

- Independent developers.
- Senior developers.
- Tech leads.
- Engineering leads and engineering managers.
- Small development teams.
- Developers who use multiple AI agents, MCP servers, local services, and knowledge systems.

The initial product may remain optimized for an individual workspace. Team functionality should be enabled by architecture where justified, but must not delay the first useful MVP.

## 2.4 Product principles

1. **Independent workspace:** workspace data and managed components belong to DevKit's workspace, not to arbitrary host-system locations.
2. **Modularity:** services and integrations should be replaceable without rebuilding the core.
3. **Interoperability:** use stable adapters and explicit contracts rather than tightly coupling external products to the core.
4. **MVP-first:** deliver the smallest complete user workflow before adding advanced abstractions.
5. **Performance and responsiveness:** the application should feel fast and remain responsive during long-running operations.
6. **Maintainability:** architecture must fit actual requirements; no technology stack or methodology should be imposed by habit.
7. **Privacy and security:** secrets, credentials, local data, and process boundaries require explicit protection.
8. **Portability:** support more than one operating system as a product goal, with platform-specific implementation isolated behind clear boundaries.
9. **Observable operation:** managed services should expose status, logs, health information, version, and dependencies where available.
10. **User control:** destructive operations, data removal, releases, and externally consequential actions require explicit safeguards.
11. **No forced replacement:** connected specialist products should remain independently usable unless the user intentionally chooses a fully managed installation.
12. **Evidence-based quality:** distinguish what is implemented, tested, assumed, and planned.

---

# 3. Product scope and non-goals

## 3.1 In scope

The long-term product scope includes:

- A desktop workspace application and its core runtime.
- Workspace bootstrap, initialization, update, migration, and removal.
- A controlled workspace directory and data model.
- Service and process lifecycle management.
- MCP management and integration.
- Storage and knowledge integrations.
- Identity and secret management integrations.
- AI service integrations, including Multi-AI Aggregator.
- Project and developer workflow utilities.
- Build, test, package, and release orchestration.
- Inspector monitoring and quality analysis.
- Extensibility through adapters or extensions.
- A foundation for team workflows.

## 3.2 Non-goals

DevKit should not automatically become:

- A full IDE or code editor replacement.
- A replacement for Git hosting platforms.
- A replacement for Karakeep or Obsidian.
- A new general-purpose password manager unless a separate, justified product decision is made.
- A general-purpose cloud hosting provider.
- A mandatory always-online service.
- A platform that requires the developer to use one particular AI provider.
- A monolith that embeds every external application's code.
- A system that silently takes ownership of unrelated host applications or user data.

## 3.3 Product boundary

DevKit owns the workspace and the components explicitly installed or registered as managed by that workspace. It may connect to external services without owning them.

Every integration must declare its ownership mode. Examples:

- **Managed:** DevKit installs and controls the component within its workspace.
- **Connected:** the component is external; DevKit stores a connection and exposes supported operations.
- **Discovered:** DevKit detects a component but does not control it until the user explicitly adopts it.
- **Unmanaged:** the component is outside DevKit's lifecycle and deletion guarantees.

This distinction is essential for safe updates, data retention, and uninstall behavior.

---

# 4. The independent workspace / “box” model

## 4.1 Core concep

**[DECIDED]** DevKit should behave like a self-contained box for the developer's environment. The user wants the workspace to avoid spreading application data, service installations, configuration, and dependencies throughout Windows or Linux.

The desired mental model is similar to a portable vault or a self-contained application environment:

- The workspace owns its managed data.
- The workspace owns its managed service configurations.
- The workspace owns or pins the runtimes and dependencies required by managed components where practical.
- The workspace knows which processes it started and which resources belong to it.
- Removing the workspace removes the resources that are explicitly managed by it.
- The host operating system should not be left with orphaned services or unrelated configuration created by DevKit.

The intended behavior is stronger than a normal application uninstall.

## 4.2 Important technical qualification

No ordinary desktop application can guarantee that absolutely no trace ever exists in the host operating system. The OS may record process execution, installer metadata, filesystem activity, crash reports, security events, caches, or other system-level information.

Therefore the engineering objective is:

- Minimize host-level dependencies and persistent state.
- Keep DevKit-owned data and configuration inside a clearly identified workspace.
- Avoid global installation when a user-scoped or workspace-local installation is practical.
- Avoid registering background services or scheduled tasks outside the workspace unless required and explicitly disclosed.
- Track every host-level integration that DevKit creates.
- Provide a reliable cleanup path for those integrations.
- Clearly distinguish removable application state from user data that must be retained or exported.

Do not promise “zero traces” or absolute confidentiality. Promise a controlled, auditable ownership boundary and predictable cleanup.

## 4.3 Workspace directory model

**[PROPOSAL]** A logical directory layout could look like:

```tex
DevKit/
├── app/                 # DevKit application binaries and UI
├── core/                # Core services and platform logic
├── runtime/             # Managed runtimes and execution suppor
├── services/            # Managed service installations
├── integrations/        # Adapters and integration packages
├── workspace/
│   ├── config/           # Workspace-level configuration
│   ├── data/             # Managed application data
│   ├── knowledge/        # Optional local knowledge data
│   ├── projects/         # Optional workspace-managed projects
│   ├── logs/             # Operational logs
│   ├── cache/            # Rebuildable cache
│   └── state/            # Runtime state and manifests
├── vault/                # Protected secrets and credential references
├── backups/              # Explicitly configured backups/exports
└── manifest/             # Ownership, inventory, versions, checksums
```

This is a conceptual model, not an accepted final filesystem contract. The actual layout must be chosen after checking the existing Runtime implementation and installer behavior.

## 4.4 Ownership manifes

**[TARGET]** DevKit should maintain a machine-readable manifest describing managed resources:

- Component identity and version.
- Installation location.
- Data location.
- Runtime and dependency requirements.
- Startup command or entry point.
- Environment and configuration references.
- Process ownership and lifecycle.
- Health-check method.
- Update source and integrity metadata.
- Files and directories created by DevKit.
- Host-level registrations, if any.
- Removal and retention policy.

The manifest should make it possible to answer: “What exactly does this workspace own?”

## 4.5 Uninstall and cleanup contrac

**[DECIDED — PRODUCT INTENT]** When DevKit is removed, its managed environment should be removable as one coherent unit.

**[TARGET]** Uninstall should:

1. Stop managed processes gracefully.
2. Prevent new managed processes from starting.
3. Remove registered managed services and scheduled tasks, if any.
4. Remove DevKit-owned binaries and dependencies.
5. Remove DevKit-owned configuration and caches.
6. Handle secrets according to a clearly disclosed secure-removal policy.
7. Offer export or retention of user data before destructive removal.
8. Remove only resources recorded as DevKit-owned.
9. Never delete arbitrary external services or user files merely because they are connected.
10. Produce a clear completion report and identify anything that could not be removed.

A connected Karakeep instance or an external Obsidian vault must not be deleted merely because it was connected. If the user explicitly adopted a managed installation, the removal flow must explain whether its data will be deleted, exported, or retained.

**[OPEN]** Decide whether the default uninstall behavior should:
- Remove application and managed runtime but preserve user data.
- Offer “remove everything” as an explicit second option.
- Support a portable workspace folder that can be deleted or moved manually.

A safe default is to preserve or export valuable user data and require explicit confirmation for irreversible deletion.

---

# 5. High-level platform architecture

The following is the target conceptual architecture. It must be reconciled with existing Stage 0 ADRs and Stage 1 Runtime code before implementation.

```tex
┌───────────────────────────────────────────────────────────┐
│                       DevKit UI                            │
│ Home · Workspace · Services · MCP Library · Skills · Storage · AI · Projects│
│ Settings · Inspector · Activity · Team                      │
└────────────────────────────┬──────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────┐
│                    Workspace API / IPC                     │
│ Authentication · Authorization · Contracts · Events        │
└────────────────────────────┬──────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────┐
│                      DevKit Core                            │
│ Workspace Registry · Service Intelligence · Orchestration   │
│ Configuration · Identity Integration · Extension Registry  │
└───────────────┬───────────────┬───────────────┬─────────────┘
                │               │               │
        ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼────────┐
        │ Runtime      │ │ Integrations│ │ Inspector     │
        │ Processes    │ │ Adapters    │ │ Analysis      │
        │ Lifecycle    │ │ Connectors  │ │ Quality Gates │
        └───────┬──────┘ └──────┬──────┘ └──────┬────────┘
                │               │               │
┌───────────────▼───────────────▼───────────────▼─────────────┐
│                    Managed Workspace                        │
│ Services · MCP · Runtimes · Storage · Config · Secrets       │
│ Logs · State · Cache · Projects · Artifacts                  │
└─────────────────────────────────────────────────────────────┘
```

## 5.0.1 Workspace lifecycle ownership and managed components

**[DECIDED]** DevKit is the single entry point for starting and stopping the components that are explicitly registered as managed by the Workspace. A user should not need to launch a separate manager manually as a permanent prerequisite for using DevKit.

The lifecycle model must distinguish the DevKit Runtime from domain-specific managers:

- **DevKit Runtime** owns process supervision for the Workspace: start, stop, restart, health/readiness observation, logs, dependency ordering, process ownership, and shutdown coordination for registered managed components.
- **MCPWorkers Manager** remains the domain authority for MCPWorkers Worker Definitions, Worker Instances, their health, and their lifecycle API. It is one managed component inside the wider DevKit Workspace, not the universal manager for every MCP server or local service.
- **DevKit MCP integration** communicates with MCPWorkers through its supported authenticated API and scoped client credentials. DevKit must not bypass that API to manipulate Worker Instances directly.
- **Other MCP servers** are managed through the appropriate DevKit Runtime/transport integration and do not have to be routed through MCPWorkers.

### MCPWorkers Manager lifecycle contrac

1. On Workspace startup, DevKit checks whether the configured Manager endpoint is healthy.
2. If a compatible Manager is already running, DevKit attaches to it as an external process and does not claim ownership or stop it later.
3. If it is not running and the component is configured as DevKit-managed, Runtime starts the packaged/managed Manager component and records process ownership.
4. DevKit waits for readiness with bounded timeouts and reports startup failures, logs, and retry state.
5. DevKit exposes explicit Start, Stop, and Restart actions in Services. These actions target the Manager process only; they do not implicitly start or stop every Worker Instance.
6. On Workspace shutdown, DevKit gracefully stops only a Manager process it started and still owns, following dependency order and bounded shutdown timeouts. An externally started Manager remains untouched.
7. Worker Instance lifecycle remains an explicit operation through the authenticated MCPWorkers API and its permission scopes.
8. The installed DevKit experience must not require the user to open a terminal, run npm commands, or install a global Node.js runtime merely to start the managed Manager. The distribution mechanism (sidecar executable, packaged runtime, or another supported approach) must be selected based on measured compatibility and maintainability.

**[TARGET]** The Manager should be distributed as a managed component/sidecar for supported platforms. Development scripts may be used during development, but they are not an acceptable production startup contract.

**[OPEN]** Finalize the production packaging mechanism and authenticated credential-provisioning UX. Secrets must not pass through Renderer state, command-line arguments, logs, or unprotected environment variables. Use the existing protected secret boundary and explicit user approval.

### General local-service lifecycle

Services Hub must show whether a component is Managed, Connected, Discovered, or Unmanaged. Start/Stop/Restart controls are available only when the adapter has the required ownership and capability. DevKit must never terminate an arbitrary process merely because it occupies a known localhost port. For discovered or externally managed processes, show status and connection options without claiming ownership.

## 5.1 Core

**[TARGET]** Core is the stable platform layer. It should own:

- Workspace identity and initialization.
- Workspace configuration and manifests.
- Component and integration registry.
- Permissions and trust boundaries.
- Event and operation contracts.
- Coordination between Runtime, integrations, and Inspector.
- Platform-level logging and diagnostics.

Core should not contain the business logic of every connected product.

## 5.2 Runtime

Runtime is the execution foundation for managed components.

Responsibilities:

- Starting and stopping processes.
- Tracking process identity and ownership.
- Managing lifecycle state.
- Handling startup failures and crashes.
- Capturing output and logs.
- Supporting graceful shutdown where implemented.
- Enforcing process boundaries and resource limits where practical.
- Managing dependency and runtime resolution.
- Preventing unmanaged child processes from being silently orphaned.
- Exposing stable lifecycle operations to higher layers.

Runtime must be independent of the visual UI. UI restarts should not accidentally corrupt service state.

## 5.3 Integration / Adapter layer

Each external system should be integrated through an adapter with a defined contract.

An adapter should declare:

- Identity and supported version range.
- Connection or installation mode.
- Capabilities.
- Required permissions.
- Configuration schema.
- Authentication requirements.
- Health and diagnostic capabilities.
- Supported lifecycle actions.
- Data ownership and retention semantics.
- Update behavior and compatibility constraints.

Do not assume every integration can be started, stopped, updated, or deleted by DevKit. The adapter must declare what is actually supported.

## 5.4 Service Intelligence

**[DECIDED]** Service Intelligence is an accepted architectural direction.

It should understand the workspace as a graph of components and dependencies, rather than as a flat list of applications.

It should know, where information is available:

- Which services exist.
- Which are running, stopped, unhealthy, or unavailable.
- Which services depend on others.
- Which versions are installed.
- Which runtime or configuration a service requires.
- Which services must start before another service.
- Which components are affected by a change.
- Which operations are safe or unsafe given the current state.

Service Intelligence is a coordination and state-understanding capability. It is not the same thing as Inspector: Intelligence understands and coordinates the environment; Inspector evaluates health, changes, quality, and potential defects.

## 5.5 Orchestration

**[TARGET]** Orchestration uses Runtime and Service Intelligence to execute multi-step workflows.

Examples:

- Start a service and its dependencies in the correct order.
- Stop a group of related services.
- Prepare an isolated test environment.
- Run a build, test, and packaging sequence.
- Execute an update workflow with rollback boundaries.
- Coordinate an Inspector validation cycle.

Operations should have explicit state, progress, cancellation semantics, and logs.

---

# 6. Main product areas

The sections below describe the target product surface. Their presence in this document does not mean they have been implemented.

## 6.1 Home / Workspace Overview

**[TARGET]** The home screen should provide a compact view of the developer's environment:

- Workspace health.
- Connected and managed services.
- MCP availability.
- AI tooling availability.
- Recent projects and activity.
- Recent Inspector findings.
- Pending updates.
- Failed operations.
- Quick access to common actions.

The home screen should prioritize actionable information, not become a wall of metrics.

## 6.2 Services

**[TARGET]** A central catalog of services with:

- Name, type, version, and ownership mode.
- Status and health.
- Dependencies.
- Runtime requirements.
- Start, stop, restart, and update actions where supported.
- Logs and diagnostics.
- Configuration access.
- Data and installation locations.
- Inspector history.

Service controls must respect adapter capabilities and user permissions.

## 6.3 MCP & Integrations

**[DECIDED]** MCP management is a first-class DevKit area.

The user already has local MCP servers that contain or use their own APIs, tokens, keys, configuration, build, and startup logic. DevKit should become the unified management interface for these MCP components.

**[TARGET]** Capabilities:

- Discover and register local MCP servers.
- Display server identity, version, capabilities, and status.
- Inspect exposed tools and resources.
- Manage startup and shutdown for managed servers.
- Manage environment/configuration references.
- Protect API keys and tokens.
- Show logs and connection errors.
- Validate MCP protocol compatibility.
- Track dependencies and runtime requirements.
- Support updates and isolated validation.
- Distinguish managed servers from externally running servers.

Do not expose secret values in logs, UI diagnostics, or Inspector reports.

MCP is an integration protocol and tool boundary, not a blanket authorization to execute every tool. Each server and tool requires a trust and permission model.

## 6.4 Storage & Knowledge

**[DECIDED]** Storage and knowledge systems should have a dedicated settings and management area.

Initial systems explicitly discussed:

- Karakeep — bookmarks, saved content, lists, tags, and related knowledge organization.
- Obsidian — detailed notes and personal knowledge vaults.
- Other disks, drives, and storage services already used by the user.

**[TARGET]** DevKit should provide:

- Connection status.
- Workspace and vault selection.
- Data source registration.
- Search entry points or federated search where supported.
- Sync/connection diagnostics where applicable.
- Storage usage and availability where APIs expose it.
- Permission and access management.
- Clear distinction between local data and remote data.
- Import/export and migration support where justified.

DevKit should not duplicate all Karakeep or Obsidian functionality. It should connect to them, surface useful workflows, and preserve each product's own data model.

### Karakeep visual and interaction reference

**[DECIDED]** Karakeep is the primary visual and interaction reference for DevKit's information architecture and general UX direction.

Use it as inspiration for:

- Clear navigation.
- Well-organized collections and categories.
- Compact cards and information density.
- Fast search and filtering.
- Clean presentation of saved items and metadata.
- Predictable interaction patterns.

This does not mean copying Karakeep's UI or turning DevKit into a bookmark manager. DevKit needs its own identity and information hierarchy.

### Obsidian integration boundary

Obsidian is a knowledge editor and vault ecosystem. DevKit should connect to existing vaults rather than assume it owns them. The adapter must understand vault paths, availability, and any synchronization method selected by the user.

## 6.5 Identity, Authentication & Secrets

**[DECIDED]** The user has established a centralized source for authentication data used across services and accounts, including drives and storage services. DevKit should integrate with this existing source rather than inventing an unnecessary duplicate.

**[TARGET]** DevKit's identity area should provide a coherent way to manage:

- Authentication providers and connected accounts.
- Credential references.
- API keys and tokens.
- Access scopes and permissions.
- Expiration and renewal state where available.
- Which services depend on which credentials.
- Secret availability without exposing secret contents.
- Credential rotation workflows where supported.

### Security principles

- Prefer references to a dedicated credential store over copying secrets into every service configuration.
- Never commit credentials to Git.
- Never print secret values in logs or Inspector reports.
- Restrict access by component and operation.
- Keep secret storage encryption and key management separate from ordinary workspace settings.
- Avoid putting secrets in command-line arguments where they may be exposed in process listings.
- Provide explicit backup and recovery semantics.
- Avoid claiming that encryption is secure without specifying key ownership, unlock, recovery, and threat model.

**[OPEN]** The exact identity/secret provider, storage format, unlock model, and integration API must be verified from the user's existing setup before implementation. Do not guess provider names or copy credentials into DevKit merely for convenience.

## 6.6 AI & Multi-AI Aggregator

**[DECIDED]** Multi-AI Aggregator is part of the intended DevKit ecosystem and should receive a dedicated product/settings area.

**[TARGET]** Integration capabilities:

- Detect or register the Aggregator installation.
- Display version and connection state.
- Manage its lifecycle if it is a managed component.
- Show provider/model configuration status without exposing secrets.
- Expose relevant diagnostics and logs.
- Track updates.
- Run Inspector validation on new versions.
- Preserve Aggregator as a separable component.

DevKit should not reimplement the Aggregator's model routing or provider logic. It should integrate with and manage the existing product through supported interfaces.

## 6.7 Projects & Developer Workflow

**[DECIDED]** DevKit should act as a workspace for the developer, not merely a launcher for personal services. It should eventually support workflows around projects and product development.

**[TARGET]** Capabilities may include:

- Project registry.
- Repository and workspace linking.
- Project-specific service dependencies.
- Development environment status.
- Build and test commands.
- Packaging and release workflows.
- Git status and common operations.
- Project documentation entry points.
- AI agent workflow integration.
- Project-level Inspector reports.

A project can depend on several managed or connected services. DevKit should make those dependencies visible and help coordinate them.

## 6.8 Build, Package & Release

The user specifically wants DevKit to simplify building, packaging, updating, and launching projects and services.

**[TARGET]** A workflow engine should eventually support:

- Build profiles.
- Environment-specific configuration.
- Dependency checks.
- Test stages.
- Artifact collection.
- Packaging.
- Version metadata.
- Release validation.
- Update and rollback strategies.
- Repeatable operation logs.

The first implementation should support one complete real workflow rather than a generalized pipeline editor for every possible build system.

## 6.8.1 MCP Library

**[TARGET]** MCP Library is a first-class product area for discovering, evaluating, connecting, and managing MCP servers. Discovery should use official registries and provider APIs where available, with source and freshness visible to the user.

Expected capabilities, delivered incrementally:

- Search and browse available MCP servers from supported official registries/APIs.
- Display source, description, version/release metadata, supported transports, capabilities, compatibility, requirements, and permissions where supplied by the source.
- Distinguish registry metadata from locally installed or connected instances.
- Support local STDIO and remote Streamable HTTP connection configurations where compatible.
- Save, edit, validate, connect, disconnect, and remove connection configurations with explicit trust/permission review.
- Show lifecycle ownership and health accurately; do not imply that every discovered server is installed or running.
- Treat third-party package metadata and installation instructions as untrusted input. Never execute package commands without explicit user confirmation.

MCP Library is not a promise to host or mirror every registry. Prefer official APIs and registries; identify unsupported sources rather than silently scraping or fabricating metadata.

## 6.8.2 Skills Library

**[DECIDED]** Skills are a separate catalog and lifecycle domain from MCP servers. A Skill is an instruction/capability package for an AI agent or development workflow; it is not an MCP server and must not be represented as one.

**[TARGET]** Skills Library should support, subject to official source/API availability:

- Browse and search Skills from supported official repositories, registries, or APIs.
- View source, author/maintainer, version, description, compatibility, required tools, permissions, and installation contents when available.
- Inspect the Skill's instructions and file manifest before enabling it.
- Install/connect, enable, disable, update, and remove Skills with explicit confirmation and a clear destination.
- Show installed location, source provenance, version, update availability, and trust state.
- Warn about instructions that request secrets, broad filesystem access, network access, or other sensitive capabilities.
- Preserve user edits and provide safe update/rollback behavior where practical.

Skills Library is a planned product capability and is **not asserted to exist in the current implementation**. Do not invent a central official API where a source does not provide one; use supported official repository interfaces and clearly label their limitations.

## 6.8.3 Services Hub and localhost services

**[TARGET]** Services Hub is the unified operational view for local and external services that participate in the Workspace. It should include registered local MCP servers, MCPWorkers Manager, LocalMCP, LocalMCP Tunnel, Chat2Agent, and other supported localhost/API services as adapters become available.

For each service, display only information actually available from its adapter: ownership mode, status, version, endpoint, health, dependencies, logs, and supported actions. Support Start/Stop/Restart only for DevKit-managed processes or explicitly authorized lifecycle integrations. A localhost endpoint alone does not grant process ownership.

## 6.9 Settings

**[DECIDED]** Settings should have clear areas for the major ecosystem domains.

Initial conceptual sections:

1. Workspace & Environment.
2. Identity & Access.
3. MCP & Integrations.
4. Storage & Knowledge.
5. AI & Multi-AI Aggregator.
6. Services & Runtime.
7. Inspector.
8. Projects & Development.
9. Extensions.
10. Updates, Backup & Recovery.

The final navigation structure should be validated against actual MVP workflows. Do not create empty settings sections merely to make the product look complete.

---

## 6.10 AI Agent Development Infrastructure

**[DECIDED]** DevKit is the Control Plane for project-aware AI development capabilities. MCPWorkers and the specific worker/runtime remain the Runtime Plane; AI agents, IDEs, and other supported clients are Consumers. DevKit centralizes discovery, provenance, reviewed configurations, project-to-tool assignments, Agent Profiles, approvals, and status presentation. It is not a mandatory proxy for every tool call.

### Ownership boundaries

- DevKit owns MCP/Skills catalogue metadata, project Agent Profiles, client adapters, trust/approval state, and non-secret configuration intent.
- MCPWorkers owns Worker Definitions/Instances, package installations, worker configuration, worker lifecycle, Registry persistence, and its versioned API.
- DevKit communicates with MCPWorkers through its documented Public API. It must not read or write private Registry, token, or worker installation files.
- LocalMCP is a candidate MCP gateway because its documented capability matrix includes external MCP discovery/lifecycle/tool forwarding and Skill loading. Use only its verified supported configuration and lifecycle interface; never edit private runtime files behind it.
- Generic third-party MCP servers are not automatically assumed to be MCPWorkers Worker Definitions. Use a verified Worker adapter, a supported LocalMCP gateway path, or DevKit's existing direct MCP connection adapter as appropriate.
- DevKit Runtime may stop the MCPWorkers Manager only when it owns the process it launched. Worker Instance lifecycle remains an explicit MCPWorkers API operation.

### Project Agent Profiles

**[TARGET]** A project Agent Profile is a versioned declaration of required and optional MCP servers, Skills, supported client targets, capabilities, permissions, and logical secret references. The proposed project path is .devkit/agent-profile.json; finalize its schema through a tested vertical slice.

Profiles are opt-in and composable. The default profile must remain small. A profile stores no resolved token, password, private key, or other secret value. Runtime state remains authoritative in the runtime that executes the capability.

Initial profiles are Core Development, Feature Development, Codebase Analysis, Security Review, and Release/Delivery. The detailed contract and acceptance criteria are in docs/architecture/AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md.

### Project instructions, decisions, and memory

- AGENTS.md is the concise project-level instruction file: architecture boundaries, entry points, commands, test expectations, security constraints, and definition of done. DevKit must preserve user edits and offer a diff/merge rather than overwrite blindly.
- Architecture docs describe current boundaries and module responsibilities.
- ADRs record durable decisions, alternatives, rationale, consequences, and supersession. Do not create ADRs for routine implementation details.
- Task/feature documents hold scope, acceptance criteria, plan, and verification evidence.
- Optional Neural Memory may store historical observations, but is advisory only and never overrides current source code, tests, architecture docs, or ADRs.

### Single-agent Change-Scoped Developmen

**[DECIDED]** The default project workflow assumes one primary agent. Use S/M/L complexity routing and a focused sequence: scope the change; retrieve only relevant context; trace the affected execution path; establish an evidence-based diagnosis; implement the smallest coherent correction; run targeted checks first; expand validation in proportion to impact; inspect the changed diff; update durable documentation only when necessary.

A repository-wide audit is reserved for systemic issues, broad architecture changes, migrations, security-sensitive changes, cross-domain defects, and major stage acceptance. Re-auditing unchanged components after every small task is not the default.

Feature-ADR Pipeline is a Skill/workflow source, not an MCP server. Adapt its useful requirements, research, ADR, planning, implementation, and verification stages to the single-agent workflow. Mandatory swarm/fleet/subagent stages are out of scope.

### Tool selection policy

- **CodeGraph:** first additional MCP pilot for project-local structure, symbol relationships, call paths, and impact analysis. Keep its index project-scoped and verify freshness against source.
- **Context7:** retain for current external library/framework documentation; it does not index the user's own repository.
- **Feature-ADR Pipeline:** adapt as a versioned Skill set with S/M/L routing; no mandatory parallel-agent execution.
- **Semgrep:** optional Security Review capability; static-analysis findings require triage and do not replace tests or runtime validation.
- **Neural Memory:** defer until project instructions, current architecture docs, ADRs, and CodeGraph have been evaluated. Adopt only after a measurable pilot; never make it authoritative.
- **Serena:** do not add alongside CodeGraph by default. Add only if a concrete symbol navigation/editing gap remains.

### Client independence

DevKit must not make GPT.com/ChatGPT Web the primary runtime. Local agents must remain usable through the supported local MCPWorkers/LocalMCP path. Remote clients require their own compatible, secure transport and adapter. Never expose a loopback service directly to the public Internet; report unsupported client capabilities explicitly.

The normative architecture, accepted decision, templates, and implementation backlog are:
- docs/architecture/AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md
- docs/architecture/decisions/ADR-0001-devkit-agent-control-plane.md
- docs/templates/AGENTS.md.template
- docs/templates/ADR.md.template
- docs/plans/AI_AGENT_DEVELOPMENT_ENABLEMENT.md

This capability belongs to Stage 5 Developer Workflow. It does not expand the in-progress Stage 2 Unified Workspace MVP or change its acceptance gates.

# 7. Inspector — independent monitoring and quality subsystem

## 7.1 Purpose

**[DECIDED]** Inspector should be a distinct and important DevKit capability: an observer of managed and connected services that detects problems and evaluates changes, especially updates.

Inspector should help answer:

- Is this service healthy?
- What changed in the new version?
- Does the update introduce errors or regressions?
- Are dependencies compatible?
- Do the important workflows still work?
- What exactly failed, and what evidence supports the finding?
- After a fix, has the problem actually been resolved?

Inspector should not be a decorative dashboard or a generic AI chatbot. It should execute reproducible checks and produce actionable findings.

## 7.2 Two analysis layers

**[PROPOSAL]** Inspector should combine deterministic validation and AI-assisted analysis.

### Deterministic analysis

Use tools and checks that produce reproducible evidence:

- Unit and integration tests.
- E2E tests where appropriate.
- Static analysis and type checking.
- Build verification.
- Dependency and vulnerability checks.
- Configuration validation.
- Health checks.
- Log/error analysis.
- API/protocol compatibility checks.
- Performance baselines where meaningful.
- Artifact integrity and version checks.

### AI-assisted analysis

AI can help with:

- Summarizing release changes.
- Identifying risky code paths.
- Explaining unfamiliar failures.
- Finding likely root causes.
- Reviewing architecture and dependency impacts.
- Grouping related findings.
- Suggesting targeted reproduction steps.
- Preparing a concise report for a developer or another AI agent.

AI conclusions must be labeled as analysis or hypotheses unless backed by executable evidence. AI must not fabricate test results or claim that a test ran when it did not.

## 7.3 Update validation workflow

The user's intended example is Multi-AI Aggregator:

1. Inspector detects a new Aggregator version or a user requests a check.
2. Inspector obtains release metadata and the available change information.
3. It identifies the installed version, configuration, dependencies, and relevant previous findings.
4. It obtains the candidate update in a controlled way.
5. It prepares an isolated validation environment.
6. It runs the relevant test/build/security/compatibility checks.
7. It records logs, test outcomes, versions, and artifacts.
8. It produces a report with severity and evidence.
9. The user shares the report with an AI development assistant to fix problems.
10. After a new build or fix, Inspector repeats the relevant checks.
11. When acceptance criteria pass, Inspector marks the candidate as validated.
12. Release or replacement of the production version remains subject to the configured approval policy.

**Important:** Inspector must not automatically replace a working production service with an untrusted candidate. The default should be isolated validation and an explicit promotion step.

## 7.4 Inspector report forma

A useful report should include:

- Component and version.
- Candidate version, if applicable.
- Environment and test profile.
- Timestamp.
- Checks executed.
- Checks passed, failed, skipped, or not available.
- Findings with priority (P0–P3).
- Reproduction evidence.
- Relevant log excerpts with secrets redacted.
- Affected dependencies and workflows.
- AI hypotheses clearly separated from verified facts.
- Recommended next action.
- Comparison with previous validation.

Each finding should include location or affected component, impact, evidence, priority, and a recommended correction.

## 7.5 Inspector trust and safety boundaries

- Do not execute untrusted update code in the primary workspace.
- Use isolation appropriate to the platform and threat model.
- Restrict filesystem, network, and credential access for test processes.
- Do not provide production secrets to test candidates by default.
- Treat logs and service output as untrusted input.
- Redact secrets before persistence or AI analysis.
- Require approval for destructive or externally consequential actions.
- Record what was actually tested and what was not.

## 7.6 Inspector MVP boundary

**[PROPOSAL]** The first Inspector MVP should be deliberately narrow:

- Register one managed or connected service.
- Read its version and health state.
- Run a defined set of validation commands/checks.
- Capture and redact logs.
- Produce a structured report.
- Re-run checks after a new build.
- Track pass/fail history.

Automatic update discovery, generalized risk analysis, multiple isolated execution backends, and team policy management can follow after this vertical slice works.

---

# 7.7 Planned developer utilities (F-09 to F-11)

These three focused developer tools remain part of the product roadmap. They are separate feature deliverables and must not be confused with the platform-level Inspector subsystem. Their exact delivery order is F-09, F-10, then F-11 unless the user explicitly reprioritizes them. They are not represented as implemented by inclusion in this specification.

### F-09 — Color Converter & Palette

**[TARGET]** A compact color utility for everyday UI/frontend work. Initial scope: convert and synchronize HEX, RGB, and HSL values; copy individual formats; edit/select colors; generate and manage palette swatches and common color harmonies; preserve useful recent/favorite palettes. Contrast checking and accessibility guidance may be added as a focused extension after the core workflow is complete.

### F-10 — Port Inspector

**[TARGET]** A local diagnostics utility for inspecting listening TCP/UDP ports and, where OS permissions allow, associating a port with process name, PID, protocol, and local address. The MVP is diagnostic/read-only. It must not kill processes or change firewall/network settings. Any later process-control action requires a separate explicit permission and confirmation design.

### F-11 — Project Inspector

**[TARGET]** A project-analysis utility that builds a useful, evidence-based overview of a selected repository or project. Initial scope: detect project structure and technologies, summarize key configuration and scripts, produce an architecture/directory overview, and generate a bounded Markdown context pack suitable for developer/AI-agent workflows. Follow-up analysis may cover dependency health, configuration consistency, test/build status, and maintainability signals. It must respect ignore rules, avoid collecting secrets or sensitive files, and clearly identify inferred versus directly observed facts.

### Relationship to the Inspector subsystem

The standalone **Project Inspector (F-11)** is a user-facing developer utility for understanding a project. The platform **Inspector subsystem (Section 7)** is the broader validation and monitoring system for services, updates, quality gates, and evidence reports. They may share analysis engines and report primitives, but must have separate responsibilities and UI workflows.

# 8. Design system and user experience

## 8.1 Visual reference

**[DECIDED]** Use Karakeep as the primary reference for organization, clarity, search, and information presentation.

The target should feel like a professional developer workspace, not a gaming launcher or an overloaded monitoring console.

## 8.2 Existing visual preferences

The earlier Dev Toolbox design direction established:

- Dark, minimal interface.
- Modern developer-product aesthetic.
- Subtle and smooth animation.
- Restrained glow and shadow effects.
- Avoid harsh neon and toxic colors.
- Avoid an overly blue interface.
- A dark burgundy accent around `#74162e`, used sparingly.
- Main palette based on black, charcoal, and gray, with restrained burgundy / red-purple / orange-black accents.

These are useful existing preferences, not a finalized design token specification. They should be reconciled with the Karakeep reference and tested for accessibility and contrast.

## 8.3 UX principles

- Fast navigation and search.
- Clear hierarchy and consistent terminology.
- Compact but readable information density.
- Progressive disclosure for advanced configuration.
- Visible status and clear error feedback.
- No unnecessary dashboards or decorative metrics.
- Consistent interaction patterns across integrations.
- Long-running operations must expose progress and cancellation where safe.
- Destructive actions must be clearly identified.
- Keyboard navigation and accessibility should be considered from the start.

---

# 9. Ecosystem and connected projects

This section records the projects and systems explicitly relevant to the DevKit ecosystem. It distinguishes systems to integrate from products that are not automatically part of DevKit.

## 9.1 Dev Toolbox — original project and code lineage

**[CURRENT]** DevKit began as a small Electron-based personal developer utility application, previously referred to as Dev Toolbox.

The existing project/repository is:

- GitHub repository: `https://github.com/Ten-Dark/DevKit`
- Local working directory recorded in prior work: `C:\Users\Sondr\Projects\DevKit`
- The user explicitly required using one original project directory, without creating copies or worktrees, during the Runtime work.

The original application included:

- Home page.
- Tools page.
- Project to Markdown.
- XMind to Markdown.
- Settings.
- Command palette / quick navigation.
- Electron main/preload/renderer separation.
- IPC-based communication.
- `contextIsolation: true`.
- `nodeIntegration: false`.
- Settings persistence.
- Path validation and restricted external URL opening.
- Project-to-Markdown cancellation and progress.
- File size/output limits and exclusions for sensitive files.
- XMind multiple-sheet handling and error handling.
- Vitest test infrastructure.

Historical Phase 2 status from 2026-11-11/12:

- Persistent `settings.json`.
- IPC hardening.
- Project-to-Markdown improvements.
- XMind conversion improvements.
- Settings page.
- 31 tests reported at that milestone.

The source snapshot available from the earlier project showed a structure containing `src/main`, `src/preload`, and `src/renderer`, with features for Project to Markdown and XMind to Markdown. This is historical context, not a verified current tree.

**[DECIDED]** DevKit should evolve from this product lineage, but the platform architecture must be chosen based on actual requirements rather than preserving the original stack by default.

## 9.2 Karakeep

Role: connected bookmark and knowledge storage system.

Known user context:

- Karakeep is the unified repository for bookmarks, saved information, and organized notes.
- Tags and Smart Lists were considered sufficiently configured for the time being.
- The user chose to move to the integrations phase rather than finish a formal daily workflow phase.
- Integrations under consideration included Obsidian, GitHub, Telegram, and AI agents.
- Karakeep is the primary visual/interaction reference for DevKit.

DevKit target role:

- Connect to Karakeep.
- Provide a central entry point and useful contextual workflows.
- Display connection and service status.
- Support search and navigation where the API permits.
- Avoid duplicating Karakeep's data model or taking ownership of an externally managed instance without explicit adoption.

## 9.3 Obsidian

Role: detailed personal knowledge base and notes.

Known user context:

- Obsidian contains more detailed notes than the user's Karakeep collection.
- It is part of the desired storage/knowledge ecosystem.

DevKit target role:

- Register one or more vaults.
- Detect availability and path.
- Provide access and contextual navigation.
- Integrate with other knowledge sources where technically justified.
- Preserve vault ownership and avoid destructive changes.

## 9.4 Local MCP ecosystem

Role: local tool and API layer for AI agents and development workflows.

Known user context:

- The user has local MCP servers.
- These MCPs contain or use their own APIs, tokens, keys, build/startup logic, and related configuration.

DevKit target role:

- Register and manage MCP servers.
- Standardize metadata, status, lifecycle, permissions, and diagnostics.
- Manage secrets through the existing credential source where possible.
- Expose MCP tools to authorized workflows.
- Support update and Inspector validation.

The actual MCP inventory, server names, runtime requirements, and supported management APIs must be discovered from the user's existing local environment; do not invent them.

## 9.5 Multi-AI Aggregator

Role: existing multi-AI integration/aggregation product.

Known user context:

- Multi-AI Aggregator is an existing project/service in the user's environment.
- A browser bridge/connection issue was previously discussed.
- The user wants it to be managed and inspected through DevKit.

DevKit target role:

- Register the service.
- Expose health, version, connection state, and diagnostics.
- Manage lifecycle if it is owned/managed by DevKit.
- Use Inspector for candidate update validation.
- Preserve the Aggregator as a distinct component.

The precise API and installation details must be verified from the current project and local MCP/tool environment.

## 9.6 Central authentication and credential source

Role: centralized authentication data for services, accounts, drives, and storage.

Known user context:

- A unified point of access to authentication information for services and accounts has been established.
- It includes access to drives and storage services.
- Local MCP components also have their own API keys and tokens.

DevKit target role:

- Integrate with this source.
- Avoid a second competing credential store.
- Use scoped credential references.
- Display status and dependency relationships without revealing secret values.

The provider name, API, access model, and storage format are not established in this document and must be verified.

## 9.7 Drives and external storage

Role: file storage and data sources.

DevKit target role:

- Connect supported drives and storage services.
- Show availability and connection state.
- Allow authorized workflows to access them.
- Preserve ownership and retention rules.
- Distinguish mounted/local paths from remote provider data.

Do not assume that every drive or storage provider supports the same API or lifecycle operations.

## 9.8 GitHub and Gi

GitHub and Git are relevant to the user's development workflow and the DevKit repository itself.

Potential DevKit capabilities:

- Repository registration.
- Branch and commit status.
- Pull request context.
- Release and artifact information.
- Project-level automation.

These are target integrations, not a claim that all such features are already implemented.

## 9.9 Other user projects — not automatically DevKit components

The following projects exist in the wider user context but should not automatically become core DevKit modules:

- **N6 Control:** a local management panel for a Netis N6 router running OpenWrt. It may be a future connected service or an example of a managed project, but it is not currently a core DevKit requirement.
- **NOVA Music:** a separate music-service concept for Android and Web. It is not part of the current DevKit MVP.
- **WWM Knowledge Hub:** a Telegram Mini App knowledge base for a game guild. It is not part of the current DevKit MVP.
- Other personal or experimental projects should be registered as projects only when useful; they should not be pulled into the platform's core by default.

This boundary prevents DevKit from becoming a container for every unrelated application the user has ever built.

---

# 10. Runtime — current foundation and status

## 10.1 Why Runtime comes firs

**[DECIDED]** Runtime is the foundation for the independent workspace. The user explicitly instructed not to switch to broader platform features until the Runtime MVP is closed.

Runtime establishes reliable process ownership and lifecycle before DevKit orchestrates a larger service ecosystem.

## 10.2 Verified Stage 1 outcome

**[CURRENT — VERIFIED 2026-11-24]** Stage 1 Windows Runtime MVP acceptance has passed on the recorded Windows 11 x64 validation host and has been integrated into `main` through [PR #13](https://github.com/Ten-Dark/DevKit/pull/13).

Two-hour native Runtime soak:

- Duration: **7,201 seconds**.
- Lifecycle cycles: **1,779,051**.
- Batches/samples: **17,961**.
- Process handles: **172 -> 172**, minimum/maximum 172.
- Crash events: **0**.
- `RUNTIME_SOAK_PASS` present.
- Supervisor status: `COMPLETED`; supervisor exit code: **0**.
- `exit-code.txt`: **0**; stderr empty.

The supervised Windows Scheduled Task wrapper initially reported a nonzero task result despite a successful supervisor result. Root cause was the invalid PowerShell parameter form `-Confirm:False` in watchdog cleanup. It was corrected to `-Confirm:$false`. A supervised 40-second smoke run then confirmed supervisor `COMPLETED`, exit code 0, Task Scheduler `LastTaskResult = 0`, event 201 return code 0, empty stderr, and stable handles (172 -> 172).

Local validation on the merged Runtime baseline:

- `npm run release:check` — passed.
- ESLint: 0 errors, 6 warnings.
- TypeScript: passed.
- Unit/integration suite: **400/400 tests**, 35 test files on the Runtime-only baseline.
- Development Electron E2E: **2/2**.
- Native lifecycle and fault-injection suites: passed.
- NSIS packaging and ASAR validation: passed.
- Packaged Electron E2E: **4/4**.
- `npm audit` and `npm audit --omit=dev`: **0 vulnerabilities**.

GitHub Actions run `45317425826` for PR #13 completed successfully: Unit Tests, TypeScript Check, Integration Tests, Dev Electron E2E, Production Build, Production Package (dist), ASAR Validation, Packaged Electron E2E, and NSIS Installer E2E all passed. The Create GitHub Release job was skipped as expected for a pull-request event. The workflow emitted non-blocking maintenance annotations for GitHub Actions using Node.js 20 and a missing optional failure-artifact path; neither affected the successful job conclusions.

This evidence establishes MVP acceptance on one Windows 11 x64 host. It is **not** a blanket production-readiness declaration and does not establish compatibility with every Windows version or host policy.

## 10.3 Remaining production gates

Keep these separate from Stage 1 MVP acceptance:

- Validate installed NSIS behavior across the Windows versions and host parent-Job policies that DevKit intends to support.
- Complete broader crash recovery and shutdown/restart validation.
- Validate update, rollback, and recovery behavior.
- Complete the security review and release-signing policy.
- Establish a documented support matrix before claiming broad Windows support.
- Linux/macOS remain future targets and require dedicated platform adapters and packaged validation.

The detailed evidence and remaining gates are maintained in `docs/architecture/STAGE_1_RUNTIME.md` and `docs/architecture/WINDOWS_PROCESS_CONTROL.md`.

## 10.4 Repository and branch state

**[CURRENT — VERIFIED 2026-11-24]**

- Repository: `https://github.com/Ten-Dark/DevKit`
- Local project path: `C:\Users\Sondr\Projects\DevKit`
- `main` is synchronized with `origin/main` at merge commit `71bcb9c266c4a494e81243017037c7744823b555`.
- PR #13 (`feat/runtime: complete Windows Runtime MVP acceptance`) is merged.
- Runtime commits include `8d96d43` (Windows process lifecycle hardening) and `09972df` (supervised soak evidence and wrapper fix).
- Stage 0 and Stage 1 are integrated into `main`.
- The active implementation branch is `feat/unified-workspace-mvp`, currently at local HEAD `2e2d874` (`feat(workspace): add unified workspace foundations`). It is one commit ahead of `origin/main` and has uncommitted Stage 2 work. The working tree includes changes to MCP Registry/Hub, managed stdio transport and native process attachment, the CommonJS bootstrap build/package path, local integrations, Home/dashboard, Storage providers/UI, IPC/preload contracts, E2E tests, and Stage 2 documentation. It also contains the user's untracked `docs/archive/` directory and new integration/storage adapter files. These changes are **uncommitted and not yet accepted**; preserve all of them.
- The pre-existing MCP & Integrations backup remains in `stash@{0}` (`WIP MCP and Integrations preserved during Runtime integration`). Do not drop it until the restored work has been validated and safely recorded.
- During the 2026-11-24 validation, the initial `npm run check` exposed a malformed duplicate `bookmarksPage` fixture in the untracked `src/main/storage/karakeep-provider.test.ts`. The duplicate declaration and trailing fragment were removed. The subsequent E2E run exposed a concurrent directory-creation race in `ensureSafeDirectory`: parallel workspace subsystems could both observe `ENOENT`, after which one `mkdir` received `EEXIST`. The helper now re-checks the raced path with `lstat` and accepts only a real directory (still rejecting symlinks/non-directories); a concurrent-creation regression test was added.
- After the managed MCP stdio process-tree changes, current validation passed on 2026-11-24: `npm run check` — **488 tests across 46 files**, TypeScript clean, ESLint 0 errors and 0 warnings; `npm run build` — passed, including native attach-before-launch ownership checks, unrelated-PID rejection, command-wrapper descendant containment, Windows lifecycle stress, fault-injection, packaged-ASAR provider checks and crash containment; `npm run test:e2e:dev` — **3/3** passed, including a real MCP stdio fixture that spawns a descendant and verifies both the configured MCP command and its descendant exit after disconnect.
- `npm run dist` — passed; generated the Windows x64 NSIS installer for application version `1.0.4`.
- `npm run validate:asar` — passed; `app.asar` contains **7,093 files** and all required entry points/native resources are present, including the unpacked CommonJS MCP bootstrap and its `cross-spawn` dependency chain.
- `npm run test:e2e:packaged` — **5/5** passed against the unpacked production package, including managed MCP stdio descendant cleanup.
- Isolated NSIS installation of Dev Toolbox **1.0.4** — installer exit code **0**; installed-app E2E **5/5**, including managed MCP stdio descendant cleanup; uninstaller exit code **0**; temporary installation directory removed.
- The installer is unsigned because no signing certificate is configured. These results establish the current Windows x64 package baseline, not full Stage 2 acceptance or broad production readiness. Stage 2 remains in progress and unaccepted.
- The Runtime acceptance documentation is already committed and integrated through PR #13. The two-hour soak evidence is recorded in `docs/architecture/STAGE_1_RUNTIME.md` and `docs/architecture/WINDOWS_PROCESS_CONTROL.md`; it must not be reopened as an active blocker. No commit, push, merge, reset, or stash operation was performed during this Stage 2 reconciliation. `docs/archive/` remains untracked and preserved.

Always inspect current `git status`, branch, remotes, and commit graph before further changes. Preserve unrelated user work.

## 10.4.1 Current project stage snapshot (document update: 2026-11-27)

**[CURRENT — REPOSITORY METADATA VERIFIED ON 2026-11-27; TEST EVIDENCE REFERENCED IN SECTION 10.4.2]**

- Stage 0: complete and integrated.
- Stage 1: Runtime MVP accepted on Windows 11 x64 and integrated into `main`; its broader production-readiness follow-ups remain separately tracked.
- Stage 2: Unified Workspace MVP is the active stage and remains **in progress / not accepted**. The latest recorded test evidence is dated 2026-11-27 (Section 10.4.2); the older 2026-11-24 evidence remains historical in Section 10.4.
- Immediate Stage 2 priority: complete ownership-aware MCPWorkers Manager lifecycle through DevKit Runtime, authenticated live Manager/API acceptance, packaged/installed cross-project acceptance of Manager lifecycle, and the final post-integration Stage 2 audit. Karakeep connection-only status is already user-confirmed; it is not an outstanding acceptance gate.
- Stage 3: F-09 Color Converter & Palette → F-10 Port Inspector → F-11 Project Inspector; planned, not asserted as started or implemented.
- The MCPWorkers Manager lifecycle, Skills Library, and roadmap additions in this v1.1.1 document are product/architecture requirements. Their implementation status must be established from the current repository and runtime, not inferred from this document.

Do not treat the 2026-11-24 branch name, commit hash, test counts, or working-tree description as a verified 2026-11-27 snapshot. Re-check Git and tests before using them as current operational facts.

### 10.4.2 Repository snapshot recorded on 2026-11-27

**[CURRENT — REPOSITORY METADATA VERIFIED; TEST EVIDENCE TRANSCRIBED FROM STAGE 2 DOCUMENTATION]**

- Active branch: `feat/unified-workspace-mvp`; HEAD: `2e2d874` (`feat(workspace): add unified workspace foundations`).
- The working tree contains substantial modified and untracked Stage 2 work, including MCPWorkers client/UI, credential integration, Services/Storage/MCP work, tests, and documentation. Two legacy launcher batch files are deleted in the working tree; preserve those deletions. The untracked `$null`, `docs/archive/`, and other untracked work must also be preserved.
- The repository's Stage 2 document records the latest 2026-11-27 validation as 531 tests / 50 files, TypeScript and ESLint clean, build passed, development E2E 4/4, ASAR 7,102 files, and packaged E2E 5/5. These are documented results, not tests rerun during this specification reconciliation.
- Isolated NSIS installation and installed-app E2E evidence remains dated 2026-11-24 (installer/uninstaller exit 0; installed-app E2E 5/5). Do not merge this historical evidence into the 2026-11-27 test snapshot.
- The repository documentation explicitly leaves live authenticated MCPWorkers Manager acceptance and DevKit Runtime-managed Manager start/attach/shutdown open. The final post-integration Stage 2 audit and user-authorized main integration are also open.
- Karakeep connection-only status is user-confirmed as `Connected`; bookmark-content access is out of scope and prohibited. The KeePassXC-backed Karakeep credential-resolution path is separately unverified and must not be inferred from the connected status.


## 10.5 Immediate next action

**[DECIDED]** Proceed to Stage 2 — Unified Workspace MVP. Do not reopen or reimplement Stage 1. Keep the remaining Windows production gates visible as follow-up work, but do not let them block the next MVP stage unless a concrete Stage 2 dependency is found.

The Windows MCP stdio process-tree ownership task is complete: the trusted bootstrap is attached to a kill-on-close Job Object before the configured command launches, and its descendants inherit ownership. Native, development, packaged and installed-app evidence is recorded in `docs/architecture/WINDOWS_PROCESS_CONTROL.md` and `docs/architecture/STAGE_2_UNIFIED_WORKSPACE.md`. The separate MCPWorkers Manager process lifecycle is not complete: Runtime start/attach/readiness/shutdown, live authenticated Manager acceptance, packaged/installed lifecycle acceptance, and the final post-integration Stage 2 audit remain open. Karakeep connection-only status is user-confirmed as Connected and is not an open connectivity gate; the separate KeePassXC-backed Karakeep credential-resolution path remains unverified. Do not access bookmark content. Direct LocalMCP/Tunnel/Chat2Agent lifecycle adapters are transitional and are not separate Stage 2 acceptance gates once MCPWorkers is the selected management path. Retire those controls only after the MCPWorkers workflow is accepted. `docs/ROADMAP.md` and `docs/architecture/STAGE_2_UNIFIED_WORKSPACE.md` are the repository delivery and acceptance details; this master spec summarizes them.

# 11. Roadmap — major logical stages

The repository roadmap in `docs/ROADMAP.md` is the active delivery source of truth. The stages below summarize its current sequence and preserve the broader product targets described elsewhere in this specification.

## Stage 0 — Architecture Foundation

**Status:** [CURRENT — COMPLETE, INTEGRATED]

Scope:

- Product and architecture foundation.
- Initial architectural decisions and ADRs.
- Core / Workspace / Extensions boundaries.
- Runtime ownership, workspace layout, and platform adapter strategy.
- Service Registry, lifecycle, dependency, health/readiness, Vault/Storage, and Inspector foundations.
- Migration strategy and stage acceptance criteria.

The Stage 0 foundation is integrated into `main`.

## Stage 1 — Independent Runtime MVP

**Status:** [CURRENT — MVP ACCEPTED ON WINDOWS 11 x64; INTEGRATED INTO MAIN]

Goal: establish a safe, reliable execution foundation for the workspace.

Accepted scope:

- Workspace paths and runtime foundation.
- Process lifecycle and ownership.
- Crash containment and IPC/security boundaries.
- Service registry, configuration, structured logs, and health foundations.
- Native lifecycle and fault-injection validation.
- Packaged and installed-app validation on the recorded host.
- Supervised two-hour native soak.

Acceptance evidence is recorded in `docs/architecture/STAGE_1_RUNTIME.md`. Broader Windows production-readiness, recovery, signing, and compatibility gates remain open and must not be confused with MVP acceptance.

## Stage 2 — Unified Workspace MVP

**Status:** [IN PROGRESS — NOT ACCEPTED; MCPWorkers Runtime lifecycle and live acceptance remain open]

Goal: deliver the first coherent workspace experience that connects the existing Runtime to real services and integrations.

The active repository roadmap defines the MVP outcome as:

- Dashboard and workspace shell.
- Services Hub and service management UI.
- MCP Hub and integration entry points.
- OS-backed secret-protection boundary and read-only Storage integration foundations. The complete product Vault lifecycle is explicitly deferred from Stage 2.
- Real connections to selected existing services, preserving their ownership and lifecycle boundaries.

An earlier WIP snapshot on `feat/unified-workspace-mvp` passed an initial local check/build/dev-E2E/audit gate (431 tests, build passed, development E2E 2/2 after the dashboard addition, 0 npm audit vulnerabilities). Those figures are historical, not the latest validation. The latest recorded results and remaining checks are in section 10.4.2; older validation snapshots remain explicitly dated in section 10.4. Stage 2 is not yet completed or accepted. It includes:

- MCP Registry discovery/search and version metadata.
- Saved local stdio and remote Streamable HTTP connections.
- Manual MCP setup and safe connection lifecycle.
- Main-process credential encryption using Electron `safeStorage`.
- Local integration status for LocalMCP, LocalMCP Tunnel Edition, and Chat2Agent. Transitional direct lifecycle adapters are not the target control plane and are not separate Stage 2 acceptance gates; MCPWorkers is the selected lifecycle authority for these worker applications.
- Required end state — register MCPWorkers Manager as a Runtime-managed component with attach-to-existing behavior, ownership-aware start/stop/restart, readiness checks, and shutdown semantics. This is a mandatory Stage 2 acceptance requirement and is not yet implemented/accepted.
- MCP Library UI, IPC/preload contracts, and focused tests.
- Registry UI acceptance for search, cursor pagination, result metadata, and request errors; local status queries have a 15-second hard timeout and the UI remains usable while they are pending.
- Windows stdio connections use `ManagedStdioClientTransport`. A DevKit-owned CommonJS bootstrap waits on a random named-pipe handshake; native `attachManagedProcess` verifies that its PID is a direct child of the current DevKit process and attaches it to a private kill-on-close Job Object before the configured command is sent. Attachment rejects unrelated PIDs.
- The configured MCP command is launched only after successful attachment, using `cross-spawn` with shell disabled and inherited stdio. Command wrappers, the MCP server and further descendants inherit Job Object membership.
- Development and packaged E2E use a real stdio fixture that starts a descendant process and confirm that both the configured server PID and descendant PID exit after disconnect. Native tests also verify attach-before-launch and the cmd.exe → batch wrapper → Node launcher → Node server process tree.
- Read-only environment discovery confirmed the configured Projects root and integration files. LocalMCP reported running, a tunnel-client process was present, and Chat2Agent reported stopped; actual start/stop lifecycle operations were not executed.
- Karakeep connection/authentication-only status was confirmed by the user as `Connected`. This closes the connection-status requirement. It does not establish access to bookmark content, and DevKit must not list, search, preview, index, download, or otherwise access bookmarks. Do not create a competing credential store.

This WIP is not yet accepted. The latest validation evidence recorded in the Stage 2 document is dated 2026-11-27: 531 tests across 50 files, TypeScript and ESLint clean, build passed, development E2E 4/4, ASAR validation 7,102 files, and packaged E2E 5/5. Isolated NSIS installation/installed-app E2E evidence is older (2026-11-24) and must not be presented as a fresh 2026-11-27 run. The Windows MCP process-tree ownership gate is closed. Remaining acceptance gates are: (1) implement Runtime-managed MCPWorkers Manager start/attach/readiness/shutdown with strict process ownership; (2) verify the real authenticated DevKit→KeePassXC→scoped token→Manager API flow and live list/health/lifecycle/conflict behavior without changing existing worker state; (3) verify packaged/installed DevKit can start or attach to Manager without manual terminal or global development Node; (4) verify that externally started Manager is never terminated by DevKit; (5) verify the intended KeePassXC-backed Karakeep credential resolution separately from the already-confirmed `Connected` status, without accessing bookmark content; and (6) run the final post-integration Stage 2 validation and audit. The confirmed Karakeep connection-status check is complete; its credential-resolution check above is separate. The complete product Vault, full Skills Library, and broad marketplace experience are not Stage 2 gates. Keep MCP Library discovery within the existing Stage 2 scope; record Skills Library as a later roadmap capability. Do not expand Stage 2 into a broad marketplace or placeholder dashboard.

## Stage 3 — Developer Utilities MVPs (F-09 → F-11)

**Status:** [TARGET — NOT STARTED / NOT VERIFIED AS IMPLEMENTED]

Deliver the three focused utilities in this order, each as a complete, independently useful vertical slice:

1. F-09 Color Converter & Palette.
2. F-10 Port Inspector.
3. F-11 Project Inspector.

Keep each feature small, responsive, testable, and integrated into the existing DevKit shell. Do not delay a usable first version for speculative advanced features.

## Stage 4 — Platform Inspector MVP

**Status:** [TARGET]

Goal: deliver the broader service monitoring, candidate update validation, deterministic checks, evidence collection, structured reports, secret redaction, repeat inspections, and finding history described in Section 7. AI-assisted analysis follows only after deterministic validation is reliable. Inspector must not become a dependency of Core.

## Stage 5 — Developer Workflow MVP

**Status:** [TARGET]

Expected scope:

- Project registry and project-specific environment/service links.
- Task/workflow orchestration.
- Agent and Git integrations.
- One useful build/test/package/release workflow.
- Artifact management and Platform Inspector integration.
- Foundations for team-oriented workflows where justified.
- AI Agent Development Control Plane: project-aware MCP/Skills catalogues, Agent Profiles, compatible client adapters, and runtime state through supported contracts.
- Single-agent development standards: AGENTS.md, ADRs, S/M/L complexity routing, and Change-Scoped Development.
- CodeGraph as the first project-local structural-index integration; Context7 remains the external documentation provider.
- Feature-ADR as an adapted Skill; Semgrep as an optional security profile; Neural Memory only after a measured pilot.
- Explicit separation of DevKit configuration ownership, MCPWorkers/worker runtime ownership, and AI client consumption.

## Stage 6 — Distribution & Independence

**Status:** [TARGET]

Expected scope:

- Portable workspace model.
- Platform-specific packaging and managed runtime distribution.
- Supported operating-system expansion only after platform-specific implementation and packaged acceptance.
- Backup/restore and import/export.
- Migration between machines.
- Atomic updates and rollback.
- Managed component installation/removal.
- Predictable uninstall and Complete Purge of DevKit-owned resources.
- Windows remains the only supported platform until its production acceptance gates pass; Linux/macOS require dedicated adapters and real packaged validation.

## Post-MVP — Team Workflow & Ecosystem Expansion

**Status:** [DEFERRED / TARGET]

Potential scope:

- Shared team workspace definitions.
- Reusable project templates.
- Team policies and quality gates.
- Shared Inspector profiles.
- Role-based access.
- Team service inventories.
- Extension ecosystem.

This expansion must not delay the individual developer MVP.

# 12. Development methodology — MVP-first, major-stage delivery

## 12.1 User's explicit process requiremen

**[DECIDED]** Development must be organized into substantial logical stages, not endless cycles of two or three isolated tasks followed by another full audit.

A “major stage” means a coherent chain of related implementation tasks that delivers a meaningful capability or end-to-end workflow.

The preferred cycle:

```tex
Define stage objective and acceptance criteria
                  ↓
Break into a logical task chain
                  ↓
Implement the complete stage MVP
                  ↓
Run relevant integration and acceptance checks
                  ↓
Perform one comprehensive stage-level review/audi
                  ↓
Fix actionable findings
                  ↓
Re-run affected checks
                  ↓
Document and record completion
                  ↓
Move to the next major stage
```

Within a stage, agents may run focused tests and fix obvious defects as they work. The constraint is against repeatedly restarting broad audits for every tiny task.

## 12.2 MVP-first principles

The project uses the user's **AI Agent Development Standard — MVP-First Engineering (AADS)** as a general development standard.

Its core principles:

- Deliver working software rather than endless analysis.
- Build a minimum complete implementation first.
- Prefer end-to-end vertical slices.
- Validate the primary workflow.
- Improve quality after functionality exists.
- Keep architecture proportional to real requirements.
- Avoid speculative generalization and unnecessary dependencies.
- Reuse existing solutions where practical.
- Use risk-based testing and focused reviews.
- Stop investigating when the implementation works, relevant checks pass, and no meaningful blocker remains.
- Report only evidence-backed results.
- Preserve repository discipline and user changes.

## 12.3 Stage definition template

Each major stage should have:

1. **Objective:** what user problem this stage solves.
2. **Outcome:** what works when the stage is complete.
3. **Scope:** included capabilities.
4. **Non-scope:** explicitly deferred work.
5. **Dependencies:** prior stages or services required.
6. **Task chain:** logically ordered implementation tasks.
7. **Acceptance criteria:** observable success conditions.
8. **Validation plan:** tests that prove the workflow.
9. **Risks:** only material risks.
10. **Completion report:** delivered behavior, test evidence, known issues, and next stage.

## 12.4 Stage-level audit policy

A stage-level audit should be proportional to the risks and scope.

It should cover relevant areas:

- Correctness and reliability.
- Security and privacy boundaries.
- Integration contracts.
- Performance and responsiveness.
- Maintainability.
- UX and accessibility.
- Packaging and release behavior where applicable.

Findings should be actionable and prioritized:

- **P0:** critical; blocks safe use/release.
- **P1:** important; should be resolved before the relevant milestone or explicitly accepted.
- **P2:** normal; schedule appropriately.
- **P3:** later; optional or low impact.

Do not create work solely to make the audit appear comprehensive. Do not repeatedly audit unchanged code.

## 12.5 Completion definitions

### MVP Complete

- Primary workflow works.
- Acceptance criteria are satisfied.
- No known P0 blocker remains.
- Relevant basic validation passes.
- Known limitations are documented.

### Stage Complete

- All stage scope is implemented or explicitly deferred.
- End-to-end acceptance criteria pass.
- Relevant integration checks pass.
- One stage-level review has been completed.
- Blocking findings are fixed.
- Remaining findings have an explicit disposition.
- Documentation and repository state are recorded.

### Release Ready

- Release-specific validation passes.
- Packaging and deployment are verified.
- Security-sensitive boundaries are checked.
- Documentation matches the released behavior.
- No unresolved critical blocker remains.

## 12.6 Agent and repository discipline

- Work only in the single original DevKit project directory unless the user changes this constraint.
- Historical path: `C:\Users\Sondr\Projects\DevKit`.
- Do not create duplicate project copies or worktrees without explicit authorization.
- Preserve unrelated and uncommitted user changes.
- Check Git status before modifying files.
- Never discard work through destructive Git operations without authorization.
- Do not commit credentials or secrets.
- Do not claim that a commit, push, merge, or test succeeded without evidence.
- Parallelize only when task boundaries and file ownership are clear.
- Keep reports concise and evidence-based.

---

# 13. Security, privacy, and trust model

Security is a platform property, not a later UI feature.

## 13.1 Data classification

At minimum, distinguish:

- Public metadata.
- Workspace configuration.
- User content and knowledge data.
- Credentials and secrets.
- Runtime state and logs.
- Build artifacts.
- External service data.

Different classes require different storage, access, logging, and retention policies.

## 13.2 Trust boundaries

Important boundaries include:

- DevKit UI ↔ Core.
- Core ↔ Runtime.
- Runtime ↔ managed processes.
- DevKit ↔ MCP servers.
- DevKit ↔ external services.
- Inspector ↔ untrusted candidate builds.
- AI provider ↔ workspace data.
- User workspace ↔ host operating system.

Each boundary needs explicit authentication, authorization, validation, and error handling appropriate to its risk.

## 13.3 Secret handling

- No secret values in logs, crash reports, screenshots, or AI prompts by default.
- Redact tokens and credentials in Inspector output.
- Prefer scoped references to secrets.
- Avoid environment-variable exposure where a safer mechanism exists.
- Keep secrets out of repository history and build artifacts.
- Require explicit permission before an agent or integration accesses sensitive credentials.

## 13.4 Local-first and network behavior

**[TARGET]** DevKit should remain useful for local workflows without requiring an always-on DevKit cloud backend.

External services may require network connectivity, but the core workspace should not depend on a proprietary always-online control plane unless a future product decision explicitly introduces one.

Network access should be visible and attributable to a component or operation.

## 13.5 AI data access

AI-assisted workflows must follow least privilege:

- Send only the information required for the task.
- Redact secrets and private data.
- Make the target AI provider and data boundary clear.
- Avoid sending entire vaults or repositories by default.
- Record the source and scope of context used for sensitive operations where practical.

---

# 14. Portability and operating-system independence

**[DECIDED — PRODUCT GOAL]** DevKit should not be fundamentally tied to Windows. The workspace concept should be portable across supported operating systems.

**[TARGET]** Platform support should be layered:

- Platform-neutral core contracts.
- Platform-specific process and filesystem adapters.
- Platform-specific installers and packaging.
- Explicit runtime compatibility declarations.
- Workspace format independent of the host OS where practical.
- Migration tools for path and runtime differences.

Do not promise that a Windows-installed service can run unchanged on Linux. Portability means the workspace can be reconstructed or migrated using supported components and platform-specific adapters.

The initial Runtime work may be Windows-focused. Cross-platform support should be planned and tested as a separate capability rather than assumed.

---

# 15. Extension and integration model

**[TARGET]** DevKit should be extensible, but extensibility must not become premature plugin-platform engineering.

A practical progression:

1. Internal adapters for the first real integrations.
2. Stable adapter contracts.
3. Versioned capability declarations.
4. Permission and trust metadata.
5. Extension packaging and lifecycle.
6. External developer documentation and ecosystem support.

Every extension should declare:

- Identifier and version.
- Compatibility range.
- Capabilities.
- Permissions.
- Dependencies.
- Configuration schema.
- Data ownership.
- Lifecycle operations.
- Health and diagnostic support.
- Update and removal behavior.

Do not allow an extension to gain unrestricted filesystem, network, or credential access by default.

---

# 16. Data, backup, recovery, and migration

**[TARGET]** The workspace must be recoverable and movable.

Important concepts:

- Workspace manifest.
- Configuration export.
- Secret backup/recovery policy.
- Managed service data backup.
- External storage references.
- Versioned migrations.
- Integrity checks.
- Restore validation.
- Clear ownership and retention.

Backups must not silently include plaintext secrets. Recovery must account for the fact that some credentials may require re-authentication on another machine.

A workspace migration should report:

- Components that can be moved directly.
- Components that must be reinstalled.
- Components that need OS-specific setup.
- Credentials that require reauthorization.
- Data that was not included.
- Any unsupported integrations.

---

# 17. Product success criteria

DevKit should be considered successful when it can demonstrate the following real workflows:

1. A developer opens DevKit and sees a truthful overview of the workspace.
2. The developer can access and manage registered services from one interface.
3. At least one real MCP server can be registered, inspected, and operated through DevKit.
4. Karakeep and Obsidian can be connected without taking destructive ownership of their data.
5. The existing authentication source can be used without duplicating secrets unnecessarily.
6. Multi-AI Aggregator can be registered and its state inspected.
7. A project can be connected to its required services and a real build/test workflow can be run.
8. Inspector can validate a service candidate, produce an evidence-based report, and repeat validation after a fix.
9. A workspace can be backed up and restored or migrated through a documented process.
10. Removing DevKit removes the resources it owns and clearly accounts for anything retained or external.

These are long-term product outcomes, not current MVP acceptance claims.

---

# 18. Open decisions and items requiring verification

The following must not be silently treated as settled.

## Architecture and packaging

- [OPEN] Final workspace filesystem layout.
- [OPEN] Exact boundary between desktop UI, Core, and Runtime.
- [OPEN] Whether the runtime is embedded, separately packaged, or composed of multiple processes.
- [OPEN] Which runtimes are bundled versus downloaded on demand.
- [OPEN] Final portable distribution format for Windows and Linux.
- [OPEN] Update and rollback architecture.

## Identity and secrets

- [OPEN] Exact identity/credential provider and its supported API.
- [OPEN] Unlock and recovery model.
- [OPEN] Whether DevKit stores encrypted copies or only references the existing credential source.
- [OPEN] Credential access scopes and user approval UX.

## Integrations

- [OPEN] Exact Karakeep API capabilities and authentication method.
- [OPEN] Obsidian integration mechanism and vault discovery behavior.
- [OPEN] Inventory and metadata of the user's local MCP servers.
- [OPEN] Multi-AI Aggregator's management and diagnostic API.
- [OPEN] Which drives and storage providers are required first.
- [OPEN] Which integrations are managed versus connected.

## Inspector

- [OPEN] First supported candidate update workflow.
- [OPEN] Isolation backend for Windows and Linux.
- [OPEN] Test profile format.
- [OPEN] Approval policy for promotion to production.
- [OPEN] AI provider and data-access policy for AI analysis.

## Product and teams

- [OPEN] First team collaboration workflow.
- [OPEN] Whether team features require a shared server or can begin with exportable workspace definitions.
- [OPEN] Extension distribution and trust model.
- [OPEN] Licensing and distribution strategy.

## Current implementation and production readiness

- [CURRENT — VERIFIED 2026-11-24] Stage 0 and Stage 1 are integrated into `main`; PR #13 is merged at `71bcb9c266c4a494e81243017037c7744823b555`.
- [CURRENT — VERIFIED 2026-11-24] The supervised two-hour native Runtime soak passed: 7,201 seconds, 1,779,051 cycles, 17,961 batches/samples, handles stable at 172, `RUNTIME_SOAK_PASS` present, supervisor exit code 0, and zero crash events.
- [CURRENT — VERIFIED 2026-11-24] The active branch is `feat/unified-workspace-mvp` at `2e2d874`; it contains uncommitted Stage 2 work and is one commit ahead of `origin/main`.
- [CURRENT — VERIFIED 2026-11-24] The current Stage 2 working tree passes `npm run check` (**488 tests / 46 files**, TypeScript clean, ESLint 0 errors / 0 warnings), `npm run build`, development Electron E2E (**3/3**), ASAR validation (**7,093 files**, including the unpacked CommonJS MCP bootstrap and cross-spawn runtime), packaged E2E (**5/5**), isolated NSIS installation of Dev Toolbox 1.0.4, and installed-app E2E (**5/5**); installer and uninstaller exit codes were both 0. Managed MCP stdio process-tree cleanup is verified in native, development, packaged, and installed-app tests. The malformed Karakeep fixture and concurrent workspace-directory creation race found during validation were fixed and covered by tests. See section 10.4.
- [OPEN] Complete the release-signing policy and configure a signing certificate for signed installer/update validation.
- [OPEN] Establish the supported Windows-version and parent-Job compatibility matrix.
- [OPEN] Complete broader recovery, update/rollback, and production security validation before declaring Runtime production-ready.

---

# 19. Immediate execution plan

The next steps should preserve the current project and build on the merged Runtime baseline.

## Step 1 — Runtime baseline (complete)

- Stage 0 and Stage 1 are integrated into `main`.
- PR #13 is merged at `71bcb9c266c4a494e81243017037c7744823b555`.
- The two-hour native Runtime soak passed on Windows 11 x64.
- The Scheduled Task wrapper exit-code discrepancy was fixed and its smoke path revalidated.
- Local `release:check` and security audits passed.
- Broader Windows production gates remain documented follow-up work.

## Step 2 — Recover and validate Stage 2 WIP

On the existing project directory and branch `feat/unified-workspace-mvp`:

- Preserve the MCP & Integrations backup stash until the restored changes are fully verified.
- The initial syntax blocker in `src/main/storage/karakeep-provider.test.ts` and the startup race in `ensureSafeDirectory` have been fixed; a concurrent-creation regression test is included.
- Current check/build/development-E2E and packaged/installed E2E results are recorded in section 10.4. They passed for the current WIP; rerun the relevant release gates after any further changes before final Stage 2 acceptance.
- Managed MCP stdio process-tree ownership is implemented and verified: the trusted bootstrap is attached to a kill-on-close Job Object before the configured command launches; continue reviewing URL/transport constraints, secret handling, safeStorage failure behavior, timeouts, and cleanup in the comprehensive Stage 2 audit.
- Validate LocalMCP, LocalMCP Tunnel Edition, and Chat2Agent lifecycle adapters against their actual installed scripts and ownership boundaries. Do not start/stop external services unless they are registered as DevKit-managed or the user explicitly authorizes the operation.
- Implement the MCPWorkers Manager as an explicit exception to the earlier “no external service auto-start” default: if configured as DevKit-managed, Runtime may start it during Workspace startup and stop it during Workspace shutdown, but only when DevKit owns the process. If already running externally, attach without taking ownership and leave it running on shutdown.
- Keep automatic startup opt-in/configurable per managed component; never infer permission to start arbitrary discovered localhost services.
- Review Registry metadata trust boundaries and explicit user confirmation before executing third-party packages.
- Fix actionable defects before expanding scope.

## Step 3 — Define the complete Unified Workspace MVP

Use the current `docs/ROADMAP.md` as the delivery baseline. Define one end-to-end user workflow with:

- A coherent workspace shell and dashboard.
- A real service/integration entry point.
- Runtime-backed status and lifecycle where DevKit actually owns the process.
- MCP connection discovery/configuration with explicit trust confirmation.
- Clear separation between Managed, Connected, Discovered, and Unmanaged components.
- Settings and workspace persistence sufficient for that workflow.

The MVP must demonstrate real functionality, not just navigation and placeholder pages.

## Step 4 — Complete Stage 2 as a vertical slice

- Finish the existing MCP & Integrations work only where it contributes to the Stage 2 acceptance criteria.
- Integrate the Services Hub and MCP Hub without duplicating Runtime responsibilities.
- Add only the OS-backed secret-protection boundary and read-only Storage foundations required by the first real workflow; do not implement the complete product Vault lifecycle in Stage 2.
- Preserve existing installations and user data unless migration is explicitly requested.
- Run focused tests during implementation, then one comprehensive stage-level audit after the planned chain is complete.
- Update the roadmap and stage documentation, commit, and integrate the completed stage.

## Step 5 — Deliver the three developer utilities

After Stage 2 acceptance, deliver F-09 Color Converter & Palette, F-10 Port Inspector, and F-11 Project Inspector in that order. Each feature must have a clear MVP boundary, focused tests, and documented acceptance.

## Step 6 — Continue to Platform Inspector MVP

Deliver the broader service/update Inspector with deterministic checks, evidence collection, secret redaction, structured reports, and repeat inspection. Add AI-assisted analysis only after the deterministic path is reliable.

## Step 7 — Deliver AI Agent Development Infrastructure within Stage 5

After the existing Stage 2, Stage 3, and Stage 4 gates are accepted, deliver the vertical slice described in docs/plans/AI_AGENT_DEVELOPMENT_ENABLEMENT.md:
- Verify MCPWorkers Public API and LocalMCP external-gateway contracts; do not bypass runtime ownership.
- Define project Agent Profiles and client adapter boundaries.
- Provide AGENTS.md/ADR templates and the single-agent Change-Scoped Development workflow.
- Pilot CodeGraph first, adapt Feature-ADR as a Skill, and make Semgrep optional.
- Evaluate Neural Memory last and adopt it only if retrieval and time/token metrics justify the additional dependency.
- Keep GPT.com/ChatGPT Web optional; local agent workflows must remain independent.

# 20. Terminology

| Term | Meaning |
|---|---|
| DevKit | The overall independent developer workspace platform |
| Workspace | The owned environment containing configuration, managed data, components, and state |
| Core | The central platform logic and registries |
| Runtime | Process execution and lifecycle foundation |
| Managed service | A component whose installation or lifecycle is owned by DevKit |
| Connected service | An external service accessed through an integration |
| Adapter | A component implementing a service-specific integration contract |
| MCP | Model Context Protocol server/tool integration |
| MCP Library | Catalog and connection workflow for discovering and managing MCP servers |
| Skills Library | Separate catalog and lifecycle workflow for agent Skills/instruction packages |
| MCPWorkers Manager | Domain manager for MCPWorkers definitions and instances; a managed component within DevKit, not the universal MCP control plane |
| Services Hub | Unified UI for registered local and external services with ownership-aware lifecycle controls |
| Port Inspector | F-10 read-only local port/process diagnostics utility |
| Project Inspector | F-11 project structure and context analysis utility; distinct from the platform Inspector subsystem |
| Service Intelligence | Understanding service state, dependencies, and coordination requirements |
| Orchestration | Execution of multi-step workflows across components |
| Inspector | Monitoring, diagnostics, update validation, and quality analysis subsystem |
| Vault | Protected secret/credential storage or reference boundary; exact implementation remains open |
| AADS | AI Agent Development Standard — MVP-First Engineering |
| Agent Profile | Versioned project-specific assignment of approved MCP servers, Skills, permissions, and supported client targets |
| Control Plane | DevKit-owned discovery, configuration intent, project profiles, approvals, and status presentation |
| Runtime Plane | MCPWorkers and the selected worker/runtime that owns installations, execution configuration, and lifecycle |
| Consumer Plane | AI agent, IDE, or supported client that consumes project instructions, Skills, and MCP tools |
| Change-Scoped Development | Development workflow that limits investigation, changes, and validation to the affected execution path and its blast radius |
| Neural Memory | Optional advisory retrieval store for historical observations; never the current source of truth |

---

# 21. Final product directive

DevKit must be built as a coherent, independent workspace platform — not as a collection of unrelated utilities and not as a monolith that absorbs every external application.

The platform should:

- Own its managed workspace and know exactly what it owns.
- Connect external services through explicit adapters.
- Keep specialist applications independent.
- Centralize useful access and management without duplicating every product.
- Protect credentials and user data.
- Manage service lifecycle through a reliable Runtime.
- Understand dependencies through Service Intelligence.
- Evaluate quality and updates through Inspector.
- Support real developer workflows, from project setup to build, test, packaging, and release.
- Remain portable across supported operating systems.
- Be useful to individual developers first and extensible to teams later.

Development must follow the agreed major-stage MVP-first process:

**Define → Implement the complete stage MVP → Validate → Audit the completed stage → Fix actionable findings → Record completion → Continue.**

Do not restart the architecture without evidence. Do not create duplicate repositories or worktrees without authorization. Do not turn every small task into another broad audit. Do not claim unimplemented or unverified capabilities as complete.

**The objective is to build a working, reliable developer workspace — one substantial, verifiable stage at a time.**