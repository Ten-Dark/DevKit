# AI Agent Development Enablement — Task Plan

**Parent capability:** Stage 5 — Developer Workflow
**Status:** Planned; the current DevKit implementation does not yet satisfy this plan.
**Architecture:** [AI Agent Development Infrastructure](../architecture/AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md)
**Decision:** [ADR-0001](../architecture/decisions/ADR-0001-devkit-agent-control-plane.md)

## Delivery boundary

This plan must not expand the in-progress Stage 2 Unified Workspace MVP or bypass the existing Stage 3 and Stage 4 sequence. A small documentation/local pilot may be conducted earlier, but DevKit product acceptance belongs to Stage 5.

The implementation should be delivered as one useful vertical slice at a time. Do not build a generalized marketplace or adapter framework before a real end-to-end project workflow proves the required contracts.

## Backlog

| ID | Priority | Task | Dependencies | Acceptance evidence |
|---|---|---|---|---|
| DAI-00 | P0 | Publish architecture decision, master-source update, templates and this task plan | None | Reviewed docs committed; source replacement instructions provided |
| DAI-01 | P0 | Verify MCPWorkers API v1 and LocalMCP external-gateway contract for the required MCP/Skills operations | Stage 2 acceptance; current MCPWorkers docs | Contract matrix names supported operations, ownership, permissions and unsupported operations; no private-file access |
| DAI-02 | P0 | Define project Agent Profile schema and lifecycle states | DAI-01 | Versioned schema, migration policy, required/optional capabilities, client targets, validation and secret-reference rules |
| DAI-03 | P0 | Implement project context standards: AGENTS.md bootstrap/merge, ADR template, source hierarchy and Change-Scoped Development workflow | DAI-02 | Existing user edits are preserved; generated updates are diffable; a sample project passes the workflow |
| DAI-04 | P1 | Build the first useful DevKit control-plane vertical slice: browse/review MCP and Skills, assign an Agent Profile, validate prerequisites and show actual runtime state | DAI-01, DAI-02 | One project profile can be reviewed and activated through supported APIs; install/enable/start remain explicit |
| DAI-05 | P1 | Integrate CodeGraph as the first structural code-index MCP | DAI-01, DAI-04 | A representative large project can answer symbol/dependency/impact queries; index freshness and repository ignore boundaries are verified |
| DAI-06 | P1 | Adapt Feature-ADR Pipeline into a single-agent Skill set | DAI-03 | S/M/L workflows work without requiring swarm/fleet/subagents; Skill source, version and permissions are visible |
| DAI-07 | P2 | Add Semgrep as an optional Security Review profile | DAI-04 | Security checks run on an explicit target scope; findings include evidence and are not treated as automatic proof of functional correctness |
| DAI-08 | P3 | Run a Neural Memory pilot and decide adopt/defer/remove | DAI-03, DAI-05 | Precision, stale/conflicting recall, project isolation, export/deletion and measurable time/token impact are recorded |
| DAI-09 | P2 | Add agent/client adapters and configuration export, including remote-client compatibility analysis | DAI-02, DAI-04 | Local agent works independently; each remote client declares actual transport and capability constraints; no insecure endpoint exposure |

Priorities indicate product sequence, not permission to skip dependencies or current stage gates.

## Detailed work packages

### DAI-01 — Contract verification

- Inspect the current public MCPWorkers API v1 and Worker Contract.
- Confirm what MCPWorkers manages directly and which operations are supported by each existing Worker adapter.
- Verify LocalMCP external-gateway configuration, lifecycle, tool discovery/forwarding, Skill loading, reload semantics, and credential references for the actual version in use.
- Identify which operations DevKit can perform through documented interfaces.
- Record gaps. If a necessary operation is missing, define a narrow versioned API proposal instead of writing to internal files.
- Do not start/stop existing live workers during read-only discovery.

### DAI-02 — Agent Profile contract

Define a minimal versioned manifest. At minimum it should describe:

