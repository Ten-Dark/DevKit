# MCPWorkers-Managed MCP Transport — Proposal

**Status:** Proposed contract; not implemented or accepted
**Owner:** MCPWorkers Manager
**DevKit role:** Consumer and project-level configuration/control plane
**First intended worker:** CodeGraph
**Supersedes:** No existing API v1 route or Worker lifecycle operation

## 1. Problem statemen

MCPWorkers Public API v1 currently manages Worker Definitions and Instances: discovery, health, explicit lifecycle, configuration and package-management operations under Manager ownership. The DevKit external client currently has only the `workers.read`, `workers.health`, and `workers.lifecycle` scopes.

This is a control plane, not an MCP gateway. Capability matching returns eligible Worker Instances; it does not forward JSON-RPC messages. API v1 does not currently define a generic MCP endpoint, per-client tool authorization, or transport ownership for third-party MCP processes.

DevKit must not work around this gap by starting CodeGraph or another local MCP server directly. The missing transport belongs in MCPWorkers and must be specified and tested there first.

## 2. Goals

- Keep MCPWorkers as the only local MCP runtime in the target DevKit toolchain.
- Keep Manager as the authority for Worker definitions, installation, configuration, process identity, lifecycle and health.
- Expose approved Worker tools to compatible local clients without revealing Manager root credentials.
- Bind every invocation to an explicitly approved Worker Instance and project scope.
- Keep the existing API v1 control-plane routes compatible.
- Support bounded execution, cancellation, process cleanup and sanitized diagnostics.
- Start with a narrow tools-only CodeGraph pilot; generalize only after the pilot proves the contract.

## 3. Non-goals

- No dependency on LocalMCP, LocalMCP-Tunnel, or any other parallel local MCP runtime.
- No inspection, configuration, lifecycle operation, update, removal, or migration of existing LocalMCP/UserProfile-linked tools or settings.
- No generic public Internet gateway or browser-originated API.
- No automatic worker discovery/installation/activation on project open.
- No access to Manager private Registry, token, or runtime files from DevKit.
- No assumption that every Worker is an MCP server. A Worker must declare and pass the relevant transport contract.
- No automatic routing/failover of in-flight tool calls between Workers.

## 4. Proposed architecture

```tex
Agent / compatible clien
        |
        | authenticated MCP requests
        v
MCPWorkers MCP Transport (loopback)
        |
        | authorize client + project + Worker Instance
        v
MCPWorkers Manager
        |
        | Worker Adapter contrac
        v
Manager-owned Worker process / transpor
        |
        v
CodeGraph or another approved MCP-capable Worker

DevKit --------------------> MCPWorkers Public Control API v1
  project profile             definitions / instances / health / lifecycle
  approvals                   no private-file access
  client config
```

The MCP data plane and Manager control plane are separate interfaces with separate authorization. DevKit uses the documented API for Manager state and operations. Agent clients use the MCP transport only after the project profile and Worker access have been approved.

## 5. Transport protocol

Use the current stable MCP Streamable HTTP specification and the maintained MCP SDK supported by the Manager at implementation time. Pin the protocol/SDK compatibility in tests and release metadata.

The MCP specification changed on 2026-07-28: the current Streamable HTTP revision uses POST requests and request-scoped JSON/SSE responses, and removes the old standalone GET stream and protocol-level session model. Do not design a new implementation around the older 2025-11-25 GET/SSE session assumptions. If compatibility with older clients is required, it must be an explicit, separately tested compatibility mode.

For the first version:

- Bind only to loopback by default.
- Use one documented MCP endpoint and standard MCP Streamable HTTP framing.
- Validate `Origin` on every request; reject invalid origins. Do not treat CORS as authentication.
- Require authentication and authorize each request, not just the initial connection.
- Negotiate and validate the MCP protocol version; reject unsupported versions clearly.
- Bound request body size, response size, execution time, concurrent calls, and per-client resource use.
- Preserve progress/cancellation semantics supported by the selected SDK.
- Do not expose server-to-client capabilities that are not implemented and tested.
- Keep remote-client transport out of v1. A later remote adapter must provide a separately designed secure channel and authorization model.

## 6. Worker Adapter extension

A Worker that exposes MCP tools must declare an explicit transport capability and implement a Manager-owned adapter surface. The exact TypeScript shape is an implementation decision, but it must provide equivalent operations to:

- Inspect whether the installed Worker version supports the declared MCP transport.
- Validate the project-scoped configuration before launch.
- Create or reuse a Manager-owned transport endpoint/process according to a documented concurrency policy.
- Forward MCP requests and responses with correct request correlation.
- Propagate cancellation and bounded timeouts to the Worker.
- Observe process exit and transport errors.
- Close the transport and release all owned resources deterministically.
- Report health separately from MCP API liveness.

