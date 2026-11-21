# DevKit — Product Vision

## Product definition

**DevKit is an independent Developer Workspace Platform:** a modular, portable and cross-platform environment that gives an individual developer or team one coherent place to manage development projects, tools, services, data, workflows and quality controls.

DevKit is not intended to be another collection of unrelated utilities, a replacement for every existing developer product, or a monolithic IDE. It is the managed workspace and coordination layer around the tools developers already use.

> One workspace. All development infrastructure.

## Problem

Developer infrastructure tends to spread across the host operating system: runtimes, package managers, local services, MCP servers, credentials, configuration files, databases, notes, project repositories and automation processes are installed and maintained independently. Their state and dependencies are difficult to understand as a whole. A service may be running while its API is unavailable; a workflow may fail because a required companion service was never started; removing one application may leave data, processes, startup entries and dependencies behind.

DevKit aims to make this environment explicit, observable and manageable without requiring users to abandon specialized tools.

## Product goals

1. **Unified entry point:** provide one workspace for projects, services, MCP integrations, storage, workflows and quality reports.
2. **Managed environment:** keep DevKit-owned runtimes, dependencies, configuration and data in a predictable workspace rather than scattering them across global OS locations.
3. **Service intelligence:** understand which services are healthy, stopped, failed, degraded or unknown, and explain their dependencies and impact on other components.
4. **Safe orchestration:** determine which declared dependencies a service or workflow needs, validate readiness and start components in dependency order under explicit user-controlled policies.
5. **Centralized data access:** integrate existing stores such as Karakeep and Obsidian instead of reimplementing them.
6. **Secure access management:** provide a protected vault for credentials and secrets used by connected services.
7. **Quality assurance:** provide an Inspector that continuously observes infrastructure and performs evidence-based project/build analysis.
8. **Developer workflow:** coordinate projects, tasks, agents, Git, builds, reviews and releases while integrating with existing providers.
9. **Portability and lifecycle control:** support installation, update, backup, migration, restore and complete removal of DevKit-managed resources.
10. **Broad usefulness:** serve individual developers, senior engineers, technical leads and teams through configurable workflows and integrations.

## Non-goals

- Replacing Karakeep, Obsidian, GitHub, Jira, editors, CI providers or every connected MCP with in-house clones.
- Requiring all services to run inside containers or virtual machines.
- Claiming that a desktop application can be completely independent of its host operating system.
- Automatically executing arbitrary commands or managing undeclared processes.
- Treating an AI model's opinion as proof that code is correct or safe.
- Building a full enterprise project-management or CI/CD platform before the core workspace is useful.

## Product principles

### Managed, not invasive

DevKit owns and manages only resources explicitly registered to it or provisioned by it. Existing user installations can be connected through adapters without silently moving, replacing or deleting them.

### Modular by contract

Core capabilities communicate through documented interfaces. Platform-specific behavior, service-specific commands and third-party integrations live behind adapters or extensions rather than being hard-coded throughout the application.

### Observable and explainable

Show actual process state separately from service readiness. Every health state, recommendation, dependency relationship and automated action should have a reason and supporting evidence.

### Safe by default

Use least privilege, protected secrets, explicit ownership, action policies, audit logs, backups and reversible updates. Destructive or high-impact operations require clear user authorization.

### MVP-first delivery

Deliver complete, useful vertical slices. Build the minimum architecture needed for the next validated capability; avoid speculative frameworks and repeated audits that do not inform a concrete decision.

## Product layers

| Layer | Responsibility |
| --- | --- |
| **DevKit Core** | Runtime, process and lifecycle management, configuration, service registry, dependency graph, security, storage primitives and orchestration contracts |
| **DevKit Workspace** | Desktop UI, dashboard, projects, workflows, services, MCP, storage, vault, monitoring and developer tools |
| **DevKit Extensions** | Service adapters, platform adapters, storage providers, integrations and optional modules |
| **Inspector** | Independent observation and quality-analysis subsystem; able to inspect connected projects and DevKit itself |

Inspector is a distinct subsystem with its own lifecycle and contracts. It consumes data from Core and connected tools, but should not be required for basic process management or service startup.

## Main workspace areas

- **Overview:** infrastructure health, recent events, active workflows and project status.
- **Projects:** repositories, project metadata, tasks and project-specific configuration.
- **Workflows:** reusable, provider-independent development workflows.
- **Services:** registered local and remote services, lifecycle controls and dependency relationships.
- **MCP Hub:** MCP servers, tools, connection state, configuration and logs.
- **Storage:** unified navigation and integration for Karakeep, Obsidian, files and project stores.
- **Vault:** protected credentials, tokens, keys and certificates.
- **Inspector:** monitoring findings, project inspections, evidence and release readiness.
- **Monitoring:** events, health history, process and API availability.
- **Toolbox:** focused developer utilities, including the existing and planned F-09–F-11 capabilities.
- **Runtime:** managed runtimes, dependencies, processes and environment diagnostics.
- **Settings:** workspace, runtime, services, MCP, storage, security, integrations, appearance and updates.

## User experience direction

Use Karakeep as the primary visual reference: restrained dark surfaces, clean typography, compact cards, clear hierarchy, efficient navigation and subtle accents. The UI should prioritize responsiveness, clarity and actionable status over decorative dashboards. Do not copy Karakeep's product behavior or branding; use it as a visual and interaction reference.

## Success criteria

The platform is delivering its core promise when a user can install DevKit, register or provision a service, securely configure it, understand its real health and dependencies, start the required service set for a workflow, inspect logs and events, and remove DevKit-owned resources without leaving unmanaged residue. Each capability must be validated as a working end-to-end flow before the next major layer is expanded.

## Terminology

- **Managed resource:** a process, directory, runtime, service, configuration or OS registration explicitly owned by DevKit.
- **Connected resource:** an existing external or user-managed resource that DevKit can inspect or operate through a declared adapter and granted permissions.
- **Health:** observed operational condition of a service, distinct from whether its process exists.
- **Readiness:** whether a service is prepared to accept the operations required by its dependents.
- **Dependency graph:** directed relationships describing which components require other components.
- **Orchestration:** policy-governed coordination of dependency checks, startup, shutdown and recovery.
- **Inspector finding:** a result backed by reproducible checks, logs, source locations or explicitly labeled AI analysis.
