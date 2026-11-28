# DevKit — Master Product & Architecture Specification

**Canonical project brief:** v1.2.2\\
**Last structural review:** 2026-11-28\\
**Status:** Active\\
**Repository:** https://github.com/Ten-Dark/DevKi

> This document is the compact entry point and cross-domain contract for the DevKit project. It defines the product identity, non-negotiable architecture boundaries, current accepted baseline and source-of-truth hierarchy. Detailed domain behavior belongs to the linked specialist documents; do not duplicate it here.

## 1. How to use this documen

Use this document to understand DevKit as a whole and to identify the authoritative document for a specific question.

### Source-of-truth hierarchy

| Domain | Authoritative source |
| --- | --- |
| Product purpose, goals, non-goals and UX direction | [Product Vision](PRODUCT_VISION.md) |
| Current stage sequence, priorities and delivery status | [Roadmap](ROADMAP.md) |
| Logical architecture, ownership, runtime and platform boundaries | [Architecture Blueprint](architecture/ARCHITECTURE_BLUEPRINT.md) |
| Accepted baseline architecture decisions | [Architecture Decision Register](architecture/ARCHITECTURE_DECISIONS.md) |
| Formal AI-agent/control-plane decisions | [ADR-0001](architecture/decisions/ADR-0001-devkit-agent-control-plane.md), [ADR-0002](architecture/decisions/ADR-0002-mcpworkers-only-local-mcp-runtime.md) |
| Service health, dependencies and orchestration | [Service Intelligence](architecture/SERVICE_INTELLIGENCE.md) |
| MCP and Skills catalogue design | [MCP & Skills Libraries](architecture/MCP_AND_SKILLS_LIBRARIES.md) |
| AI Agent Development Infrastructure | [Architecture](architecture/AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md) and [implementation plan](plans/AI_AGENT_DEVELOPMENT_ENABLEMENT.md) |
| Inspector architecture | [Inspector](architecture/INSPECTOR.md) |
| MCPWorkers Manager and Worker lifecycle contract | [MCPWorkers Integration](architecture/MCPWORKERS_INTEGRATION.md) |
| MCP connection, credential and Storage behavior | [MCP & Integrations Guide](guides/mcp-integrations.md) |
| Stage acceptance and validation evidence | The corresponding [Stage 0](architecture/STAGE_0_FOUNDATION.md), [Stage 1](architecture/STAGE_1_RUNTIME.md) or [Stage 2](architecture/STAGE_2_UNIFIED_WORKSPACE.md) record |
| Development, agent workflow and release procedures | [Development guide](guides/development.md), [MVP-first workflow](guides/development-workflow.md), [Release guide](guides/releasing.md) |
| Security findings and open release gates | [Security Review](guides/SECURITY_REVIEW.md) and [Windows Code Signing](guides/WINDOWS_CODE_SIGNING.md) |

When sources disagree:
1. Current implementation and automated tests establish what actually exists.
2. Accepted architecture decisions establish intended contracts.
3. Stage records establish what was implemented and accepted at a given point.
4. Product Vision and Roadmap establish product direction and delivery order.
5. Proposals and plans are not implementation claims.
6. Archived documents are historical and must not be used as current instructions.

### Status vocabulary

- **Implemented:** present in the repository.
- **Verified:** supported by an identified test or live acceptance check.
- **Accepted:** required acceptance criteria have passed for the stated platform/scope.
- **Planned:** approved direction, not yet implemented.
- **Proposed:** under consideration; not an accepted contract.
- **Deferred:** intentionally excluded from the current stage.
- **External:** owned and operated outside DevKit.

A specification is not evidence that a feature exists. State platform and scope whenever describing acceptance.

## 2. Executive summary

DevKit is an independent, modular, portable and cross-platform **Developer Workspace Platform**. It provides a coherent control surface for a developer's projects, services, MCP integrations, data sources, credentials, workflows and quality controls.

DevKit is not a monolithic IDE, a replacement for every connected product, or a new runtime for every tool. It coordinates specialist applications through explicit contracts while preserving their ownership.

The product principle is:

> One workspace. All development infrastructure.

## 3. Product contrac

The complete product definition is maintained in [Product Vision](PRODUCT_VISION.md). The following boundaries are architectural constraints.

### Goals

- One coherent workspace for projects, services, MCP, storage, workflows and quality.
- Explicit visibility into ownership, health, readiness, dependencies and lifecycle state.
- Safe orchestration of DevKit-managed components.
- Integration with existing specialist products instead of reimplementing them.
- Protected handling of credentials and non-secret configuration intent.
- Portable workspace data, backup, migration, update and removal paths.
- Provider-independent developer and AI-agent workflows.

### Non-goals

