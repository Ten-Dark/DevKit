# DevKit Platform Roadmap

## Product direction

DevKit is evolving into an independent Developer Workspace Platform. The target is one modular workspace for projects, services, MCP integrations, storage, credentials, workflows and quality controls. The product direction is defined in [PRODUCT_VISION.md](PRODUCT_VISION.md); architecture boundaries are in [the Architecture Blueprint](architecture/ARCHITECTURE_BLUEPRINT.md).

The roadmap is intentionally MVP-first and organized into substantial, logically complete stages. Each stage contains a coherent chain of implementation tasks, integration and acceptance criteria. The governing process is [the development workflow](guides/development-workflow.md).

## Delivery principles

- Build a working vertical slice for each major stage; do not implement the entire target platform at once.
- Complete the planned task chain and integration for a stage before conducting its comprehensive stage audit.
- Keep MVP scope explicit and defer nonessential enhancements.
- Preserve existing DevKit workflows and security boundaries during the transition.
- Address critical security, data-loss, contract-breaking and integration-blocking defects immediately.
- Do not run repetitive full-repository audits after every small task.

## Major delivery stages

| Order | Stage | MVP outcome | Status |
| --- | --- | --- | --- |
| 0 | [Architecture Foundation](architecture/STAGE_0_FOUNDATION.md) | Verified baseline, architecture decisions, migration strategy and Stage 1 acceptance criteria | Complete |
| 1 | [DevKit Runtime](architecture/STAGE_1_RUNTIME.md) | Managed workspace paths, runtime/process lifecycle, configuration, service registry and structured logs | MVP accepted on Windows 11 x64; integrated into main |
| 2 | [Unified Workspace](architecture/STAGE_2_UNIFIED_WORKSPACE.md) | Dashboard, unified Services Hub, MCP Library, OS secret-protection boundary, read-only Storage foundations, and MCPWorkers management integration | Implementation, technical acceptance and final pre-integration audit complete on Windows 11 x64: authenticated MCPWorkers API v1, scoped KeePassXC token, Definition/Instance discovery, owned/external Manager lifecycle, NSIS-installed existing-data-root workflow, Karakeep connection-only credential resolution, and retirement of direct LocalMCP/Tunnel lifecycle controls are verified. Only explicit authorization to integrate into `main` remains. See Stage 2 acceptance gates. |
| 3 | Developer Utilities MVPs | F-09 Color Converter & Palette → F-10 Port Inspector → F-11 Project Inspector, each as a complete focused vertical slice | Planned; starts after Stage 2 is integrated into `main` and a clean baseline is established |
| 4 | Platform Inspector MVP | Service monitoring, deterministic validation, evidence-based reports, repeat inspection and update-readiness analysis | Planned; distinct from F-11 Project Inspector |
| 5 | Developer Workflow | Projects, tasks, workflow engine, agent/Git/build/release integrations and team foundations | Planned |
| 6 | Distribution & Independence | Portable packaging, backup/restore, migration, update/rollback and safe Complete Purge | Planned |

### Stage 0 — Architecture Foundation

Before broad implementation, establish:

1. Product vision, target users, goals and non-goals.
2. Core / Workspace / Extensions boundaries.
3. Runtime ownership, workspace layout and platform adapter strategy.
4. Service Registry, lifecycle and MCP/service adapter contracts.
5. Dependency graph, health/readiness model and orchestration policies.
6. Vault and Storage boundaries, security model and recovery requirements.
7. Inspector architecture and evidence model.
8. Migration strategy from the current toolbox and preservation of existing features.
9. Updated feature sequence, stage acceptance criteria and implementation risks.

Stage 0 is documentation and decision work, not permission to build speculative infrastructure. Once the minimum decisions needed for Stage 1 are clear, implementation should begin.

### Stage 1 — DevKit Runtime

Deliver a usable managed runtime slice: workspace layout, process manager, configuration manager, service registry, lifecycle operations, structured logs and basic health checks. Start with a small number of controlled services and prove ownership and cleanup behavior.

### Stage 2 — Unified Workspace

Deliver the workspace UI and real integrations incrementally: unified Services Hub, MCP Library, OS-backed secret-protection boundary, read-only Local/Obsidian Storage foundations, the user-approved Karakeep connection/authentication-only integration, and MCPWorkers management integration. Multi-AI Aggregator remains a separate launch-only integration. DevKit Runtime is the lifecycle authority for DevKit-managed components. MCPWorkers Manager must be registered as a managed workspace component: DevKit starts it when required, attaches to an already-running instance when appropriate, monitors it, and stops it only when DevKit owns the launched process. Stopping the workspace stops DevKit-owned components in reverse dependency order; externally running services are not terminated. Starting MCPWorkers Manager must not automatically start all Worker Instances. DevKit uses MCPWorkers Public API v1 from its trusted main process and must not manage Worker Instance processes or MCPWorkers Registry files directly. MCPWorkers remains authoritative for Worker Definitions/Instances, configuration, installation and worker lifecycle. The complete product Vault lifecycle is not part of this MVP. Preserve existing installations unless migration is explicitly requested.

