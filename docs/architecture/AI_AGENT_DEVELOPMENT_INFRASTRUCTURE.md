# AI Agent Development Infrastructure

**Status:** Accepted product direction; implementation is planned and must follow the DevKit stage gates.
**Scope:** Project-aware MCP and Skills management, agent profiles, durable project context, and efficient single-agent development workflows.
**Decision records:** [ADR-0001 — DevKit Agent Development Control Plane](decisions/ADR-0001-devkit-agent-control-plane.md); [ADR-0002 — MCPWorkers-only Local MCP Runtime](decisions/ADR-0002-mcpworkers-only-local-mcp-runtime.md)
**Implementation backlog:** [AI Agent Development Enablement](../plans/AI_AGENT_DEVELOPMENT_ENABLEMENT.md)

## 1. Goal

DevKit becomes the single control point through which a developer discovers, reviews, configures, assigns, and monitors development MCP servers and agent Skills across projects and supported AI clients.

The goal is not to make DevKit a mandatory proxy for every tool call. It is to centralize configuration and governance while preserving independent runtimes and direct, supported connections.

The architecture must reduce repeated repository exploration, context loss, unnecessary broad audits, and regressions without replacing the developer's IDE, Git host, build tools, or preferred AI client.

## 2. Three-plane architecture

| Plane | Owner | Responsibilities | Must not do |
|---|---|---|---|
| Control Plane | DevKit | MCP/Skills catalogues, provenance, reviewed configurations, project profiles, client compatibility, policy, approvals, status presentation | Execute every tool call or duplicate external runtime internals |
| Runtime Plane | MCPWorkers and the specific worker/runtime | Install and operate its own Worker Definitions/Instances; expose supported tools and lifecycle through versioned contracts | Allow DevKit to mutate private registries or bypass worker contracts |
| Consumer Plane | AI agent / IDE / supported client | Consume project instructions, enabled Skills and approved MCP tools | Become the source of truth for shared configuration or secrets |

DevKit is the user-facing source of intent and project-to-tool assignment. Runtime-specific configuration and process state remain owned by the runtime that executes them.

### 2.1 DevKit Control Plane

DevKit owns:

- MCP and Skills catalogue metadata, canonical source identity, publisher/provenance and version information.
- Reviewed connection definitions and the mapping from projects to approved tools.
- Project-level Agent Profiles and supported client export/adapter configuration.
- User approvals, capability declarations, compatibility information, and sanitized diagnostics.
- References to secrets, never plaintext secret values in project manifests or catalogue metadata.

The existing MCP Library and Skills Library remain separate domains. A Skill is an instruction/capability package, not an MCP server.

### 2.2 MCPWorkers Runtime Plane

MCPWorkers remains independently usable and owns its Worker Definitions, Worker Instances, installations, worker configuration, worker lifecycle, health observations, and Registry persistence.

DevKit integrates with MCPWorkers through its documented, versioned Public API. DevKit Runtime may own the MCPWorkers Manager process only when DevKit launched it; it must attach safely to an already-running Manager and must not stop an externally owned Manager.

The current MCPWorkers API v1 and Worker Contract describe Worker Definitions/Instances, not a universal API for arbitrary third-party MCP server configuration. Do not assume that every MCP server can be installed as an MCPWorkers Worker without a separately verified Definition, adapter, and contract.

### 2.3 MCPWorkers as the only local MCP runtime

MCPWorkers is the sole local MCP runtime in the target DevKit toolchain. Do not introduce LocalMCP, LocalMCP-Tunnel, or another parallel local MCP service into the new integration path. Existing LocalMCP-based tools and configurations in the developer environment are explicitly outside this work: do not inspect, reconfigure, start, stop, update, remove, or otherwise alter them.

The current MCPWorkers Public API v1 is a Worker control plane, not a universal MCP gateway. It manages Worker Definitions and Instances through Manager-owned APIs and adapters; the current external DevKit client scopes cover read, health, and lifecycle operations. Capability matching selects candidate Instances but does not proxy MCP tool calls. The current contract does not define a generic MCP stdio-to-client transport, session broker, or Streamable HTTP endpoint.

Before a local MCP such as CodeGraph can be consumed through MCPWorkers, the Manager must provide a versioned transport contract that owns the worker process and forwards MCP initialization, tool discovery, tool calls, cancellation, and session cleanup to authorized clients. It must enforce project scope, authentication/authorization, resource limits, diagnostics, and capability declarations. Until that exists, do not launch the server directly from DevKit or claim it is managed by MCPWorkers.