- Replacing Karakeep, Obsidian, GitHub, editors, CI providers or specialist MCP products.
- Automatically managing arbitrary processes or resources DevKit cannot prove it owns.
- Executing discovered third-party MCP servers or Skills merely because they were browsed or saved.
- Treating AI output as proof of correctness or security.
- Building a full enterprise project-management platform before the core workspace is useful.

### Product principles

- **Managed, not invasive:** DevKit manages only explicitly registered or provisioned resources.
- **Modular by contract:** domain logic is separated from provider and platform adapters.
- **Observable:** process existence, service health and readiness are distinct states.
- **Safe by default:** least privilege, explicit trust, secret isolation, bounded operations and reversible changes.
- **MVP-first:** deliver complete vertical slices and avoid speculative infrastructure.

## 4. Platform architecture and ownership

The full architecture is defined in [Architecture Blueprint](architecture/ARCHITECTURE_BLUEPRINT.md).

| Plane | Owner | Responsibility |
| --- | --- | --- |
| Control Plane | **DevKit** | Workspace UI, project context, MCP/Skills catalogues, Agent Profiles, adapter configuration intent, trust/approval state and sanitized status |
| Runtime Plane | **MCPWorkers** and other explicitly integrated runtimes | Worker Definitions/Instances, package installations, runtime configuration and execution lifecycle under their public contracts |
| Consumer Plane | **AI agents, IDEs and supported clients** | Consume project instructions, approved Skills and MCP capabilities through supported adapters |

DevKit is the user-facing control plane. It must not bypass a connected runtime's supported API by editing private registries, configuration files or process state.

### Resource ownership modes

- **Managed:** DevKit provisioned the resource and has a verifiable ownership record. Lifecycle operations are allowed only when the adapter declares the capability.
- **Connected:** an existing external resource. DevKit may observe or operate only through explicitly granted adapter capabilities; it is not eligible for automatic deletion or migration.
- **Discovered:** metadata found in a catalogue or on the host. Discovery does not grant trust, installation or lifecycle authority.
- **Unmanaged:** outside DevKit's authority. Do not claim control over it.

### Lifecycle rules

- A process being alive does not prove that its service is healthy or ready.
- Start/stop/restart/update/delete controls must reflect verified ownership and adapter capabilities.
- DevKit may stop only a Manager process it launched and still owns.
- Attaching to an already-running external Manager is non-owning; DevKit must not stop it.
- Starting MCPWorkers Manager must not automatically start Worker Instances.
- Unknown ownership or stale process identity must fail closed; never terminate a process based only on a persisted PID.

## 5. Key integration contracts

These are cross-project invariants. Specialist guides own the detailed procedures and schemas.

### MCPWorkers

- MCPWorkers is the sole management path for LocalMCP and LocalMCP Tunnel Worker Instances.
- DevKit uses the authenticated, versioned MCPWorkers Public API v1 for Definition/Instance discovery, health and explicit Worker lifecycle requests.
- DevKit Runtime may attach to an external Manager or launch a configured Manager sidecar. It shuts down only a Manager launched by the current DevKit session.
- Manager startup does not start Worker Instances.
- DevKit does not read or mutate MCPWorkers Registry files, worker configuration files, package directories or worker processes directly.
- The standalone external LocalMCP Tunnel HTTP runtime remains independently managed; it must not be stopped, restarted or reconfigured by DevKit.
- MCPWorkers API v1 is a Worker control API, not a general MCP tool-transport endpoint. The future transport is a separate proposal and must not be described as implemented.

### MCP and Skills

- MCP servers and agent Skills are separate capability types with separate trust, installation and activation semantics.
- Browsing a catalogue is read-only. Saving a definition does not execute or activate third-party content.
- Generic direct MCP connections and MCPWorkers-managed Worker Instances are distinct integration paths with distinct ownership.
- Credentials are resolved in the privileged main process through approved secret-provider references; raw secrets must not reach renderer state, project files, prompts or logs.
- The current MCP client supports local stdio and remote Streamable HTTP under explicit connection/trust confirmation. This describes the existing Stage 2 capability, not a general MCPWorkers transport.
- ADR-0002 governs the target architecture for new local MCP integrations: MCPWorkers-managed Workers exposed through a separately accepted Manager-owned transport. It does not silently authorize removal of existing Stage 2 stdio support or migration of current user tooling.

### Connected applications and data

- **Karakeep:** connection/authentication status only. DevKit must not read, search, index, download, create, edit, archive, delete or synchronize bookmarks or attachments.
- **Obsidian:** read-only local vault browsing and Markdown preview; no mutation of notes or settings.
- **Multi-AI Aggregator:** launch-only desktop integration; its own application retains window and shutdown ownership.
- **Chat2Agent:** retired from the active DevKit integration surface. See the [retirement record](architecture/CHAT2AGENT_RETIREMENT.md).
- Other user projects and services remain independent unless a specific integration contract explicitly adopts them.

