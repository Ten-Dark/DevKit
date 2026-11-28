# DevKit Documentation

This directory is the maintained knowledge base for DevKit. Each topic has one authoritative source; supporting documents link to it instead of repeating its content.

## Start here

- [Master Product & Architecture Specification](DEVKIT_MASTER_SPEC_v1.2.2.md) — compact project brief, cross-domain contracts, current accepted baseline and source-of-truth map.
- [Product Vision](PRODUCT_VISION.md) — product definition, goals, non-goals, principles and UX direction.
- [Roadmap](ROADMAP.md) — delivery stages, priorities, status and stage-entry conditions.

## Architecture knowledge base

- [Architecture Blueprint](architecture/ARCHITECTURE_BLUEPRINT.md) — current platform layers, workspace ownership, lifecycle, security and portability boundaries.
- [Architecture Decisions](architecture/ARCHITECTURE_DECISIONS.md) — accepted baseline decisions and their rationale.
- [Formal ADRs](architecture/decisions/) — focused records for AI-agent control-plane and MCPWorkers-only local MCP runtime decisions.
- [Service Intelligence](architecture/SERVICE_INTELLIGENCE.md) — service states, health/readiness, dependencies and orchestration.
- [MCP & Skills Libraries](architecture/MCP_AND_SKILLS_LIBRARIES.md) — catalogue discovery, provenance, trust and activation boundaries.
- [AI Agent Development Infrastructure](architecture/AI_AGENT_DEVELOPMENT_INFRASTRUCTURE.md) — Control Plane / Runtime Plane / Consumer Plane contracts and project Agent Profiles.
- [MCPWorkers Integration](architecture/MCPWORKERS_INTEGRATION.md) — Manager ownership, authenticated API v1 and Worker lifecycle contract.
- [MCPWorkers MCP Transport Proposal](architecture/MCPWORKERS_MCP_TRANSPORT_PROPOSAL.md) — future transport proposal; not an accepted or implemented API v1 capability.
- [Inspector](architecture/INSPECTOR.md) — infrastructure observation, project analysis and evidence model.
- [Windows Process Control](architecture/WINDOWS_PROCESS_CONTROL.md) — native process ownership, Job Object lifecycle and validation.
- [Stage 0 — Architecture Foundation](architecture/STAGE_0_FOUNDATION.md) — concise historical foundation and acceptance record.
- [Stage 1 — DevKit Runtime](architecture/STAGE_1_RUNTIME.md) — Runtime implementation and acceptance evidence.
- [Stage 2 — Unified Workspace](architecture/STAGE_2_UNIFIED_WORKSPACE.md) — current Stage 2 scope, acceptance evidence and final audit.
- [Chat2Agent Retirement](architecture/CHAT2AGENT_RETIREMENT.md) — historical removal scope and deliberately preserved shared resources.

## Feature specifications and plans

- [Feature specifications](features/) — F-09 Color Converter, F-10 Port Inspector and F-11 Project Inspector.
- [AI Agent Development Enablement](plans/AI_AGENT_DEVELOPMENT_ENABLEMENT.md) — sequenced implementation work packages and definition of done.

## Operational guides

- [Development guide](guides/development.md) — local environment, commands, tests, builds and diagnostics.
- [MVP-first development workflow](guides/development-workflow.md) — stage planning, implementation, acceptance, polish and agent agreements.
- [MCP & Integrations](guides/mcp-integrations.md) — supported MCP transports, connection behavior, credential boundaries and Storage providers.
- [Release workflow](guides/releasing.md) — versioning, packaging, CI gates and publication controls.
- [Security Review](guides/SECURITY_REVIEW.md) — security findings, corrections, evidence and open release gates.
- [Windows Code Signing](guides/WINDOWS_CODE_SIGNING.md) — signing setup and signed-update verification procedure.

## Tools and templates

- [XMind to Markdown](tools/xmind-to-markdown.md) — conversion behavior, limits and safety constraints.
- [ADR template](templates/ADR.md.template) — format for accepted architecture decisions.
- [Agent instructions template](templates/AGENTS.md.template) — project-local agent instruction baseline.

## Archive

- [Historical documents](archive/) — superseded specifications and completed one-off records. Archive content is historical, not current implementation guidance.
- The former dependency-security remediation note was consolidated into [Security Review, finding SR-03](guides/SECURITY_REVIEW.md) and moved to the archive.

## Documentation rules

1. Keep one active Master Specification, one Product Vision and one Roadmap.
2. Keep architecture contracts in architecture documents; keep stage-specific implementation and test evidence in stage records.
3. Keep operational procedures in guides and scoped requirements in feature specifications.
4. Before creating a document, check whether its content belongs in an existing source of truth. Prefer merging and linking over near-duplicates.
5. Every document must state whether it is normative, accepted, proposed, historical or operational where that distinction matters.
6. When moving or merging documents, update all inbound links and this index.
7. Do not store generated reports, terminal logs, installer binaries, local archives or machine-specific state in the active documentation tree.
