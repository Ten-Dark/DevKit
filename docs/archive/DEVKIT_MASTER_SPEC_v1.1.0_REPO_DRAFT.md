# DevKit — Master Product & Architecture Specification

**Document version:** 1.1.0\\
**Document type:** Historical repository draft; not an authoritative source\\
**Superseded by:** `DEVKIT_MASTER_SPEC_v1.1.1.md`\\
**Product:** DevKit — Independent Developer Workspace Platform\\
**Updated:** 2026-11-27\\
**Status:** ARCHIVED REPOSITORY DRAFT — not canonical; superseded by `DEVKIT_MASTER_SPEC_v1.1.1.md`. Retained only to preserve the earlier WIP snapshot.

> This is a product and architecture specification, not a claim that every target capability is implemented. Status labels distinguish accepted decisions, current implementation, targets and open work.

## 0. Document governance

This document uses independent semantic versioning. The document version is not the application, package, release, API or schema version.

- **MAJOR:** incompatible change to product vision or foundational architecture.
- **MINOR:** meaningful addition to product capabilities, architecture or roadmap that remains compatible.
- **PATCH:** corrections, editorial clarifications and refreshed evidence without a product-direction change.
- Keep versioned snapshots; do not silently overwrite prior versions.
- Promote this candidate to the active Project source only after review.
- Repository files, tests, release artifacts and verified runtime behavior outrank this document when determining implementation status.

### Revision history

| Version | Date | Change |
|---|---|---|
| 1.0.2 | 2026-11-24 | Previous consolidated baseline: Runtime, Stage 2 workspace, MCP/Storage boundaries and Windows process ownership |
| 1.1.0 | 2026-11-27 | Adds managed workspace startup/shutdown policy, MCP and Skills Libraries, unified local-service control, and explicit F-09/F-10/F-11 feature sequence; refreshes Stage 2 status |

### Status vocabulary

- **[DECIDED]** Approved product or architecture direction.
- **[CURRENT]** Implemented or evidenced state; verify against the current branch before relying on it.
- **[TARGET]** Intended capability, not necessarily implemented.
- **[OPEN]** Acceptance, design or implementation work remains.
- **[DEFERRED]** Intentionally postponed.

---

# 1. Product definition

DevKit is an independent, local-first **Developer Workspace Platform**: one entry point for a developer's projects, services, MCP servers, skills, storage systems, credentials, tools and development workflows.

DevKit is not an IDE replacement, a new bookmark manager, a password-manager replacement, or a monolith that absorbs every connected product. Specialist systems remain authoritative for their own data and operations. DevKit provides a coherent workspace UI, explicit integration contracts, service lifecycle coordination and observability.

**Product promise:** open DevKit to understand the workspace, access its capabilities, start the services it manages, inspect failures and close the workspace without leaving DevKit-owned processes running.

## 1.1 Product principles

1. **One entry point:** workspace operations should begin and end in DevKit.
2. **Explicit ownership:** every service is managed, connected, discovered or unmanaged; observation does not imply lifecycle authority.
3. **MVP-first delivery:** ship a complete, useful vertical slice before expansion.
4. **Modular architecture:** domain modules and adapters have explicit contracts; avoid a monolithic manager.
5. **Local-first and provider-neutral:** no mandatory hosted backend, paid API key or single AI provider for the core workflow.
6. **Security by boundary:** secrets remain in privileged processes and secret providers; untrusted projects and third-party packages are never implicitly trusted.
7. **Observable operation:** status, health, readiness, dependencies, logs and errors should be understandable.
8. **Evidence-based quality:** distinguish implementation, tests, live acceptance and future intent.
9. **Portable by design:** isolate OS-specific behavior behind adapters. Windows is the current supported production target; macOS/Linux are not declared production-ready.
10. **User control:** destructive operations and external side effects require explicit authorization.

## 1.2 Ownership modes

Every service, integration and resource must declare one of these modes:

- **Managed:** DevKit provisioned it and has a verified ownership record. DevKit may perform declared lifecycle operations.
- **Connected:** an external product/service remains owner. DevKit may use only explicitly granted API capabilities.
- **Discovered:** DevKit detected it but has not adopted or connected to it.
- **Unmanaged:** outside DevKit lifecycle and cleanup guarantees.

Never terminate a process solely because its PID or port was discovered. Process termination requires verified ownership.

---

# 2. Workspace Core and Runtime

## 2.1 Core responsibilities

Core coordinates workspace identity/configuration, service and adapter registries, process lifecycle, dependency planning, health/readiness, structured events, authorization and safe shutdown.

Core is a set of domain modules, not a universal service that absorbs every external product's internal logic.

## 2.2 Runtime responsibilities

Runtime is the common lifecycle authority for DevKit-managed processes and services. It should reuse the existing ProcessManager, process ownership and platform-control boundaries rather than introducing a second process manager.

Runtime provides:
- service registration and ownership metadata;
- start, stop, restart and status operations where supported;
- dependency-aware startup and reverse-order shutdown;
- process identity and process-tree ownership;
- readiness/health checks, bounded timeouts and retry policy;
- structured, secret-redacted logs and diagnostics;
- recovery from partial startup and application shutdown.

**[DECIDED] Workspace lifecycle:** when the user starts a workspace, DevKit starts the required DevKit-managed components in dependency order. When the user stops/closes the workspace, DevKit gracefully stops the components it owns in reverse dependency order. It must not stop connected or externally owned services without a separate explicit permission and verified ownership.

**[DECIDED] MCPWorkers Manager exception:** MCPWorkers Manager is to be registered as a DevKit-managed workspace component. DevKit must be able to start it, attach to an already-running healthy instance, monitor it, and stop it when DevKit owns the launched process. A Manager that was already running externally must be treated as externally owned and must not be terminated by DevKit. Manager startup does not mean that every Worker Instance is automatically started.

**[OPEN]** The packaged Manager runtime/sidecar strategy and authenticated live acceptance still need implementation and verification. A development command requiring a globally installed Node.js or a manually opened terminal is not an acceptable final installed-app workflow.

## 2.3 Service Hub

The Services Hub is the unified control surface for local services and connected applications. It should display:
- service name and category;
- management/ownership mode;
- running/stopped/starting/stopping/failed/degraded/unknown state;
- health/readiness and last check;
- endpoint/port when safe and relevant;
- version and runtime/dependency requirements;
- supported actions (Start/Stop/Restart/Open/Logs/Details);
- sanitized errors and logs.

Only show actions supported by the adapter and ownership policy. Launch-only applications remain launch-only; do not imply that DevKit can stop them.

Localhost services should be discovered or registered through explicit adapters. A reachable port is not proof of service identity or permission to control it.

---

# 3. MCP Library and MCPWorkers

These are separate responsibilities and must not be collapsed into one subsystem.

## 3.1 MCP Library

**[CURRENT]** The Stage 2 MCP Hub includes official MCP Registry discovery/search, cursor pagination, server details/version metadata, saved local stdio and remote Streamable HTTP connection definitions, manual configuration, trust confirmation and connection lifecycle.

**[TARGET]** MCP Library should provide one discoverable catalogue of MCP servers from official registries and publisher-controlled sources:
- search and browse servers;
- inspect publisher, repository, version, transport, package and declared requirements;
- distinguish registry metadata from security verification;
- save/configure a server without executing it;
- connect only after explicit user action and trust confirmation;
- show installed/saved connections and their status;
- update or remove only resources whose ownership and supported operations are clear.

Use official registry APIs where available. Do not scrape websites as a substitute for an official API. Registry metadata is untrusted publisher-supplied data, not a security certification. Never auto-install or execute a package merely because it appears in search results.

## 3.2 MCPWorkers

MCPWorkers remains a specialist platform and authoritative owner of its Worker Registry, Definitions, Instances, installation/activation, configuration, worker process lifecycle, health and failover.

DevKit integrates with MCPWorkers through its supported Public API v1 from the trusted main process. DevKit must not directly edit MCPWorkers Registry files, manage Worker Instance processes, or duplicate its internal lifecycle logic.