## 6. Main workspace areas

Product behavior and UX goals are defined in [Product Vision](PRODUCT_VISION.md). Detailed technical contracts are linked below.

| Workspace area | Responsibility | Detailed source |
| --- | --- | --- |
| Overview | Workspace health, events and active work | Product Vision |
| Projects & Workflow | Repositories, project context, tasks and workflow orchestration | AI Agent Development Infrastructure |
| Services | Registered services, health, dependencies and lifecycle | Service Intelligence |
| MCP Library | MCP discovery, saved connections, tools metadata and trust | MCP & Skills Libraries; MCP & Integrations Guide |
| Skills Library | Skill discovery, provenance, dependencies and activation boundaries | MCP & Skills Libraries |
| Storage | Connected folders, Obsidian and approved external stores | MCP & Integrations Guide |
| Vault / Secrets | Secret references, providers and protected resolution | Architecture Blueprint; MCP & Integrations Guide |
| Inspector | Infrastructure observation and project quality analysis | Inspector |
| Toolbox | Focused developer utilities | Feature specifications |
| Settings | Workspace, runtime, services, integrations and security | Product Vision |

### Inspector and developer utilities

Inspector is an independent observation and quality subsystem. Deterministic checks and reproducible evidence are authoritative; AI-assisted analysis must be labeled as advisory and must not silently become proof.

- **F-09:** Color Converter & Palette.
- **F-10:** Port Inspector.
- **F-11:** Project Inspector.

F-11 is a focused project-analysis vertical slice within Inspector, not a competing analysis engine. Requirements and acceptance criteria live in the features directory.

## 7. AI Agent Development Infrastructure

The target architecture is a provider-independent DevKit Control Plane, MCPWorkers Runtime Plane and AI-agent/IDE Consumer Plane. It is an approved product direction, but its complete capability set is not part of Stage 2 acceptance.

Core rules:
- Use project-scoped Agent Profiles to declare capability IDs, versions, client targets and logical secret references; never store resolved credentials in profiles.
- Preserve MCPWorkers as the Worker lifecycle authority.
- Do not assume a Worker control API provides MCP tool transport.
- Do not install, activate, start or grant access to discovered MCP servers or Skills without explicit approval.
- Default to a single-agent, change-scoped workflow. Subagent swarms are optional, not foundational.
- Use current source/tests, concise project instructions, accepted architecture and ADRs as primary context; optional AI memory is advisory.
- Select tools by task need. Do not add overlapping code-indexing or memory systems without a measured gap.

Detailed architecture, constraints and acceptance criteria: [AI Agent Development Infrastructure](architecture/AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md). Sequenced work packages: [AI Agent Development Enablement plan](plans/AI_AGENT_DEVELOPMENT_ENABLEMENT.md).

## 8. Security, privacy and trus

- The renderer is unprivileged; privileged operations remain in the main process or narrowly scoped platform adapters.
- IPC inputs, filesystem paths, process launch parameters and external URLs require validation at the privileged boundary.
- Third-party MCP servers and Skills are untrusted until reviewed and explicitly approved.
- Secret values are not stored in ordinary configuration, Git, project context, prompts or logs.
- Remote endpoints transmit protocol data to their operators; users must be able to identify the provider and trust boundary.
- Filesystem access is scoped, bounded and rejects symlink/junction traversal where required by the provider contract.
- Destructive or high-impact operations require explicit authorization and must be limited to resources DevKit can prove it owns.
- Security findings, mitigations and open release gates are maintained in [Security Review](guides/SECURITY_REVIEW.md). Windows signing and publisher-verification procedure is in [Windows Code Signing](guides/WINDOWS_CODE_SIGNING.md).

## 9. Portability, workspace data and lifecycle

DevKit separates application binaries from workspace data and DevKit-managed service resources. A canonical workspace root, ownership metadata, versioned configuration, service data, logs, events, caches and backups must be governed by explicit contracts.

Portability does not mean zero operating-system traces or the ability to remove user-managed external applications. The product must distinguish:
- uninstalling the DevKit application;
- removing DevKit-managed resources with verified ownership;
- disconnecting external resources without modifying them;
- optional complete purge of DevKit-owned workspace data after explicit confirmation.

Backup, restore, migration, update and rollback must preserve user data and provide validation before destructive replacement. Detailed path layout, ownership manifest and removal contracts belong in the [Architecture Blueprint](architecture/ARCHITECTURE_BLUEPRINT.md).

## 10. Current accepted implementation baseline

