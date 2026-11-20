# MVP-first development workflow

## Purpose

DevKit prioritizes delivering complete, usable functionality early. Work should move from a clearly defined user problem to a working end-to-end MVP before broad polishing, generalized architecture work, or repository-wide audits begin.

This workflow is the source of truth for implementation agents and contributors. Feature-specific scope and sequencing are maintained in [ROADMAP.md](ROADMAP.md) and [features/](features/).

## Stage 1 — MVP Development

The objective is to deliver the smallest complete version that solves the feature's primary user problem.

1. **Define the problem.** State who needs the feature, the task they need to complete, and the expected successful outcome.
2. **Set the MVP boundary.** Identify the essential inputs, core processing, and user-visible result. Explicitly defer enhancements.
3. **Implement a vertical slice.** Prefer a working end-to-end user flow over isolated infrastructure, speculative abstractions, or broad scaffolding.
4. **Keep the solution proportionate.** Reuse existing project conventions and APIs where they fit. Avoid premature abstraction, unnecessary dependencies, and architecture that is not required by the MVP.
5. **Validate the primary workflow.** Run focused tests and checks covering the changed code and the essential user journey. Fix blockers that prevent the intended result.
6. **Accept the MVP.** Confirm the user can complete the primary task and obtain the intended result. Record known limitations and deferred improvements.

### MVP completion criteria

An MVP is complete when:

- The primary user problem and success outcome are clearly defined.
- The core workflow works end to end in the application.
- Required input validation and essential failure handling are present.
- The user can obtain the intended result without manual workarounds.
- Focused validation for the primary workflow passes.

MVP completion does **not** require every edge case, optional feature, visual refinement, generalized abstraction, or full-repository audit to be finished. Do not label a feature complete if a core security or correctness requirement in its feature specification is unmet.

## Stage 2 — Polish

Begin this stage after the MVP is working and accepted. Capture improvements in the relevant zone, assign a priority, and address them according to impact and risk.

1. **Correctness & Reliability** — edge cases, malformed input, error recovery, data integrity, robustness.
2. **Security & Privacy** — trust boundaries, permissions, sensitive-data handling, path safety, dependency and platform risks.
3. **UX & Accessibility** — interaction clarity, keyboard access, feedback, responsive layout, accessibility.
4. **Performance** — startup and interaction latency, memory use, large-input behavior, responsiveness.
5. **Architecture & Maintainability** — abstractions justified by actual duplication or change pressure, clear module boundaries, documentation.
6. **Testing & Release** — regression coverage, integration/E2E tests where warranted, packaging, release readiness.

### Priority levels

| Priority | Meaning | Handling |
| --- | --- | --- |
| **P0 — Critical** | Blocks core use, risks data/security, or makes release unsafe | Fix before proceeding or releasing the affected capability |
| **P1 — Important** | Material reliability, usability, security, or maintainability issue | Schedule in the current feature cycle where practical |
| **P2 — Normal** | Useful improvement with a reasonable workaround | Add to the planned polish backlog |
| **P3 — Later** | Minor refinement, optional capability, or low-impact idea | Defer until there is a clear reason to prioritize it |

Priorities describe impact, not implementation order by themselves. Reassess them when new evidence changes the risk or user impact.

## Review, testing, and audit policy

Validation and review must be proportional to the changed code, user impact, and risk.

### Required approach

- Review the changed files and their direct integration points.
- Run the narrowest tests that meaningfully validate the change.
- Expand validation when the change crosses process boundaries, affects shared contracts, touches sensitive data, or changes packaging/release behavior.
- Record concrete findings and actionable follow-up work; do not create reports merely to demonstrate that an audit occurred.

### Prohibited waste patterns

- Audits without a concrete reason or decision they are meant to inform.
- Repeated full-repository audits after small, localized changes.
- Rechecking unchanged code without new evidence, a changed dependency, a changed threat model, or a relevant regression.
- Endless analysis, planning, or speculative architecture instead of implementing the agreed MVP.
- Mandatory independent auditor involvement for every task.

### When a separate auditor is justified

Bring in an independent auditor or specialist when there is a concrete need, such as:

- A security-sensitive feature, privilege boundary, filesystem boundary, or handling of potentially sensitive user data.
- A substantial architectural change with broad downstream impact.
- A complex integration whose failure could affect existing workflows.
- A release-critical change, installer/updater change, or a material regression with unclear cause.

A focused peer review is sufficient for ordinary low-risk changes. An auditor is not a mandatory stage gate for every implementation.

## Working agreements for implementation agents

- Read the relevant feature specification and only the project documentation needed for the task.
- Confirm the working branch and working-tree state before editing. Never overwrite or mix another agent's uncommitted work.
- Keep changes scoped to the active task. Do not bundle unrelated refactors or opportunistic cleanup.
- Prefer small, reviewable commits with Conventional Commit messages.
- Report what works, what was validated, known limitations, and any deferred P0/P1 issues.
- Do not claim a task is integrated until the changes are actually merged into the intended branch.

## Feature lifecycle

`Planned → MVP Development → MVP Validation → MVP Accepted → Polish → Released`

A feature may be released after MVP acceptance when its essential correctness, security, and release requirements are satisfied. Polish is iterative; it is not a reason to delay a useful MVP indefinitely.