The responsibilities are:
- **DevKit Runtime:** lifecycle of the MCPWorkers Manager process as a workspace component.
- **MCPWorkers Manager:** lifecycle and management of Worker Instances through its API.
- **DevKit UI:** unified visibility and authorized API actions, with ownership clearly labelled.

Starting the Manager does not automatically start all workers. Worker start/stop/restart remains an explicit, separately authorized action through MCPWorkers API.

## 3.3 MCP security

- Local executable/package execution requires native trust confirmation.
- Remote endpoint connections require explicit review and secure transport except loopback.
- Credentials are resolved in the main process through secret references.
- Never expose secret values, raw command arguments or sensitive endpoint data to renderer/logs.
- Timeouts, cancellation, process-tree cleanup and bounded responses are mandatory.
- Tool discovery does not imply permission to invoke tools; tool invocation requires its own authorization model.

---

# 4. Skills Library

**[DECIDED — new product requirement]** Skills are a first-class capability catalogue, separate from MCP servers.

A Skill is an instruction bundle, workflow definition or agent capability package. It is not an MCP server and must not be represented as one. A Skill may reference or require MCP tools, but the dependency relationship must be explicit.

## 4.1 Skills Library targe

The Skills Library should support:
- browse and search supported Skills catalogues;
- inspect source, publisher/maintainer, version, compatibility, requirements and permissions;
- preview skill content and declared files before activation;
- connect/enable, disable, update and remove installed skills;
- show installation location, provenance and current version;
- detect incompatible or missing dependencies;
- distinguish trusted/verified sources from unverified community content.

Use official APIs where a source provides one; otherwise use the publisher's official repository/release interface. There is no assumption that one universal official Skills API exists. Source adapters must be explicit and versioned. Avoid scraping and never execute arbitrary content during browsing.

## 4.2 Trust and permissions

Skills are untrusted content until reviewed. Installing or enabling a Skill must not silently grant filesystem, network, shell, secret or MCP tool access. Permissions must be declared, scoped, reviewable and enforced by the host agent/runtime where technically supported. If the host cannot enforce a requested permission boundary, DevKit must disclose the limitation and avoid presenting the Skill as sandboxed.

## 4.3 Delivery boundary

Skills Library is a roadmap capability, not a Stage 2 acceptance gate. First deliver the MCPWorkers/Workspace lifecycle foundation; then schedule the Skills Library as its own vertical slice with source adapters, trust model and installation lifecycle.

---

# 5. Integrations and storage

DevKit connects specialist systems without taking ownership of their data.

- **Local Folder:** bounded, read-only metadata access unless a later capability is explicitly approved.
- **Obsidian:** selected vault integration with read-only Markdown preview in the current MVP.
- **Karakeep:** connection/authentication-only in the accepted current scope. Do not list, search, preview, index, download or otherwise access bookmark content.
- **KeePassXC:** optional secret provider; store references, resolve secrets only in privileged processes.
- **Multi-AI Aggregator:** separate launch-only integration unless a future supported API contract is agreed. DevKit must not force-terminate it.
- **LocalMCP / LocalMCP Tunnel / Chat2Agent:** integrate through the MCPWorkers management boundary where applicable; avoid parallel direct lifecycle ownership in the final accepted workflow.

A connection never grants implicit access to content or destructive operations. Provider data remains authoritative in the original system.

---

# 6. Inspector and analysis capabilities

Inspector is an independent subsystem. It must not become a dependency of Core or prevent the workspace from operating if Inspector is unavailable.

Inspector combines deterministic checks, evidence collection and (later) AI-assisted interpretation. Reports must distinguish:
- directly observed facts;
- deterministic rule findings;
- heuristic/inferred findings and confidence;
- AI-generated suggestions.

The first useful Inspector workflow should be read-only and reproducible. Project scripts, builds, tests, package managers and arbitrary commands must not run during passive inspection. Execution-capable checks require a separate trusted-project policy, explicit user authorization, bounded resources and an isolated execution boundary.

