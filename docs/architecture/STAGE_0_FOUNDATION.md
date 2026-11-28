# Stage 0 — Architecture Foundation

**Status:** Accepted
**Purpose:** Establish the minimum product, architecture, ownership and safety contracts required to begin implementation of the DevKit Runtime MVP.
**Historical stage:** This document records the Stage 0 outcome. Current architecture contracts are maintained in the linked specialist documents.

## 1. Stage outcome

Stage 0 established the foundation for evolving Dev Toolbox into DevKit, an independent Developer Workspace Platform.

The stage is accepted. Its outputs are:

- Product definition, goals, non-goals and delivery principles.
- Separation between DevKit Core, Workspace, Extensions and Inspector.
- Explicit ownership modes for managed and connected resources.
- Adapter-driven service lifecycle and capability-based permissions.
- Separate process state, service health and readiness.
- Initial workspace data, configuration, event and secret boundaries.
- Storage and Vault separation.
- Inspector isolation and evidence-based findings.
- Migration direction from the original Dev Toolbox.
- Stage 1 Runtime MVP scope and acceptance criteria.

The current product definition is in [Product Vision](../PRODUCT_VISION.md), the current stage sequence is in [Roadmap](../ROADMAP.md), and the active architecture is in [Architecture Blueprint](ARCHITECTURE_BLUEPRINT.md).

## 2. Baseline and migration contex

The foundation was designed around the existing Electron desktop application and its established main/preload/renderer security boundary. The decision was to evolve the working application incrementally rather than replace its shell or introduce an always-running daemon before a validated requirement existed.

Migration principles:

- Preserve existing user-facing utilities and their data behavior.
- Keep privileged filesystem and process operations outside the renderer.
- Separate application binaries from persistent workspace data.
- Store references to user projects and external vaults; do not silently copy or adopt their contents.
- Provision directories and infrastructure lazily when a capability is enabled.
- Preserve external service ownership and avoid automatic cleanup of connected resources.

The detailed workspace layout, ownership manifest, lifecycle and removal contract are maintained in the [Architecture Blueprint](ARCHITECTURE_BLUEPRINT.md).

## 3. Accepted foundation decisions

The following decisions formed the Stage 0 baseline:

1. Keep Electron as the desktop shell for the initial platform MVP; keep domain modules independent of Electron.
2. Use one explicit DevKit workspace root for DevKit-managed state.
3. Organize Core as domain modules with stable contracts, not as a monolithic service.
4. Use adapter-driven, capability-based service lifecycle operations.
5. Distinguish process state from service health and readiness.
6. Start with validated, versioned local files; introduce a database only when evidence requires it.
7. Keep Vault separate from ordinary configuration and use protected secret-provider boundaries.
8. Integrate existing data stores rather than replacing them.
9. Keep Inspector isolated from Core and read-only by default.
10. Prioritize a local-first individual workflow before team collaboration.
11. Distinguish application uninstall from removal or purge of workspace data.
12. Use platform adapters; Windows was selected as the first production target.
13. Use pluggable Secret Providers; no single provider is mandatory.
14. DevKit Runtime owns lifecycle of managed components; MCPWorkers owns Worker Instances.
15. Keep MCP Library and Skills Library as separate catalogues.

The decision register contains the detailed rationale, constraints and review triggers: [Architecture Decisions](ARCHITECTURE_DECISIONS.md). Later AI-agent and local MCP runtime decisions are recorded separately as [ADR-0001](decisions/ADR-0001-devkit-agent-control-plane.md) and [ADR-0002](decisions/ADR-0002-mcpworkers-only-local-mcp-runtime.md).

## 4. Foundation contracts

### Ownership and removal

Every resource must have an explicit ownership classification. DevKit may manage only resources it provisioned or explicitly adopted through a supported contract. Connected resources may be observed or operated only through granted capabilities and must not be automatically deleted, migrated or purged.

Application uninstall, disconnecting an external resource, removing DevKit-managed resources and complete workspace purge are separate operations.

### Services and orchestration

A service registration describes the resource; an adapter performs provider-specific operations. Capabilities are declared individually. Unsupported operations must not appear as available controls.

Process existence is not health. A service is ready only when its required readiness checks pass. Dependencies must be explicit, and orchestration must validate readiness before starting dependents.

### Vault and Storage

Vault protects credentials and secret references. Storage providers expose approved user data sources. A Storage connection does not implicitly grant MCP servers or other integrations access to that data.

### Inspector

Inspector is an independent subsystem. Deterministic checks and reproducible evidence are authoritative. AI-assisted analysis is advisory and must be clearly labeled. Inspector is not required for basic process or service lifecycle management.

## 5. Stage 1 handoff

Stage 0 defined the Stage 1 Runtime MVP as a bounded vertical slice:

- Explicit workspace root and path services.
- Runtime/process lifecycle with verifiable ownership.
- Versioned configuration and service registry.
- Adapter contracts and capability-based operations.
- Structured lifecycle events and diagnostics.
- Basic health/readiness checks.
- Safe shutdown and cleanup of DevKit-owned resources.

Stage 1 implementation and acceptance are documented in [Stage 1 — DevKit Runtime](STAGE_1_RUNTIME.md). This Stage 0 record does not duplicate its implementation details, test evidence or remaining production-readiness gates.

## 6. Stage 0 acceptance

**Status: Accepted**

- [x] Product direction and non-goals documented.
- [x] Core, Workspace, Extensions and Inspector boundaries established.
- [x] Resource ownership and removal semantics defined.
- [x] Service, health, readiness and orchestration contracts established.
- [x] Vault and Storage responsibilities separated.
- [x] Security and trust boundaries documented.
- [x] Migration direction from Dev Toolbox defined.
- [x] Stage 1 Runtime MVP scope and acceptance criteria established.

## 7. Current source documents

This file is a historical stage acceptance record, not a competing architecture specification. For current instructions use:

- [Master Product & Architecture Specification](../DEVKIT_MASTER_SPEC_v1.2.2.md)
- [Product Vision](../PRODUCT_VISION.md)
- [Roadmap](../ROADMAP.md)
- [Architecture Blueprint](ARCHITECTURE_BLUEPRINT.md)
- [Architecture Decisions](ARCHITECTURE_DECISIONS.md)
- [Stage 1 Runtime acceptance](STAGE_1_RUNTIME.md)
- [Stage 2 Unified Workspace acceptance](STAGE_2_UNIFIED_WORKSPACE.md)