DevKit must use only the MCPWorkers Public API for Manager/Worker state and operations. It must not read or write private Registry/configuration files, resolve Manager root credentials, or bypass Worker adapters.

### 2.4 External MCP connections

The new local MCP integration path is MCPWorkers-only. Remote hosted MCP endpoints may be treated as external connections only through an explicitly supported DevKit adapter and security model; they are not local MCPWorkers Instances and must not be presented as Manager-managed workers. Do not add a second local MCP runtime as a fallback.

A server discovered in a catalogue is not installed, approved, enabled, or running. Those are separate states.

The current MCPWorkers-owned MCP transport proposal is documented in [MCPWORKERS_MCP_TRANSPORT_PROPOSAL.md](MCPWORKERS_MCP_TRANSPORT_PROPOSAL.md). It is a design proposal, not an implemented API contract.

## 3. Project Agent Profiles

An Agent Profile is a project-specific, versionable declaration of the MCP servers, Skills, instructions, and validation expectations needed for a category of work.

Initial conceptual profiles:

- **Core Development:** project navigation, repository file access, Git workflow, tests/builds, and project instructions.
- **Feature Development:** Core Development plus Feature-ADR workflow and the selected project-specific engineering Skills.
- **Codebase Analysis:** CodeGraph and documentation retrieval; read-oriented by default.
- **Security Review:** Semgrep and the project's relevant security checks.
- **Release / Delivery:** Git, build, package, release validation, and evidence reporting.

Profiles are opt-in and composable. The default profile must remain small. Do not attach every installed MCP or Skill to every project or task.

A project profile manifest may be committed to the project repository. It must contain only non-secret identifiers, versions or version ranges, required capabilities, and secret references by logical name. It must never contain tokens, passwords, private keys, or resolved secret values.

**Proposed project manifest location:** .devkit/agent-profile.json. This path and schema are targets; finalize them only after a concrete vertical slice and migration decision.

Profiles must support:

- required versus optional MCP servers and Skills;
- pinned or bounded versions where supported;
- supported agent/client targets;
- declared capabilities and permissions;
- explicit enable/disable state;
- validation of missing or incompatible dependencies;
- export without exposing secret values.

## 4. Agent and client adapters

DevKit should provide an adapter boundary rather than a single hard-coded agent configuration format.

An adapter translates the project's approved Agent Profile into the configuration and installation conventions supported by a specific host. It must report unsupported features rather than silently dropping them.

Local agents should connect through the local worker/runtime path wherever supported. A remote client such as ChatGPT Web is a separate target: it can consume a local MCP only through a supported secure remote endpoint or tunnel. Never expose a loopback service directly to the public Internet or assume that a client supports arbitrary local MCP processes.

The absence of a client adapter must not block local development or the operation of MCPWorkers.

## 5. Project context and durable knowledge

Use distinct sources for distinct kinds of knowledge:

| Source | Stores | Authority |
|---|---|---|
| Current repository and tests | Actual implementation and observed behavior | Highest authority for current state |
| AGENTS.md | Stable project instructions, architecture constraints, commands, conventions and definition of done | Authoritative instructions for agents working in that project |
| Architecture docs | Current system boundaries and module responsibilities | Project design reference; update with meaningful architecture changes |
| ADRs | Decisions, rationale, alternatives and consequences | Historical decision record; superseded decisions remain traceable |
| Feature/task documents | Scope, acceptance criteria, plan and verification evidence | Authority for that feature/task |
| Optional Neural Memory | Historical observations, recurring pitfalls and useful retrieval cues | Advisory only; never overrides source code, tests, current docs or ADRs |

Do not copy the full repository architecture into every prompt. Keep root instructions concise and link to focused documents. Update project context only when a contract, boundary, workflow, command, or important operational fact changes.

### 5.1 AGENTS.md

Each project should have a concise root AGENTS.md describing:

- project purpose and major architectural boundaries;
- source-of-truth document locations;
- repository layout and important entry points;
- supported runtime/package manager and canonical commands;
- testing and build expectations;
- security, data, and compatibility constraints;
- Git and Conventional Commit expectations;
- change-scoped development rules;
- conditions that justify broader analysis.

The template is [AGENTS.md.template](../templates/AGENTS.md.template). It is a starting point, not a generated file to overwrite blindly. DevKit must preserve user edits and offer a diff/merge when updating it.

### 5.2 Architecture Decision Records

