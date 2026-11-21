# Inspector Architecture

## Purpose

Inspector is DevKit's independent observation and quality-assurance subsystem. It detects operational problems in connected infrastructure and performs repeatable analysis of project changes, builds and releases. It must provide evidence and uncertainty, not an unsupported “all clear”. Inspector must also be able to inspect DevKit itself.

## Subsystems

### Inspector Core — infrastructure observation

- Consume Service Registry and health events.
- Observe service/MCP availability, process exits, API failures and readiness degradation.
- Track version changes, dependency/configuration drift and relevant log errors.
- Correlate symptoms with dependency relationships and affected services.
- Produce actionable findings with timestamps, evidence and confidence/limitations.

### Project Inspector — change and build analysis

Triggers may include a new commit, changed branch, new build artifact, explicit user request or a configured release workflow. Trigger sources must be declared; avoid silently watching arbitrary directories or repositories.

The analysis pipeline should gather:

1. Project identity, baseline revision and target revision/artifact.
2. Changed files and relevant history/changelog.
3. Runtime, dependency and configuration changes.
4. Existing project instructions and acceptance criteria.
5. Deterministic validation results.
6. AI-assisted review where configured and authorized.

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

Start with an explicit user-triggered project inspection using existing repository scripts: collect changed-file context, run selected deterministic checks, store a report and display evidence. Add automatic change detection and continuous infrastructure observation after the report model, permissions and event pipeline are stable.
