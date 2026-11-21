# DevKit Platform Roadmap

## Product direction

DevKit is evolving into an independent Developer Workspace Platform. The target is one modular workspace for projects, services, MCP integrations, storage, credentials, workflows and quality controls. The product direction is defined in [PRODUCT_VISION.md](PRODUCT_VISION.md); architecture boundaries are in [the Architecture Blueprint](architecture/ARCHITECTURE_BLUEPRINT.md).

The roadmap is intentionally MVP-first and organized into substantial, logically complete stages. Each stage contains a coherent chain of implementation tasks, integration and acceptance criteria. The governing process is [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md).

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
| 1 | DevKit Runtime | Managed workspace paths, runtime/process lifecycle, configuration, service registry and structured logs | Ready |
| 2 | Unified Workspace | Dashboard, Services and MCP hubs, Vault/Storage integration foundations and service management UI | Planned |
| 3 | Inspector | Infrastructure health observation, project inspection, evidence-based reports and repeat inspection | Planned |
| 4 | Developer Workflow | Projects, tasks, workflow engine, agent/Git/build/release integrations and team foundations | Planned |
| 5 | Distribution & Independence | Portable packaging, backup/restore, migration, update/rollback and safe Complete Purge | Planned |

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

Deliver the workspace UI and connect real integrations incrementally: Services Hub, MCP Hub, Vault foundation, Storage providers for Karakeep and Obsidian, and management of selected existing services such as MultiAggregator. Preserve existing installations unless migration is explicitly requested.

### Stage 3 — Inspector

Deliver service monitoring and project inspection with deterministic checks first, then AI-assisted analysis, repeat inspections, finding history and release-readiness policies. Inspector must be able to inspect DevKit without becoming a dependency of Core.

### Stage 4 — Developer Workflow

Add project/task/workflow orchestration, agent and Git integrations, build/release coordination and team-oriented capabilities. Integrate with established tools rather than replacing them prematurely.

### Stage 5 — Distribution & Independence

Add platform-specific packaging, managed runtime distribution, backup/restore, import/export, migration, atomic updates, rollback and Complete Purge of DevKit-owned resources. Expand Linux/macOS support only with platform adapters and real validation.

## Existing feature specifications

The existing utility roadmap remains valid, but its position is subordinate to the new platform foundation. F-09 and F-10 can remain useful Toolbox vertical slices. F-11 should be reconciled with the broader Project Inspector design so its existing safe Markdown Context Pack workflow is preserved rather than duplicated.

| Feature | Direction | Status |
| --- | --- | --- |
| [F-09 — Color Converter](features/F-09-color-converter.md) | Retain as a focused Toolbox utility; schedule when it fits the active stage | Planned |
| [F-10 — Port Inspector](features/F-10-port-inspector.md) | Retain as a read-only diagnostic utility; later connect its observations to service/port diagnostics | Planned |
| [F-11 — Project Inspector](features/F-11-project-inspector.md) | Reconcile with Inspector architecture; preserve safe Context Pack export as a useful first vertical slice | Planned |

## Entry condition

The current application remains the baseline while Stage 0 documentation is established. Do not interrupt active stabilization work or imply that planned platform capabilities are already implemented. The next implementation stage begins when its required architecture contracts and acceptance criteria are sufficiently clear.

## Stage lifecycle and acceptance

Each major stage follows:

1. Define the stage outcome, boundaries, contracts, dependencies and acceptance criteria.
2. Implement the full planned chain of logically related tasks.
3. Integrate the stage and validate its end-to-end workflows.
4. Conduct one comprehensive audit/review of the completed stage.
5. Correct findings and rerun relevant validation.
6. Document decisions, limitations and results; commit and integrate the stage.

The detailed process, audit policy and MVP completion criteria are defined in [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md).

## Scope control

Feature documents distinguish MVP requirements from polish and expansion. Items listed under polish are not prerequisites for the initial MVP unless later evidence reveals a core correctness or security requirement. Changes to the sequence or MVP boundary should be made in this roadmap and the relevant feature specification, not inferred from implementation notes.
