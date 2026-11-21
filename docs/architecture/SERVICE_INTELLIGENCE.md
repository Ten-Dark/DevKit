# Service Intelligence & Orchestration

## Purpose

DevKit must understand the managed development environment as a connected system, not as a flat list of applications. It should show what is running, what is unavailable or degraded, why a component is unhealthy, which other components depend on it, and what is required to run a particular service or workflow.

## Core capabilities

1. **Service Registry:** canonical records for connected and DevKit-managed services.
2. **Dependency Graph:** declared directed relationships between services, capabilities and workflows.
3. **Health Monitoring:** process, API, readiness and dependency-aware checks.
4. **Impact Analysis:** direct and transitive dependents affected by a failure.
5. **Orchestration:** policy-governed dependency checks and ordered startup/shutdown.
6. **Recommendations:** explain which components are missing and what action would restore a workflow.

## Service record

Each registered service should declare, as applicable:

- Stable ID, name, description, type, owner and management mode (`managed` or `connected`).
- Adapter ID and adapter version.
- Installed/current version and update source.
- Executable or endpoint reference without embedding secrets.
- Runtime requirements and configuration schema/version.
- Lifecycle capabilities and permitted actions.
- Process identity/handles where observable.
- Health and readiness probes with timeout and expected response.
- Dependencies, optional dependencies and provided capabilities.
- Resource constraints, port declarations and conflict information where known.
- Log/event sources, last check time and recent state transitions.

Connected services may expose fewer controls than DevKit-managed services. Their ownership and permissions must remain explicit.

## State model

Do not equate a live process with a healthy service. Keep process state and service health as separate observations.

Suggested aggregate states:

| State | Meaning |
| --- | --- |
| `running` | Required health/readiness checks pass and the service is usable for its declared purpose |
| `stopped` | The service is known to be intentionally or currently not running |
| `failed` | A known failure prevents the service from operating |
| `degraded` | The service responds, but one or more important checks or dependencies are impaired |
| `unknown` | There is insufficient or stale evidence to determine the current state |

The model should additionally retain process observations such as `present`, `absent`, `exited` or `unobservable`, probe results, timestamps and failure reasons. A service can have a present process while its API is unavailable; this must not be displayed as healthy.

## Dependency model

Represent dependencies as directed edges from a consumer to a required provider. Each edge should specify:

- Required or optional dependency.
- Required capability or compatible version/range, where relevant.
- Whether readiness is required before the consumer starts.
- Whether the dependency is required continuously or only during a workflow step.
- Failure policy: block, warn, degrade or allow fallback.
- Provenance: declared by adapter, user-configured or workflow-defined.

The graph must support direct and transitive traversal, cycle detection and impact analysis. Cycles must be reported and must block automatic ordering until explicitly resolved; do not guess a startup order for a cyclic graph.

## Health and readiness checks

Use the strongest safe check available for each adapter:

1. Process existence/exit status.
2. Local endpoint or socket availability.
3. API health endpoint or protocol-level handshake.
4. Readiness check proving required dependencies and initialization are complete.
5. Optional functional check for a critical declared capability.

Checks need bounded timeouts, sensible intervals, retry/backoff policy and stale-result protection. Avoid aggressive polling. Surface last successful check, last failure, check age and diagnostic evidence.

## Dependency-aware startup

When a user starts a service or invokes a workflow:

1. Resolve the target and its declared required dependencies.
2. Validate registrations, permissions, versions, configuration references and graph cycles.
3. Check current health/readiness; do not restart components that are already ready.
4. Build a topological startup order for missing managed dependencies.
5. Present a plan showing what will start, why, and what remains unavailable.
6. Execute only within the user's selected policy and adapter capabilities.
7. Wait for each dependency's readiness before starting its dependents.
8. Stop or roll back newly started components if a required stage fails, according to the configured policy; do not stop pre-existing services unless the user policy explicitly permits it.
9. Report final states and actions with correlation IDs and logs.

Manual mode should be the default for new or destructive operations. An opt-in automatic mode may execute pre-approved, non-destructive start actions for registered services. Updates, uninstallations, data migrations and destructive recovery require separate authorization.

## Shutdown and recovery

Shutdown should normally proceed in reverse dependency order. Prefer graceful shutdown with a bounded timeout, then use adapter-defined escalation only when authorized. Recovery/restart policies must include retry limits, backoff, loop prevention and a visible action history. Do not create endless restart loops.

## Resource and conflict checks

Before orchestration, check known constraints such as port conflicts, missing runtime, incompatible versions, unavailable files, permission failures and configured resource limits. Report unknown constraints as unknown rather than pretending they were checked. Resource-based scheduling can be expanded after basic dependency orchestration is proven.

## User experience

The Services and Overview views should expose:

- Current aggregate state and freshness of the observation.
- Process state separately from health/readiness.
- Dependency graph with direct and transitive relationships.
- Failed component, root cause evidence and affected dependents.
- Workflow readiness and missing prerequisites.
- Proposed startup/shutdown plan before execution.
- Recent actions, who/what initiated them, and outcome.

Recommendations must be explainable: e.g. “Workflow X is blocked because Service B is not ready; Service B requires Service A, which is stopped.”

## Safety requirements

- Never launch or terminate arbitrary processes without a registered adapter and declared ownership/capability.
- Never assume a connected resource may be modified or deleted.
- Require explicit authorization for actions outside the active policy.
- Record start, stop, restart, update, recovery and uninstall operations.
- Sanitize logs and diagnostic evidence so secrets are not exposed.
- Protect against races, duplicate commands, cancellation and late health responses.
- Keep the UI truthful when state is unknown or stale.

## MVP boundary

The first useful slice should register a small number of explicitly configured services, report process and one service-level readiness check, display required dependencies, and produce a manual startup plan. Execute dependency-aware startup only for adapters with safe, tested lifecycle commands. Advanced auto-recovery, resource scheduling and broad plugin discovery are later capabilities.