Inspector reports should contain scope, timestamp, environment, checks performed, skipped checks, evidence, severity, confidence, remediation guidance and repeat-inspection comparison. Secrets must be redacted.

---

# 7. Three planned DevKit features

The following three feature specifications remain part of the product plan. They are not considered implemented merely because their documents exist.

## F-09 — Color Converter & Palette

**Status:** Planned. **Delivery order:** 1.

A focused utility for selecting/entering a color, validating it, converting HEX/RGB/HSL, copying representations and generating basic color harmonies.

MVP:
- color picker and manual input;
- synchronized HEX, RGB and HSL representations;
- validation that preserves the last valid value;
- independent copy actions;
- basic complementary and analogous palettes.

Polish:
- shade/tint generation and additional harmony modes;
- WCAG foreground/background contrast ratio and criterion-specific guidance;
- additional CSS/alpha-aware formats where justified.

This is a standalone utility, not a full design-token manager or design-system editor.

## F-10 — Port Inspector

**Status:** Planned. **Delivery order:** 2.

A read-only local diagnostic utility showing listening TCP/UDP ports, bind addresses, process names and PIDs where available.

MVP:
- local OS-backed snapshot;
- search/filter and manual refresh;
- clear snapshot timestamp;
- graceful partial results and permission-error reporting.

No process termination, restart, firewall modification, remote scanning or network discovery. Later, its observations may feed Service Hub/Inspector diagnostics without transferring lifecycle authority.

## F-11 — Project Inspector

**Status:** Planned. **Delivery order:** 3.

A bounded, read-only project analysis workflow that creates:
- Project Overview;
- initial Architecture Map;
- Markdown AI Context Pack.

It detects project structure and supported metadata, applies ignore rules and sensitive-file exclusions, reports scan coverage, supports cancellation and enforces resource limits. Passive inspection must not execute project code, scripts, package managers or arbitrary commands.

Post-MVP analysis increments:
1. dependency and lockfile analysis without installing packages;
2. configuration analysis with secret redaction;
3. explainable quality/risk signals;
4. static testing-framework discovery;
5. feature-impact analysis with transparent confidence;
6. structured JSON Context Pack.

F-11 is the focused Project Inspector vertical slice within the broader Inspector architecture. Do not build two competing project-analysis systems.

---

# 8. Delivery roadmap and stage gates

The delivery order is intentional. Do not expand Stage 2 into a marketplace or full Skills Library before the first workspace workflow is accepted.

| Stage | Name | Outcome | Current status |
|---|---|---|---|
| 0 | Architecture Foundation | Product boundaries, architecture and delivery plan | Complete |
| 1 | DevKit Runtime | Workspace paths, process ownership, lifecycle, service registry and logs | MVP accepted on Windows 11 x64; integrated into main |
| 2 | Unified Workspace | Dashboard, Services Hub, MCP Library, Storage foundations, secrets boundary, MCPWorkers integration | In progress; implementation and substantial validation exist, final live/lifecycle acceptance and integration remain |
| 3 | Inspector MVP | Service observation, deterministic checks, evidence-based reports, Project Inspector foundation | Planned |
| 4 | Developer Workflow | Projects, tasks, workflows, agent/Git/build/release integrations | Planned |
| 5 | Distribution & Independence | Portable packaging, backup/restore, migration, update/rollback, safe purge | Planned |

### Stage 2 — remaining acceptance gates

Stage 2 is not complete until:
1. MCPWorkers Manager is launched/attached and supervised through DevKit Runtime according to ownership rules.
2. DevKit can stop only the Manager process it owns; externally running Manager instances are not terminated.
3. Authenticated API v1 live acceptance passes against a running Manager, including stale/degraded/conflict behavior.
4. Packaged/installed DevKit can launch the managed Manager without a manually opened terminal or globally installed development runtime.
5. Transitional direct lifecycle controls are removed or explicitly retired from the accepted workflow where MCPWorkers is the selected owner.
6. Final tests, packaged acceptance and one final stage audit pass after the Manager integration changes.
7. Stage 2 documentation is reconciled and the user authorizes integration into main.

