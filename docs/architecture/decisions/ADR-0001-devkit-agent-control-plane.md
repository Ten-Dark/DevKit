# ADR-0001: DevKit as the AI Agent Development Control Plane

- **Status:** Accepted product direction; implementation details remain gated by the relevant contracts and stage acceptance.
- **Date:** 2026-11-28
- **Owners:** DevKit product/architecture
- **Related documents:** [AI Agent Development Infrastructure](../AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md), [MCP & Skills Libraries](../MCP_AND_SKILLS_LIBRARIES.md), [MCPWorkers integration](../MCPWORKERS_INTEGRATION.md)

## Contex

The development workflow currently depends on separate agent clients, MCP runtimes, Skills, project instructions, local services, and repository-specific conventions. As projects grow, agents spend increasing effort rediscovering architecture and execution paths, while broad repeated audits and context drift reduce delivery efficiency.

The project needs one durable place to discover and configure development capabilities without coupling those capabilities to a single AI provider or making DevKit a mandatory proxy for every tool call.

MCPWorkers already has its own Registry, Worker Definitions/Instances, lifecycle ownership, and a versioned public integration API. LocalMCP's documented capability matrix includes an external MCP gateway and Skill loading. These existing responsibilities must be preserved rather than duplicated.

## Decision

Adopt a three-plane architecture:

1. **DevKit Control Plane:** owns MCP/Skills catalogues, provenance, project-to-capability assignments, Agent Profiles, approval state, compatible client adapters, and sanitized status presentation.
2. **Runtime Plane:** MCPWorkers owns its Worker Definitions/Instances, installations, configuration and worker lifecycle through its public contracts. The selected worker/runtime (including LocalMCP where supported) owns its own execution configuration and tool forwarding.
3. **Consumer Plane:** AI agents, IDEs, and other supported clients consume project instructions, enabled Skills, and approved MCP tools through compatible adapters.

DevKit remains the user-facing source of configuration intent, but it does not mutate MCPWorkers internal Registry files or LocalMCP private files. It uses documented APIs or explicit, versioned integration contracts. Generic MCP servers may use the existing direct MCP connection path where appropriate; they are not automatically forced into MCPWorkers as Worker Definitions.

Introduce project-scoped Agent Profiles. Profiles may declare MCP/Skill IDs, versions, required capabilities, client targets, and secret references by logical name. They must never contain resolved credentials.

Adopt the single-agent Change-Scoped Development workflow by default. S/M/L complexity routing is supported. Swarms, fleets, and subagents are not a default requirement.

Use project source hierarchy: current implementation/tests first; concise AGENTS.md; current architecture docs; ADRs; task/feature documents; optional advisory memory last.

## Consequences

### Positive

- One place to discover and assign development capabilities across projects.
- MCP server runtime and Worker lifecycle remain independently managed.
- Projects can carry portable, reviewable profiles without carrying credentials.
- Local agents are not dependent on ChatGPT Web or a particular provider.
- The workflow explicitly discourages unnecessary repository-wide audits and repeated exploration.
- New MCPs and Skills can be introduced incrementally and measured.

### Trade-offs

- DevKit needs client/runtime adapters and must represent capability gaps explicitly.
- The same MCP server may have different configuration owners depending on whether it is directly managed or exposed through a gateway.
- A project profile can describe intent, but the target runtime remains authoritative for actual installation and execution state.
- Neural Memory adds complexity and is deferred until a baseline retrieval process can be measured.

## Constraints

- Do not expand the in-progress Stage 2 Unified Workspace MVP or change its acceptance gates.
- Do not assume MCPWorkers Public API v1 can configure arbitrary third-party MCP servers; verify support first.
- Do not edit private MCPWorkers or LocalMCP runtime state behind their supported interfaces.
- Do not automatically install, enable, start, update, or grant access to discovered MCP servers or Skills.
- Do not expose local endpoints publicly without a deliberately configured secure transport.
- Do not put secret values in project files, Skills, prompts, logs, or Git.
- Do not add CodeGraph and Serena together by default; CodeGraph is the first structural-index pilot.
- Neural Memory remains deferred and advisory until a separate evaluation decision.

## Initial adoption

1. Establish concise project instructions, ADR conventions, Change-Scoped Development, and the S/M/L single-agent workflow.
2. Define project Agent Profile schema and its non-secret fields.
3. Verify MCPWorkers/LocalMCP integration routes and add only supported adapters.
4. Pilot CodeGraph on one representative grown repository.
5. Integrate Feature-ADR as an adapted Skill.
6. Add Semgrep as an optional security profile.
7. Evaluate Neural Memory only after measuring the value of the previous layers.

## Revisit when

- MCPWorkers exposes a new stable API for generic MCP server configuration.
- LocalMCP's gateway contract changes or no longer satisfies required lifecycle semantics.
- A supported AI client introduces a stable local MCP connection flow that changes adapter requirements.
- Pilot evidence shows CodeGraph is insufficient for a material symbol-navigation/editing workflow.
- Neural Memory demonstrates measurable retrieval benefits without stale or conflicting project facts.