This section is a concise status snapshot, not a replacement for stage evidence. The [Roadmap](ROADMAP.md) is the source of truth for delivery order and status; stage records own detailed test evidence.

### Stage 0 — Architecture Foundation

Accepted. Baseline product direction, ownership model, architecture boundaries and Stage 1 acceptance criteria were established. See the [Stage 0 record](architecture/STAGE_0_FOUNDATION.md).

### Stage 1 — DevKit Runtime

MVP accepted on Windows 11 x64 and integrated into main. Remaining cross-platform and broader production-readiness work is explicitly separate from the accepted Windows baseline. See the [Stage 1 record](architecture/STAGE_1_RUNTIME.md).

### Stage 2 — Unified Workspace

Implementation, technical acceptance and final pre-integration audit are complete on Windows 11 x64. **Integration into main remains pending explicit user authorization.**

Verified acceptance snapshot (2026-11-28):
- 549/549 tests across 54 files; TypeScript and ESLint clean.
- Development Electron E2E: 4/4.
- Packaged Electron E2E: 6/6.
- NSIS-installed Runtime E2E: 1/1.
- Development and packaged MCPWorkers sidecar lifecycle smoke tests passed against isolated data roots.
- Authenticated MCPWorkers API v1, scoped KeePassXC token resolution, Definition/Instance discovery, owned Manager lifecycle and external Manager attach passed.
- Build, NSIS packaging and ASAR validation (7,109 files) passed.
- npm audit at moderate severity: 0 vulnerabilities.
- No P0/P1 defects were found in the reviewed Stage 2 scope.

Known non-blocking limits include Windows 11 x64-only acceptance, unsigned local NSIS build (no signing certificate), no formal WCAG conformance audit, and broader Vault/agent/team workflows outside Stage 2.

The full acceptance record is [Stage 2 — Unified Workspace MVP](architecture/STAGE_2_UNIFIED_WORKSPACE.md). Do not mark Stage 2 as integrated into main until the user explicitly authorizes and the integration is verified.

## 11. Delivery and development policy

- Follow the [Roadmap](ROADMAP.md); do not create a competing roadmap in this document.
- Follow the [MVP-first development workflow](guides/development-workflow.md): plan a bounded stage, deliver a working vertical slice, complete meaningful integration, run stage-level acceptance, then polish by priority.
- Run focused tests during implementation. Run comprehensive stage audits at meaningful acceptance boundaries, not after every small task.
- Address critical security, data-loss, contract-breaking and integration-blocking defects immediately.
- Keep proposals distinct from accepted contracts and implementation status.
- Use conventional commits. Stage only task-related changes; preserve unrelated user changes.
- Do not commit, merge, push, delete or perform destructive cleanup without explicit authorization.
- Do not claim a capability is implemented because it appears in a roadmap or proposal.

Operational commands and environment setup: [Development Guide](guides/development.md). Release validation and publication controls: [Release Guide](guides/releasing.md).

## 12. Terminology

- **Control Plane:** DevKit's user-facing configuration, discovery, approval and coordination layer.
- **Runtime Plane:** the system that owns actual Worker installation, configuration and execution lifecycle.
- **Consumer Plane:** AI agents, IDEs and other clients that consume approved capabilities.
- **Managed resource:** a resource explicitly provisioned and owned by DevKit.
- **Connected resource:** a pre-existing or externally owned resource accessed through declared capabilities.
- **Discovered resource:** metadata found by discovery; not yet trusted or activated.
- **Health:** observed operational condition of a service.
- **Readiness:** whether a service can perform the operations required by its dependents.
- **Orchestration:** policy-governed coordination of dependency checks, startup, shutdown and recovery.
- **Agent Profile:** project-scoped, non-secret declaration of the agent capabilities and client configuration required for a project.
- **Inspector finding:** a result backed by reproducible checks, source locations, logs or explicitly labeled AI analysis.

## 13. Canonical documentation map

The maintained documentation index is [docs/README.md](README.md). Historical specifications are in [archive/](archive/); they are not current instructions.

Keep the documentation system small:
- one Product Vision;
- one Roadmap;
- one compact Master Specification;
- one architecture blueprint and decision register;
- focused architecture contracts and stage acceptance records;
- focused feature requirements;
- operational guides and reusable templates.

Before adding a new document, first check whether its content belongs in an existing source of truth. Prefer updating and linking an existing document over creating a near-duplicate.

---

**Revision note — 2026-11-28:** Reorganized the canonical specification as a compact cross-domain brief. Product direction, roadmap, architecture contracts, operational procedures and stage evidence remain in their dedicated source documents. Removed duplicated roadmaps and stale execution instructions from the master brief; no product acceptance scope was changed.
