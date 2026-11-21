# Documentation index

This directory contains maintained project documentation. Temporary maintenance reports, raw test logs, local audit snapshots and generated build artifacts are not stored here.

## Product planning

- [Product vision](PRODUCT_VISION.md) — target product definition, goals, non-goals and principles.
- [Architecture blueprint](architecture/ARCHITECTURE_BLUEPRINT.md) — logical layers, runtime, security and integration boundaries.
- [Service intelligence & orchestration](architecture/SERVICE_INTELLIGENCE.md) — registry, health, dependency graph and startup/shutdown coordination.
- [Inspector architecture](architecture/INSPECTOR.md) — continuous observation, project analysis and release readiness.
- [Feature roadmap](ROADMAP.md) — planned features, delivery order, and entry conditions.
- [MVP-first development workflow](DEVELOPMENT_WORKFLOW.md) — MVP acceptance, polish stages, priorities, and risk-based review/audit policy.
- [Feature specifications](features/) — MVP requirements, acceptance criteria, polish scope, and security constraints.

## Guides

- [Development workflow](development.md) — local setup, commands, tests and diagnostics
- [Release workflow](releasing.md) — versioning, packaging, CI gates and publication controls
- [Dependency security plan](dependency-security-plan.md) — dependency risk assessment and remediation approach
- [Tools](tools/xmind-to-markdown.md) — XMind conversion behavior, limits and safety constraints

## Documentation conventions

- Keep durable, actionable project knowledge here.
- Clearly distinguish implemented behavior from proposed architecture and planned capabilities.
- Update the product vision, architecture blueprint and roadmap when a product-level decision changes.
- Put developer onboarding and architecture decisions in focused guides.
- Keep release procedures separate from everyday development instructions.
- Update the relevant guide in the same change as behavior or workflow changes.
- Do not commit generated reports, terminal logs, installer binaries, local archives or machine-specific state.