Karakeep remains connection-only and must not access bookmark content. The complete product Vault lifecycle is not a Stage 2 gate. Skills Library and broad marketplace-style installation are not Stage 2 gates.

### Post-Stage-2 feature sequencing

1. F-09 Color Converter & Palette — focused utility vertical slice.
2. F-10 Port Inspector — read-only local diagnostics; later feed Service Hub/Inspector.
3. F-11 Project Inspector — safe project overview, architecture map and AI Context Pack.
4. Expand Inspector with deterministic service/project checks, evidence history and repeat inspection.
5. Add AI-assisted analysis only after deterministic findings and evidence boundaries are reliable.
6. Deliver Skills Library as a separate source-adapter and trust-controlled vertical slice.
7. Expand developer workflows and distribution according to their stage gates.

The detailed feature documents remain authoritative for individual MVP acceptance criteria.

---

# 9. Current repository snapshot — 2026-11-27

**[CURRENT — repository snapshot, not release acceptance]**
- Active branch: `feat/unified-workspace-mvp`.
- Local HEAD at inspection: `2e2d874` (`feat(workspace): add unified workspace foundations`), one commit ahead of `origin/main`.
- The working tree contains extensive uncommitted Stage 2 changes and untracked integration, storage, bootstrap and documentation files. Preserve all WIP.
- Latest documented validation: 531 tests across 50 files; TypeScript and ESLint clean; development E2E 4/4; packaged E2E 5/5; NSIS installation and installed-app E2E 5/5; installer/uninstaller exit codes 0. These results predate or do not establish all newly required MCPWorkers live/managed-startup acceptance.
- A Stage 2 audit was performed on 2026-11-27 before the latest MCPWorkers integration additions. It is historical evidence, not the final post-integration audit.
- Karakeep connection-only status was user-confirmed as Connected. No bookmark-content access is allowed.
- MCPWorkers API client, Services UI, scoped credential flow and explicit Worker Instance lifecycle UI are present in WIP; authenticated live Manager acceptance remains open.
- Automatic managed Manager startup/shutdown through DevKit Runtime is a newly clarified requirement and must not be marked complete until implemented and tested.
- Stage 2 is not accepted and the branch has not been integrated into main.

Before relying on this snapshot, re-check Git status, current HEAD, tests and runtime behavior. Do not commit, push, merge, reset, stash or discard user WIP without explicit authorization.

---

# 10. Engineering workflow

1. Deliver the smallest complete user workflow.
2. Implement in logical zones: critical correctness/security, important UX/reliability, later polish.
3. Add focused tests alongside implementation.
4. Complete integration and end-to-end acceptance.
5. Perform one meaningful stage-level review/audit after the task chain, not repetitive speculative audits.
6. Fix actionable findings and rerun affected checks.
7. Update roadmap, feature docs, architecture decisions and validation evidence.
8. Commit using Conventional Commits only when explicitly authorized by the user.

Do not claim production readiness from compilation or unit tests alone. Distinguish unit tests, development E2E, packaged E2E, installed-app validation, live external-service acceptance and release readiness.

## 10.1 Documentation map

- `docs/ROADMAP.md` — active delivery sequence and feature ordering.
- `docs/architecture/STAGE_2_UNIFIED_WORKSPACE.md` — Stage 2 implementation, validation and acceptance.
- `docs/architecture/MCPWORKERS_INTEGRATION.md` — DevKit/MCPWorkers ownership and API contract.
- `docs/MCP-INTEGRATIONS.md` — MCP Registry, connections and integration behavior.
- `docs/architecture/INSPECTOR.md` — Inspector architecture and evidence model.
- `docs/features/F-09-color-converter.md` — Color Converter & Palette.
- `docs/features/F-10-port-inspector.md` — Port Inspector.
- `docs/features/F-11-project-inspector.md` — Project Inspector.
- `docs/DEVELOPMENT_WORKFLOW.md` — MVP-first delivery and review policy.

When a detailed document conflicts with this master specification, resolve the conflict explicitly and update both sources; do not silently choose whichever is newer.
