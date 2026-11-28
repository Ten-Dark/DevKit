# MVP-first development workflow

## Purpose

DevKit prioritizes complete, usable functionality delivered through substantial, logically coherent stages. A stage may contain a long chain of related tasks; it should be planned and implemented as one integrated outcome rather than fragmented into repeated mini-audits. Work should move from a sufficiently defined architecture and user problem to a working end-to-end MVP, followed by one comprehensive stage review.

This workflow is the source of truth for implementation agents and contributors. Feature-specific scope and sequencing are maintained in [the roadmap](../ROADMAP.md) and [feature specifications](../features/).

## Stage 1 — Stage planning and architecture

Before implementation, define:

1. The stage's user-visible outcome and why it matters.
2. MVP boundary, non-goals and deferred capabilities.
3. A logically ordered task chain and integration points.
4. Required contracts, data ownership, permissions and failure behavior.
5. Acceptance criteria and validation commands/evidence.
6. Dependencies on prior stages and known risks.

Planning must be sufficient to begin implementation, not an attempt to resolve every future design question. Do not let architecture work become an indefinite substitute for a working MVP.

## Stage 2 — MVP implementation

The objective is to deliver the smallest complete version that solves the feature's primary user problem.

1. Implement the complete planned task chain for the stage, preserving the agreed contracts.
2. Prefer end-to-end vertical slices over isolated scaffolding.
3. Reuse existing project conventions where they fit; avoid speculative frameworks and unnecessary dependencies.
4. Run focused tests during implementation to catch immediate regressions, without turning each task into a separate full audit.
5. Integrate the modules and verify their joint behavior before declaring the stage complete.
6. Keep a concise record of implementation decisions, deviations and known limitations.

### MVP completion criteria

An MVP is complete when:

- The primary user problem and success outcome are clearly defined.
- The core workflow works end to end in the application.
- Required input validation and essential failure handling are present.
- The user can obtain the intended result without manual workarounds.
- Focused validation for the primary workflow passes.

MVP completion does **not** require every edge case, optional feature, visual refinement, generalized abstraction, or full-repository audit to be finished. Do not label a feature complete if a core security or correctness requirement in its feature specification is unmet.

## Stage 3 — Comprehensive stage audit and correction

After the planned implementation chain is complete and integrated:

1. Review the whole stage against its requirements, contracts and acceptance criteria.
2. Review cross-module integration, security boundaries, data handling and failure recovery where relevant.
3. Run the appropriate test, lint, type-check, build, packaging and integration validation suite.
4. Record concrete findings with severity, evidence and affected scope.
5. Fix blocking and in-scope findings, then rerun affected validation.
6. Document the result and release/integrate the completed stage.

This is the normal point for a comprehensive audit. Do not repeat a repository-wide audit after every small implementation task.

### Immediate-stop exceptions

Do not wait until the stage audit to address:

- A critical security exposure or privilege-boundary violation.
- A credible risk of data loss or corruption.
- A broken shared contract that blocks safe integration.
- A blocking regression that prevents continued implementation or validation.
- An uncontrolled process, destructive action or secret leak.

## Stage 4 — Polish

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

Validation during implementation must be proportional to the changed code, user impact and risk. Comprehensive review is normally performed at the end of the major stage, once its components can be evaluated together.

### Required approach

- Confirm the working branch and clean/expected worktree before beginning.
- Run focused tests during implementation and expand them for process boundaries, shared contracts, sensitive data and packaging changes.
- At stage completion, review all stage files and cross-module integration as one coherent unit.
- Record concrete findings and actionable follow-up work; do not create reports merely to demonstrate that an audit occurred.

### Prohibited waste patterns

- Audits without a concrete reason or decision they are meant to inform.
- Repeated full-repository audits after small, localized changes or every item in a planned task chain.
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

## Stage lifecycle

`Planned → Architecture & Acceptance → Implementation → Integration → Comprehensive Audit → Corrections & Validation → Release & Documentation`

A stage may be integrated after its essential correctness, security and acceptance requirements are satisfied. Polish is iterative; it is not a reason to delay a useful MVP indefinitely. Use Conventional Commit messages and update the relevant roadmap and documentation as part of stage completion.