- schema version and project identity;
- profile ID and selected agent/client targets;
- MCP server IDs, version constraints, required/optional state and capabilities;
- Skill IDs, version constraints and activation state;
- permissions and trust/approval metadata;
- logical secret references only;
- configuration source/owner and runtime adapter;
- export compatibility and unsupported capability reporting.

Do not put runtime process IDs, resolved tokens, passwords, host-specific absolute paths, or private credentials in a committed project profile.

### DAI-03 — Project context standard

- Provide and document AGENTS.md and ADR templates.
- Keep root instructions concise and project-specific.
- Link to focused architecture and feature documents rather than embedding the full architecture into every prompt.
- Define S/M/L routing and single-agent Change-Scoped Development.
- Preserve user-edited instruction files. Updates must provide a diff/merge or additive patch; no blind overwrite.
- Record durable architecture decisions and update docs only when durable knowledge changes.

### DAI-04 — Control-plane vertical slice

Deliver an end-to-end workflow for one project:

1. Find a supported MCP/Skill in an official or publisher-controlled source.
2. Inspect provenance, version, compatibility, permissions and requirements.
3. Save a configuration without executing it.
4. Assign it to an Agent Profile.
5. Validate runtime and client compatibility.
6. Obtain explicit approval before installation/activation or new permissions.
7. Connect using the correct runtime adapter.
8. Display actual health and tools, with sanitized diagnostics.
9. Disable or remove without deleting unrelated worker/runtime data.

### DAI-05 — CodeGraph pilot

- Select one representative large project with enough modules/dependencies to measure retrieval improvement.
- Configure a project-local index and respect ignore/exclusion rules.
- Expose CodeGraph to the project profile through a verified MCP runtime path.
- Measure time/tool calls spent locating relevant symbols, dependencies and call paths before/after.
- Validate graph freshness after source changes.
- Do not add Serena in parallel unless a demonstrated gap remains.

### DAI-06 — Feature-ADR Skill adaptation

- Review upstream package contents and supported host targets before installation.
- Extract/rewrite the useful workflow into versioned Skills under DevKit management.
- Preserve requirements, research, ADR, plan, implementation and verification stages where complexity justifies them.
- Use S/M/L routing.
- Remove mandatory multi-agent, swarm, fleet, or parallel-worker assumptions.
- Keep quick, well-understood fixes on the small path.

### DAI-07 — Semgrep profile

- Select local CLI or MCP integration based on supported, maintained interfaces and deployment constraints.
- Make the profile opt-in or risk-triggered.
- Run relevant rules against changed files or affected modules where supported.
- Triage findings against real call paths; do not treat every rule hit as a confirmed defect.
- Keep unit/integration tests, type checks, lint, build and runtime checks as separate quality evidence.

### DAI-08 — Neural Memory evaluation

Do not install it as a base dependency. Compare it against the baseline consisting of repository source, AGENTS.md, architecture docs, ADRs, task docs, and CodeGraph.

Evaluate:
- retrieval precision and relevance;
- stale, contradictory, or cross-project recall;
- project scoping and data isolation;
- deletion, export, backup and recovery;
- latency and context/token overhead;
- measurable reduction in repeated exploration or implementation time.

Adopt only if it provides a measurable benefit and can be clearly subordinated to current repository evidence.

### DAI-09 — Agent/client adapters

- Start with the local agent/runtime path already available through MCPWorkers and LocalMCP.
- Define adapter contracts independently of UI components.
- Keep secrets and local-only endpoints out of exported configuration.
- Treat GPT.com/ChatGPT Web as an optional remote client requiring a supported secure transport; do not make it the primary runtime.
- Test each client separately and report unsupported features explicitly.

## Definition of done

The Stage 5 capability is complete only when one real project can be onboarded, assigned an Agent Profile, given the correct project instructions and Skills, connected to the required MCP tools through a verified runtime, and developed through the single-agent Change-Scoped workflow with reproducible validation and traceable Git changes.

The completion report must distinguish implemented, tested, and unverified behavior. It must state which MCP/Skills were actually enabled, which checks ran, which limitations remain, and how to roll back the configuration.
