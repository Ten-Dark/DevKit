# DevKit Feature Roadmap

## Product direction

DevKit is a Windows-first desktop toolbox for focused developer utilities. Features should solve concrete, recurring tasks with a fast, understandable interface and minimal setup. Prefer small, complete workflows over broad collections of partially implemented capabilities.

The roadmap is intentionally MVP-first: each feature is delivered as a usable vertical slice, then improved through a risk-based polish backlog. The governing process is [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md).

## Delivery principles

- Implement one feature at a time in the order below.
- Keep the MVP scope explicit; defer enhancements to the polish stage.
- Do not start the next feature until the current MVP is working, validated, and accepted.
- Avoid unrelated refactors, speculative abstractions, and audits without a concrete trigger.
- Preserve existing DevKit workflows and security boundaries.

## Planned sequence

| Order | Feature | MVP outcome | Status |
| --- | --- | --- | --- |
| 1 | [F-09 — Color Converter](features/F-09-color-converter.md) | Convert, inspect, and copy common color formats | Planned |
| 2 | [F-10 — Port Inspector](features/F-10-port-inspector.md) | Inspect local listening ports and owning processes, read-only | Planned |
| 3 | [F-11 — Project Inspector](features/F-11-project-inspector.md) | Understand a local project and export a safe Markdown AI Context Pack | Planned |

## Entry condition

Implementation of F-09 begins only after the current stabilization / F-08 work has been accepted and integrated. This roadmap task does not alter or interrupt that work.

## Feature lifecycle and acceptance

Each feature follows:

1. Define the primary user problem and MVP success outcome.
2. Implement the smallest complete end-to-end workflow.
3. Run focused validation of the core flow and changed code.
4. Confirm MVP acceptance before moving to polish or the next feature.
5. Track improvements by polish zone and P0–P3 priority.

The detailed process, audit policy, and MVP completion criteria are defined in [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md).

## Scope control

Feature documents distinguish MVP requirements from polish and expansion. Items listed under polish are not prerequisites for the initial MVP unless later evidence reveals a core correctness or security requirement. Changes to the sequence or MVP boundary should be made in this roadmap and the relevant feature specification, not inferred from implementation notes.
