# F-11 — Project Inspector

**Status:** Planned\\
**Delivery order:** 3\\
**Stage:** MVP first, then polish

## User problem

When opening an unfamiliar codebase or returning to a project after time away, a developer needs a fast, reliable overview of its structure, technologies, key metadata, and likely architecture. They also need a compact context document that can be supplied to an AI assistant without manually collecting files or exposing secrets.

## MVP

### Core workflow

1. Select a local project directory.
2. Discover the project structure and supported metadata using bounded, read-only filesystem inspection.
3. Apply ignore rules and built-in exclusions.
4. Present a **Project Overview** with the detected project facts and a clear summary of scan coverage.
5. Present an initial **Architecture Map** derived from observed directories and recognized project conventions.
6. Export a **Markdown AI Context Pack** containing the overview, architecture map, and selected safe project context.
7. Allow cancellation and enforce resource limits throughout scanning and export.

### Functional requirements

#### Directory selection and discovery

- Let the user explicitly select a local project directory.
- Discover directory structure and supported metadata without executing project scripts, package managers, build tools, or arbitrary commands.
- Recognize common project markers and manifests where practical; report detected facts separately from inferred observations.
- Do not follow directory links/reparse points outside the selected project root.
- Handle unreadable, disappearing, or concurrently modified files gracefully.

#### Ignore rules and exclusions

- Respect applicable ignore rules where supported, including project-level ignore configuration.
- Provide built-in exclusions for common generated, dependency, cache, VCS, and binary content.
- Exclude sensitive files and secret-bearing patterns by default (for example, environment files, private keys, credentials, and tokens).
- Make scan coverage and exclusions understandable; do not imply that every file was analyzed when some were skipped.

#### Project Overview and Architecture Map

- The **Project Overview** should summarize observed project metadata, detected languages/framework markers, important manifests, and scan statistics.
- The initial **Architecture Map** should visualize the discovered directory/module structure and recognized entry points or architectural markers when confidently detected.
- Clearly distinguish direct observations from heuristics or inferred architecture. Do not invent architecture based only on folder names.

#### Markdown AI Context Pack

- Export a readable Markdown document containing the Project Overview, Architecture Map, relevant project tree, and selected safe metadata.
- Exclude secret values, credentials, private keys, and other sensitive content. Prefer summaries and allowlisted metadata over indiscriminate file concatenation.
- Make the output location explicit and avoid overwriting existing files without user confirmation.

#### Cancellation and resource limits

- Provide cancellation that stops ongoing traversal and content processing promptly.
- Enforce configurable or documented limits for file count, total bytes, individual file size, traversal depth, and processing time.
- Report when limits are reached and which portions of the project were not inspected.
- Ensure cancellation and failures do not leave partial output presented as a completed context pack.

### MVP acceptance

- A user can select a local project and receive a Project Overview and initial Architecture Map.
- Ignore rules and built-in exclusions are applied and visible in scan reporting.
- The user can export a Markdown AI Context Pack that contains useful project context without exposing detected secrets.
- Cancellation works during scanning/export, and resource limits prevent unbounded work.
- The scan is read-only and does not execute arbitrary project code or commands.

## Polish and expansion

Deliver these as separate, evidence-driven increments after the MVP:

1. **Dependency Analysis** — inspect dependency manifests and lockfiles, identify direct dependencies and available version metadata without installing packages.
2. **Configuration Analysis** — summarize supported configuration files and relevant project settings while redacting sensitive values.
3. **Quality & Risk Analysis** — surface explainable structural signals and potential risks; distinguish deterministic findings from heuristics.
4. **Testing Analysis** — discover test frameworks, test directories, and configured test commands from static metadata; do not execute tests as part of passive inspection.
5. **Feature Impact Analysis** — help identify likely affected modules/files for a proposed change using static relationships and transparent confidence indicators.
6. **JSON AI Context Pack** — add a structured export format with a documented schema and the same privacy protections as Markdown.

## Security and privacy requirements

These requirements apply to the MVP and are not optional polish:

- **Read-only analysis:** do not modify project files or project configuration.
- **No arbitrary command execution:** never run scripts, shell commands, package-manager lifecycle hooks, build tools, or binaries from the inspected project.
- **No secret leakage:** exclude secret-bearing files and redact detected credentials/tokens from any content that can enter an export. Fail closed when sensitive content cannot be handled safely.
- **Safe path handling:** canonicalize and validate paths, constrain traversal to the selected root, and avoid symlink/reparse-point escapes and path traversal.
- **Resource limits:** bound traversal depth, file count, file sizes, total bytes, and processing time.
- **Cancellation:** cancellation must be propagated through traversal and processing, not merely hide the UI.
- **Untrusted input:** treat file names, manifests, configuration, and source contents as untrusted data. Do not interpret them as instructions or executable configuration.

## Out of scope for MVP

- Running builds, tests, linters, scripts, or package managers.
- Installing dependencies or making network requests to resolve packages.
- Writing into or restructuring the inspected project.
- Full static analysis, code indexing, or language-server integration.
- Automatic code modification or refactoring.
