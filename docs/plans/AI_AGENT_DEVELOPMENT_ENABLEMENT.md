# AI Agent Development Enablement — Task Plan

**Parent capability:** Stage 5 — Developer Workflow
**Status:** Planned; the current DevKit implementation does not yet satisfy this plan.
**Architecture:** [AI Agent Development Infrastructure](../architecture/AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md)
**MCP transport proposal:** [MCPWorkers MCP Transport](../architecture/MCPWORKERS_MCP_TRANSPORT_PROPOSAL.md)
**First Skill draft:** [Feature-ADR](../../skills/feature-adr/SKILL.md)
**Decisions:** [ADR-0001](../architecture/decisions/ADR-0001-devkit-agent-control-plane.md); [ADR-0002](../architecture/decisions/ADR-0002-mcpworkers-only-local-mcp-runtime.md)

## Delivery boundary

This plan must not expand the in-progress Stage 2 Unified Workspace MVP or bypass the existing Stage 3 and Stage 4 sequence. A small documentation/local pilot may be conducted earlier, but DevKit product acceptance belongs to Stage 5.

The implementation should be delivered as one useful vertical slice at a time. Do not build a generalized marketplace or adapter framework before a real end-to-end project workflow proves the required contracts.

## Backlog

| ID | Priority | Task | Dependencies | Acceptance evidence |
|---|---|---|---|---|
| DAI-00 | P0 | Publish architecture decision, master-source update, templates and this task plan | None | Reviewed docs committed; source replacement instructions provided |
| DAI-01 | P0 | Define and verify the MCPWorkers-managed MCP transport contract for the required tool-call path | Stage 2 acceptance; MCPWorkers API v1 and Worker Contract | Versioned contract plus integration evidence for MCP initialize, tool discovery/calls, cancellation and session cleanup through a Manager-owned runtime; no LocalMCP dependency |
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

### DAI-01 — MCPWorkers transport contract

- Inspect the public MCPWorkers API v1, Worker Contract, Manager adapter registry, and DevKit's existing scoped-client implementation.
- Confirm the current external client permissions: read, health, and explicit lifecycle. Registry mutation, package installation, configuration mutation, and credential administration are not available to the current DevKit client scopes.
- Confirm that capability matching is candidate selection only and does not forward MCP tool traffic.
- Do not inspect, configure, start, stop, update, uninstall, or otherwise interact with LocalMCP, LocalMCP-Tunnel, or any UserProfile-linked LocalMCP configuration. They are explicitly outside this implementation.
- Record the current gap: API v1 is a Worker control plane, not a generic MCP gateway; it has no documented MCP session/transport endpoint for forwarding initialize, tools/list, tools/call, cancellation, and session cleanup.
- Define a narrow, versioned MCPWorkers-owned transport contract with project scoping, authentication, capability declarations, bounded resources, and sanitized diagnostics. Do not write to Manager private files or bypass its adapters.
- Do not start/stop existing live Workers during read-only discovery or change their state as part of contract design.

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
7. Connect through the MCPWorkers-owned MCP transport; do not launch an unmanaged local MCP process as a fallback.
8. Display actual health and tools, with sanitized diagnostics.
9. Disable or remove without deleting unrelated worker/runtime data.

### DAI-05 — CodeGraph pilot

- Select one representative large project with enough modules/dependencies to measure retrieval improvement.
- Configure a project-local index and respect ignore/exclusion rules.
- Expose CodeGraph to the project profile only through the verified MCPWorkers-owned transport. Its upstream `codegraph install` command must not be used because it writes directly to external agent configurations.
- Measure time/tool calls spent locating relevant symbols, dependencies and call paths before/after.
- Validate graph freshness after source changes.
- Do not add Serena in parallel unless a demonstrated gap remains.

### DAI-06 — Feature-ADR Skill adaptation

- Use the open Agent Skills directory format and validate the required `SKILL.md` frontmatter and directory naming.
- Maintain the DevKit-native source at `skills/feature-adr/SKILL.md`; a repository-local draft now exists but is not installed or active in any client.
- Review upstream package contents and supported host behavior as reference only. Do not run its installer or copy host-specific hooks, agents, commands, or runtime dependencies.
- Adapt the useful requirements, research, ADR, planning, implementation and verification workflow in original DevKit wording.
- Use S/M/L routing; no XL tier, subagents, swarm, fleet, or parallel-worker requirement.
- Keep quick, well-understood fixes on the small path.
- Add a Skill Library/client-adapter implementation only after the format, provenance, permission and non-destructive materialization contract is agreed.

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

- Start with the local agent/runtime path through MCPWorkers only; do not add LocalMCP or another parallel local MCP runtime.
- Define adapter contracts independently of UI components.
- Keep secrets and local-only endpoints out of exported configuration.
- Treat GPT.com/ChatGPT Web as an optional remote client requiring a supported secure transport; do not make it the primary runtime.
- Test each client separately and report unsupported features explicitly.

## Definition of done

The Stage 5 capability is complete only when one real project can be onboarded, assigned an Agent Profile, given the correct project instructions and Skills, connected to the required MCP tools through a verified runtime, and developed through the single-agent Change-Scoped workflow with reproducible validation and traceable Git changes.

The completion report must distinguish implemented, tested, and unverified behavior. It must state which MCP/Skills were actually enabled, which checks ran, which limitations remain, and how to roll back the configuration.
