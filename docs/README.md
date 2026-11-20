# Documentation index

This directory contains maintained project documentation. Temporary maintenance reports, raw test logs, local audit snapshots and generated build artifacts are not stored here.

## Product planning

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
- Put developer onboarding and architecture decisions in focused guides.
- Keep release procedures separate from everyday development instructions.
- Update the relevant guide in the same change as behavior or workflow changes.
- Do not commit generated reports, terminal logs, installer binaries, local archives or machine-specific state.
