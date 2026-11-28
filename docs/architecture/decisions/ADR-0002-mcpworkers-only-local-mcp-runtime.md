# ADR-0002: MCPWorkers as the Only Target Local MCP Runtime

- **Status:** Accepted
- **Date:** 2026-11-28
- **Owners:** DevKit product/architecture
- **Supersedes:** The LocalMCP-gateway and direct-local-MCP alternatives in ADR-0001 for the target local MCP architecture only
- **Related documents:** [ADR-0001](ADR-0001-devkit-agent-control-plane.md), [AI Agent Development Infrastructure](../AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md), [MCPWorkers MCP Transport Proposal](../MCPWORKERS_MCP_TRANSPORT_PROPOSAL.md)

## Contex

ADR-0001 established DevKit as the AI Agent Development Control Plane and MCPWorkers as a Runtime Plane component, while treating LocalMCP's gateway as a candidate and allowing a direct local MCP path where appropriate.

The project direction is now explicit: MCPWorkers is the only local MCP runtime to retain and develop in the target DevKit toolchain. The existing LocalMCP-based tools currently provide the working access path used during development. Their UserProfile-linked configuration and active runtime must remain untouched until MCPWorkers provides a verified replacement and the user explicitly authorizes any retirement.

The current MCPWorkers Public API v1 manages Worker Definitions and Instances but does not yet expose a general MCP tool-transport endpoint. A Worker control API alone is not sufficient to make a local MCP available to an agent.

## Decision

1. **MCPWorkers is the sole target local MCP runtime.** All new local MCP integrations intended for DevKit must be implemented as MCPWorkers-managed Workers and exposed through a supported Manager-owned MCP transport.
2. **Existing LocalMCP environment is protected.** Do not inspect, configure, start, stop, reload, update, uninstall, migrate, or delete existing LocalMCP/LocalMCP-Tunnel tools or UserProfile-linked configuration. Keep using the currently available tools for development without changing their environment.
3. **No unmanaged local fallback.** DevKit must not start a local MCP process directly or create another local MCP runtime as a fallback when a Worker adapter or MCP transport capability is missing.
4. **No private-state bypass.** DevKit uses documented MCPWorkers APIs only. It must not read or write Manager Registry, auth, installation, or runtime files directly, and must not use the Manager root token as a client credential.
5. **Transport is a prerequisite.** Extend MCPWorkers through a separately versioned, tested contract for MCP protocol transport, per-client authorization, project scoping, cancellation, bounded execution, diagnostics and resource cleanup. Do not claim a Worker is agent-accessible until end-to-end tool calls are verified.
6. **Retirement is a later explicit decision.** Existing LocalMCP controls/configuration may be considered for removal only after MCPWorkers parity and acceptance are demonstrated and the user explicitly requests the transition. No automatic migration or cleanup is implied by this ADR.

Remote hosted MCP endpoints remain a separate external-integration category and do not become local MCPWorkers Instances merely because DevKit can connect to them. Agent Skills remain a separate DevKit-managed content domain, not MCPWorkers Workers.

## Consequences

### Positive

- One target local MCP runtime and one authoritative Worker lifecycle owner.
- No parallel local MCP configuration surfaces in the target architecture.
- The current working development tools remain available while MCPWorkers is completed.
- Agent access is based on a verifiable transport and explicit project permissions, not assumptions about a Worker API.

### Trade-offs

- The current MCPWorkers API v1 is not yet sufficient for general MCP tool invocation; the transport contract and its tests are prerequisites.
- CodeGraph integration cannot be declared complete until Manager-owned transport, Worker adapter, authorization and project-scoped indexing all pass.
- Existing legacy LocalMCP integrations may remain present temporarily, but are protected from modification and are not part of the target design.
- Direct local STDIO support in DevKit is not a fallback for new local MCP integrations. Existing Stage 2 work must be reconciled separately without disrupting current user tooling.

## Implementation constraints

- Preserve the existing Stage 2 → Stage 3 → Stage 4 → Stage 5 delivery sequence.
- Do not expand Stage 2 acceptance criteria to absorb the complete agent-tooling platform.
- Do not change any current LocalMCP/UserProfile-linked runtime or configuration.
- Do not run upstream installers that write into agent/IDE configuration, including CodeGraph's `codegraph install`.
- Pin Worker package provenance/version and test project-root scope, ignore rules, index freshness and cleanup before enabling CodeGraph for an agent.
- Keep Skills portable using the Agent Skills `SKILL.md` format and activate them only through an explicitly supported client adapter.

## Revisit when

- MCPWorkers provides an accepted, versioned MCP transport with end-to-end integration evidence.
- The first CodeGraph Worker is accepted on a representative project.
- A supported client requires a transport capability not covered by the accepted contract.
- The user explicitly authorizes retirement of the preserved LocalMCP environment after replacement acceptance.