A stdio-backed Worker must never be spawned by DevKit. Manager must launch it through its existing process-ownership layer, validate the executable/package identity, avoid shell-string construction, isolate stderr, and retain process-tree ownership. Secret values must be resolved only through Manager's Secret Provider boundary and must never be returned to DevKit or an agent.

The implementation must explicitly decide whether the first version uses one process per Worker Instance or one process per client/request context. Whichever policy is selected must document concurrency, state isolation, resource limits, crash behavior and cleanup. Do not assume process sharing is safe merely because the MCP SDK can multiplex requests.

## 7. Authorization and project scope

Add a distinct least-privilege permission for MCP tool access; do not broaden `workers.read` or `workers.lifecycle` to imply tool invocation.

Authorization must be evaluated against all of:

- External client identity and revocation state.
- Explicit MCP access scope.
- Specific Worker Definition and Instance.
- Project/profile association and approved project root.
- Worker capability and tool allowlist.
- Current Worker enabled, runtime and health state.
- Any additional per-tool permission declared by the Worker.

The client credential must be separate from the Manager root token. Store only token hashes in Manager auth state; provision client secrets through the existing credential workflow. The token must not enter Renderer state, command-line arguments, logs, project manifests, Skill content, or tool results.

The first CodeGraph profile should be read-oriented and project-root scoped. It must respect repository ignore/exclusion rules and must not index unrelated user-profile directories, credential stores, secret files, generated folders, or arbitrary paths outside the approved project root.

## 8. First pilot capability

CodeGraph is the first planned Worker because it provides project structure, symbol relationships, call paths and change-impact exploration. Its upstream `codegraph install` command must not be used: DevKit/MCPWorkers own integration and must not write MCP configuration into other agents or IDEs.

The initial capability set should be deliberately narrow:

- MCP initialization and protocol negotiation supported by the selected current SDK.
- Tool discovery for the approved CodeGraph tools.
- Tool invocation for the approved read-oriented CodeGraph tools.
- Request cancellation and bounded timeout behavior.
- Health and process-state reporting by Manager.

Resources, prompts, arbitrary filesystem tools, remote access, and additional CodeGraph features remain out of scope until separately justified and tested.

## 9. Failure and lifecycle semantics

- A Worker disabled, unhealthy, incompatible, unauthorized, or not running must not accept tool calls.
- A request timeout must not be reported as a successful operation.
- Cancellation must be forwarded where the Worker protocol supports it; otherwise the limitation must be explicit and the Manager must still bound execution and cleanup.
- A Worker crash must fail the affected call with a sanitized error. Do not replay an unknown in-flight tool call on another Worker.
- Manager shutdown must close all transport endpoints and processes it owns; externally owned processes remain untouched.
- API health, Worker health, and MCP request health are distinct signals.
- Diagnostics must identify the failed boundary without exposing secrets or raw untrusted output.

## 10. Versioning and rollou

1. Keep API v1 control-plane behavior backward compatible.
2. Specify the new MCP transport as a separately versioned contract and capability.
3. Add Manager unit, adapter-contract, transport integration, concurrency, authorization, cancellation, timeout, crash and cleanup tests.
4. Add an isolated CodeGraph Worker Definition/Adapter and verify provenance, version pinning, project scoping and index freshness.
5. Provision a dedicated least-privilege DevKit/client credential with only the required worker-read and MCP access scopes.
6. Connect one local agent/client and prove tools are discovered and invoked only for the selected project profile.
7. Add DevKit UI only after the API and transport acceptance evidence exists.
8. Keep the existing Stage 2 → Stage 3 → Stage 4 → Stage 5 delivery sequence. Documentation and an isolated contract prototype do not constitute Stage 2 or Stage 5 product acceptance.

## 11. Acceptance criteria

- No LocalMCP/UserProfile-linked configuration or service was inspected or modified.
- No local MCP server is launched directly by DevKit.
- All Worker process creation and cleanup is owned and observable by MCPWorkers.
- An authorized client can list and invoke only the tools of the approved Worker Instance and project.
- An unauthorized client, project, instance, capability or tool is denied.
- Origin, protocol version, request size, concurrency and timeout limits are enforced.
- Cancellation, worker crashes and Manager shutdown leave no orphan process or transport.
- Secrets never appear in DevKit Renderer state, agent configuration, project profile, logs or responses.
- CodeGraph only indexes the explicitly approved project root and respects exclusions.
- Manager API health, Worker health and MCP tool availability are reported separately.
- A reproducible packaged end-to-end test proves the complete path.

## 12. Open decisions before implementation

- Exact MCP endpoint route and whether it is hosted by Manager or a dedicated Manager-owned transport process.
- Exact external-client token scopes and per-project authorization representation.
- Whether one CodeGraph process serves one Instance or multiple isolated client contexts.
- Which MCP protocol revisions and client versions are supported in the first release.
- Which CodeGraph package source, version, signature/checksum and Windows runtime prerequisites are accepted.
- The minimum MCP methods and tool allowlist for the first pilot.
- The dedicated project-root/index storage layout and index refresh policy.