Create an ADR only for a durable decision with meaningful architectural, operational, security, compatibility, or data consequences.

Each ADR records context, decision, alternatives, consequences, status, date, and supersession links. Do not create ADRs for routine implementation details or every small feature choice.

The template is [ADR.md.template](../templates/ADR.md.template).

## 6. Single-agent development workflow

The default workflow assumes one primary agent working on one project. Subagents, swarms, or fleet execution are not prerequisites and must not be introduced by default.

Use **Change-Scoped Development**:

1. **Scope:** state the requested outcome, affected behavior, constraints, and acceptance criteria.
2. **Retrieve:** read project instructions and the relevant feature/architecture docs; use CodeGraph or focused search to identify the actual execution path.
3. **Diagnose:** establish a concrete hypothesis from code, tests, logs, or reproduction. Avoid repository-wide exploration without a reason.
4. **Plan:** choose the smallest coherent change and identify the tests that can falsify the hypothesis.
5. **Implement:** change only the necessary files and preserve unrelated user work.
6. **Verify:** run targeted checks first, then integration/build/security checks proportional to the change's blast radius.
7. **Review:** inspect the changed diff, check for regressions in affected contracts, and verify postconditions.
8. **Record:** update documentation/ADR only if the change affects durable project knowledge; commit when authorized.

A full repository audit is reserved for stage completion, broad architecture changes, migrations, security-sensitive changes, cross-domain defects, or evidence of systemic problems. Do not re-audit unchanged components without a concrete reason.

### 6.1 Complexity routing

- **S — Small:** local, well-understood change. Brief context retrieval, direct implementation, focused verification.
- **M — Medium:** feature or subsystem change. Targeted exploration, concise plan, implementation, targeted tests and relevant integration checks.
- **L — Large:** cross-module, architectural, migration, or high-risk work. Requirements, focused research, ADR where needed, dependency/impact analysis, staged plan, implementation and broader validation.
- **XL / multi-agent:** not part of the default workflow. Use only after an explicit future product decision and only when a real parallelization benefit is demonstrated.

Feature-ADR Pipeline may supply reusable Skills for this process, but its original multi-agent/fleet stages must be adapted or disabled for the single-agent workflow.

## 7. Recommended tool set and selection rules

| Component | Role | Adoption |
|---|---|---|
| CodeGraph | Local code structure, symbol relationships, call paths and change-impact exploration | First additional MCP pilot |
| Context7 | Current external library/framework documentation | Keep enabled when relevant; it does not understand the project's own code |
| Feature-ADR Pipeline | Reusable requirements, decision, planning, implementation and verification workflow | Install as an adapted Skill; single-agent only |
| Semgrep | Static analysis and security-focused rules | Optional Security Review profile; never the sole quality gate |
| Neural Memory | Retrieval of historical project observations and lessons | Deferred pilot after repository docs and CodeGraph are evaluated |
| Serena | Semantic symbol navigation/editing through language tooling | Not in the initial set; add only if CodeGraph and existing IDE/runtime tools leave a demonstrated gap |

Do not install duplicate tools just because they overlap in marketing descriptions. Every additional MCP/Skill must have an identified problem, measurable benefit, clear owner, and removal path.

### 7.1 CodeGraph

Use CodeGraph as a project-local structural index. DevKit may manage discovery, installation, profile assignment, status, and compatible agent access, but the code index remains project-scoped and must respect repository ignore rules and privacy boundaries.

The agent should use the graph to locate relevant symbols and dependencies, not treat generated graph output as a substitute for reading current source and tests. Verify graph freshness after relevant changes.

### 7.2 Context7

Context7 supplies external library documentation and examples. The agent must resolve the exact library identifier and request a focused topic. It is not a repository index, project memory, or substitute for reading the installed library version and source when necessary.

### 7.3 Semgrep

Semgrep is a security/static-analysis aid. Use it when the change touches security boundaries, untrusted input, authentication, secrets, process execution, or when the Security Review profile is selected. Findings require triage against actual code paths and project context.

Functional correctness still depends on project tests, type checking, linting, build, and runtime/integration validation as applicable.

### 7.4 Neural Memory

Neural Memory is not a foundational dependency. Pilot it only after the project has concise instructions, current architecture docs, ADRs, and a working structural code index.

Evaluate retrieval precision, stale/conflicting facts, project isolation, deletion/export, latency, and token/time savings. Memory must be labelled advisory and must never silently become the source of truth.

### 7.5 Portable Agent Skills

