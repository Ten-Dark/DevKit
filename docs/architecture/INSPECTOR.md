# Inspector Architecture

## Purpose

Platform Inspector is DevKit's independent observation and quality-assurance subsystem (Stage 4). It monitors connected infrastructure, validates service/update candidates and produces evidence-based findings. It must provide evidence and uncertainty, not an unsupported “all clear”. It must also be able to inspect DevKit itself. The Stage 3 F-11 Project Inspector is a separate user-facing utility for passive project understanding; the two may share analysis primitives but are not the same feature or delivery stage.

## Subsystems

### Inspector Core — infrastructure observation

- Consume Service Registry and health events.
- Observe service/MCP availability, process exits, API failures and readiness degradation.
- Track version changes, dependency/configuration drift and relevant log errors.
- Correlate symptoms with dependency relationships and affected services.
- Produce actionable findings with timestamps, evidence and confidence/limitations.

### Project Analysis Pipeline — later Platform Inspector capability

This is a later Platform Inspector capability, not the Stage 3 F-11 Project Inspector MVP. Triggers may include a new commit, changed branch, new build artifact, explicit user request or a configured release workflow. Trigger sources must be declared; avoid silently watching arbitrary directories or repositories.

The analysis pipeline may gather:

1. Project identity, baseline revision and target revision/artifact.
2. Changed files and relevant history/changelog.
3. Runtime, dependency and configuration changes.
4. Existing project instructions and acceptance criteria.
5. Deterministic validation results.
6. AI-assisted review where configured and authorized.

## Relationship to F-09, F-10 and F-11

- **F-09 — Color Converter & Palette** is a focused Toolbox utility, not an Inspector subsystem.
- **F-10 — Port Inspector** is a read-only local diagnostics source. Its port/process observations may later be consumed by Platform Inspector and correlated with Service Registry data, but it never gains process-control authority.
- **F-11 — Project Inspector** is a Stage 3 utility for Project Overview, initial Architecture Map and Markdown AI Context Pack. It uses bounded, read-only filesystem inspection, applies ignore/sensitive-file exclusions, reports scan coverage, supports cancellation and never executes project code or commands.
- The change/build/release analysis pipeline above is a later Platform Inspector capability. It requires a trusted-project policy, explicit execution authorization and isolation. It is not part of F-11's passive-inspection MVP.

## Deterministic checks

Run checks available and appropriate to the project, such as:

- Formatting/linting and type checking.
- Unit, integration and end-to-end tests.
- Compilation and production build.
- Dependency and license/security checks.
- Static analysis and secret scanning.
- API/schema/contract compatibility checks.
- Packaging and artifact integrity checks.

The project adapter or workflow must declare commands, environment requirements, timeouts and side effects. Do not execute untrusted repository scripts without an explicit trust policy and suitable isolation.

## AI-assisted analysis

AI analysis may review architecture, logic, error handling, regression risk, maintainability and requirement coverage. It is probabilistic and must be labeled separately from deterministic results. Each finding should cite concrete files/lines, relevant diffs or tool output where possible, explain the reasoning and identify what could not be verified.

AI must not convert a missing test into a proven defect, claim a vulnerability without evidence, or override a failing deterministic check with a positive opinion. Reports should distinguish confirmed failures, likely risks, suggestions and unverified areas.

## Finding model

Each finding should contain:

- Stable ID and inspection/run ID.
- Project/service and baseline/target version.
- Severity and category.
- Status: open, resolved, accepted-risk or superseded.
- Source: deterministic check, runtime observation or AI analysis.
- Concise description, impact and reproducible evidence.
- File/line, test, log or artifact references when available.
- Suggested remediation and confidence/limitations.
- First seen, last seen and resolution history.

Suggested severity levels: critical, high, medium, low and informational. Severity must be tied to impact, not just model confidence.

## Reinspection and feedback loop

After a fix or new build, Inspector can rerun the relevant checks and compare the new result with the previous run. It should show resolved, persistent, new and regressed findings. Reuse prior results only when inputs and tool versions prove the result is still valid. Protect against stale asynchronous results and cancelled runs overwriting newer state.

## Release readiness

Release readiness is a policy-based summary of required checks, not a guarantee. A release can be:

- **Ready:** all configured mandatory gates passed and no blocking findings remain.
- **Blocked:** one or more mandatory gates failed or blocking findings remain.
- **Needs review:** checks are incomplete, inconclusive or require human judgment.

The report must list exactly which gates were run, skipped or unavailable. A green result must never imply that every possible defect has been ruled out.

## Autonomy and permissions

Initial Inspector behavior is observe, analyze and report. It must not edit source code, install dependencies, apply migrations, restart production-like services, publish releases or delete data without a separate explicit authorization. Any later remediation automation must be opt-in, scoped, reviewable and auditable.

## Self-inspection

Inspector should validate DevKit components, contracts, packaging and upgrade behavior. Self-inspection must use a bounded target snapshot and avoid recursive triggering (Inspector inspecting its own inspection output). Critical Core functions must remain usable if Inspector is stopped or unavailable.

## MVP boundary

The Stage 4 Platform Inspector MVP starts with one managed or connected service: read its version and health, run a declared set of deterministic checks, capture/redact logs, produce a structured evidence report, and repeat the checks after a change. Automatic change detection, generalized project build/release analysis, AI-assisted findings and broader policy management follow only after this vertical slice is reliable. F-11 Project Inspector remains a separate Stage 3 utility.