### Stage 3 — Developer Utilities MVPs (F-09 → F-11)

Deliver three independent, focused utilities in this exact order, after Stage 2 is accepted:

1. **F-09 — Color Converter & Palette:** HEX/RGB/HSL conversion, synchronized values, copy actions, palette swatches and common color harmonies. Accessibility/contrast enhancements follow the core workflow.
2. **F-10 — Port Inspector:** read-only local listening-port diagnostics with process/protocol/address metadata where OS permissions allow. No process termination or firewall/network changes in the MVP.
3. **F-11 — Project Inspector:** safe project overview, architecture/directory map and bounded Markdown AI Context Pack. It may later grow into dependency/configuration/quality analysis, but its MVP is not the platform monitoring subsystem.

Each feature is a separately accepted vertical slice. Keep the sequence F-09 → F-10 → F-11 unless the user explicitly reprioritizes it.

### Stage 4 — Platform Inspector MVP

Deliver the broader Inspector subsystem for service monitoring, deterministic validation, evidence-based reports, repeat inspection, finding history and update-readiness analysis. Add AI-assisted analysis only after deterministic checks and evidence capture are reliable. The platform Inspector may reuse analysis primitives from F-11, but it has a separate responsibility and workflow; F-11 does not replace it.

### Stage 5 — Developer Workflow

Add project/task/workflow orchestration, agent and Git integrations, build/release coordination and team-oriented capabilities. Integrate with established tools rather than replacing them prematurely.

### Stage 6 — Distribution & Independence

Add platform-specific packaging, managed runtime distribution, backup/restore, import/export, migration, atomic updates, rollback and Complete Purge of DevKit-owned resources. Windows remains the sole supported platform until its Runtime and distribution flows meet production acceptance criteria. Linux/macOS are future targets: add them only after the Windows production gate, through dedicated platform adapters and real packaged validation.

## Planned DevKit feature sequence

These three feature specifications are the complete Stage 3 utility sequence. F-11 is a focused project-understanding utility. Stage 4 Platform Inspector is a separate service/update monitoring and validation subsystem; share analysis primitives where useful, but do not merge their responsibilities or treat one as a replacement for the other.

| Feature | Direction | Status |
| --- | --- | --- |
| [F-09 — Color Converter & Palette](features/F-09-color-converter.md) | HEX/RGB/HSL conversion, copy actions and basic color harmony palettes; later contrast and palette-generation polish | Planned |
| [F-10 — Port Inspector](features/F-10-port-inspector.md) | Read-only local listening-port diagnostics; later feed observations into Services/Inspector | Planned |
| [F-11 — Project Inspector](features/F-11-project-inspector.md) | Safe Project Overview, Architecture Map and Markdown AI Context Pack; later dependency/configuration/quality analysis | Planned |

## MCP and Skills catalogues

MCP Library and Skills Library are separate product areas. MCP discovery uses the official MCP Registry API and other publisher-controlled sources where supported. Skills discovery uses official APIs when available, otherwise official repository/release interfaces; do not assume one universal Skills API or scrape websites as a substitute. Both catalogues require provenance, version/compatibility metadata, review-before-activation and explicit trust/permission boundaries.

Skills Library is a planned post-Stage-2 vertical slice, not a Stage 2 acceptance gate. Do not expand the current Workspace MVP into a broad marketplace.

## Entry condition

Stage 0 architecture and Stage 1 Runtime MVP are integrated into `main`. Stage 1 acceptance evidence is recorded in [STAGE_1_RUNTIME.md](architecture/STAGE_1_RUNTIME.md); broader Windows production-readiness gates remain open. Stage 2 implementation, technical acceptance and final pre-integration audit are complete on `feat/unified-workspace-mvp`; integration into `main` remains pending explicit user authorization. Do not imply that planned platform capabilities are implemented before their acceptance checks pass.

## Stage lifecycle and acceptance

Each major stage follows:

1. Define the stage outcome, boundaries, contracts, dependencies and acceptance criteria.
2. Implement the full planned chain of logically related tasks.
3. Integrate the stage and validate its end-to-end workflows.
4. Conduct one comprehensive audit/review of the completed stage.
5. Correct findings and rerun relevant validation.
6. Document decisions, limitations and results; commit and integrate the stage.

The detailed process, audit policy and MVP completion criteria are defined in [the development workflow](guides/development-workflow.md).

## Scope control

Feature documents distinguish MVP requirements from polish and expansion. Items listed under polish are not prerequisites for the initial MVP unless later evidence reveals a core correctness or security requirement. Changes to the sequence or MVP boundary should be made in this roadmap and the relevant feature specification, not inferred from implementation notes.