Use the open Agent Skills directory format as the canonical Skill package shape: one directory with a required `SKILL.md`, YAML frontmatter (`name` and `description`), and optional focused `references/`, `scripts/`, or `assets/` resources. Follow the published format and progressive-disclosure guidance at [agentskills.io/specification](https://agentskills.io/specification).

DevKit owns Skill provenance, version, review state, project assignment and activation intent. MCPWorkers owns MCP Worker execution; it does not become the Skill catalogue or instruction store. A Skill is not an executable MCP server and its presence does not grant filesystem, shell, network, secret, or MCP permissions.

The first DevKit-native pilot is `skills/feature-adr/SKILL.md`. It adapts the useful spec-driven workflow into S/M/L complexity routing and a single-primary-agent process. It deliberately omits XL swarm/fleet execution, host-specific installers, automatic hook setup, and bundled third-party executable tooling. The draft is repository content only: it is not installed globally, injected into any active agent configuration, or claimed as active in a client.

Keep the main Skill concise. Load supporting references only when required. Treat imported Skill text and bundled scripts as untrusted; scripts require separate inspection and explicit approval before execution. Materialize a Skill only into a client-supported location through a future client adapter, preserve existing user-authored files, and never write multiple compatibility copies blindly.

## 8. Security, privacy, and reliability

- Treat MCP server metadata, package manifests, Skill instructions and tool descriptions as untrusted input.
- Require explicit review and user approval before installation, activation, or new permissions.
- Separate catalogue discovery, package installation, configuration, enablement, process start, and tool invocation.
- Use least-privilege scopes and independently revocable credentials.
- Keep secrets in the configured secret provider; store logical references in profiles.
- Do not expose secrets in renderer state, logs, agent context, diagnostics, project manifests, or Git.
- Keep local services on loopback unless a secure remote transport is deliberately configured.
- Validate versions, package provenance, checksums/signatures where available, runtime compatibility, timeouts, output bounds, and errors.
- Preserve external ownership: never stop or mutate a process merely because it was discovered.
- Make installs, updates, migrations, and destructive operations reversible where practical.

## 9. Delivery boundaries

This architecture is part of the long-term Developer Workflow capability. It does not expand the currently in-progress Unified Workspace MVP or change its acceptance gates.

The immediate project sequence remains:

1. Complete and accept the current Stage 2 Unified Workspace work.
2. Deliver the already-defined Stage 3 developer utilities in their approved order.
3. Deliver Stage 4 Platform Inspector MVP.
4. Deliver this AI Agent Development Infrastructure as a defined vertical slice within Stage 5 Developer Workflow.

Documentation templates and a controlled local pilot may be prepared earlier, but do not claim the DevKit product integration is implemented until its own acceptance criteria pass.

## 10. Acceptance criteria

The first useful implementation is accepted when:

- DevKit can show supported MCP servers and Skills with source, version, compatibility, and trust/provenance metadata.
- A project can select a small Agent Profile without storing secret values.
- DevKit can validate missing or incompatible MCP/Skill dependencies before activation.
- MCPWorkers integration uses the public versioned contract and preserves Manager/Worker ownership.
- Local MCP servers in the new agent toolchain are managed only through MCPWorkers; the existing LocalMCP environment is outside scope and must remain untouched.
- A local agent can receive the approved MCP tools and Skills without requiring a GPT.com connection.
- Client-specific adapters clearly report unsupported capabilities.
- The root AGENTS.md and ADR templates are available and updates preserve user-authored content.
- The S/M/L single-agent workflow is documented and exercised on a real project.
- Targeted validation, Git diff review, and evidence-based completion reports are part of the workflow.
- Secrets are not present in project manifests, logs, generated context packs, or committed files.
- The implementation has focused unit/integration tests and a packaged end-to-end acceptance path.

## 11. Source documents and contract dependencies

- DevKit: docs/architecture/MCP_AND_SKILLS_LIBRARIES.md
- DevKit: docs/architecture/MCPWORKERS_INTEGRATION.md
- DevKit: docs/architecture/STAGE_2_UNIFIED_WORKSPACE.md
- MCPWorkers: docs/api/MCPWORKERS-API-v1.md
- MCPWorkers: docs/architecture/WORKER-CONTRACT-v1.md
- MCPWorkers: docs/architecture/INITIAL-WORKER-CAPABILITY-MATRIX.md

The MCPWorkers Public API and Worker Contract are authoritative for integration operations. The capability matrix is evidence about the current initial workers, not permission to assume support beyond the verified adapter contract.
