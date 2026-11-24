# DevKit

DevKit is evolving from a Windows-first desktop toolbox into an independent **Developer Workspace Platform**: a modular environment for managing development projects, services, MCP integrations, data, workflows and quality controls from one place.

The current application is still an early desktop toolbox built with Electron and React. Its implemented workflows are:

- **Project to Markdown** — scan a selected project directory and generate a consolidated Markdown document containing a file tree (when enabled) and readable file sections. The workflow supports configurable file-size limits and optional .gitignore handling.
- **XMind to Markdown** — convert .xmind mind maps into Markdown outlines, including topic hierarchy, notes, hyperlinks and markers.

The application also provides tool search/navigation, favorites, recent tools, persistent settings, and an in-app update interface for supported packaged Windows builds.

The broader platform direction is documented in the [Product Vision](docs/PRODUCT_VISION.md) and [Architecture Blueprint](docs/architecture/ARCHITECTURE_BLUEPRINT.md). These describe the target architecture, not features already implemented. Service orchestration, Vault, unified Storage and the full Inspector platform remain planned work.

## Documentation

### Product planning

- [Product Vision](docs/PRODUCT_VISION.md) — product mission, goals, non-goals and user-facing areas.
- [Architecture Blueprint](docs/architecture/ARCHITECTURE_BLUEPRINT.md) — Core / Workspace / Extensions boundaries and platform strategy.
- [Architecture Decisions](docs/architecture/ARCHITECTURE_DECISIONS.md) — baseline ADRs for the first platform MVP.
- [Stage 0 Foundation](docs/architecture/STAGE_0_FOUNDATION.md) — verified baseline, migration strategy and Stage 1 Runtime implementation plan.
- [Service Intelligence & Orchestration](docs/architecture/SERVICE_INTELLIGENCE.md) — service states, dependencies, health and lifecycle coordination.
- [Inspector Architecture](docs/architecture/INSPECTOR.md) — infrastructure observation and evidence-based project analysis.
- [Feature Roadmap](docs/ROADMAP.md) — major delivery stages and retained feature specifications F-09 through F-11.
- [MVP-first Development Workflow](docs/DEVELOPMENT_WORKFLOW.md) — stage-based implementation, acceptance criteria and audit policy.
- [F-09 — Color Converter](docs/features/F-09-color-converter.md)
- [F-10 — Port Inspector](docs/features/F-10-port-inspector.md)
- [F-11 — Project Inspector](docs/features/F-11-project-inspector.md)

### Project guides

- [Documentation index](docs/README.md) — complete documentation catalogue and conventions.
- [Development guide](docs/development.md) — local setup, commands, tests and diagnostics.
- [Release workflow](docs/releasing.md) — versioning, packaging, CI gates and publication controls.
- [Dependency security plan](docs/dependency-security-plan.md) — dependency risk assessment and remediation approach.
- [XMind to Markdown guide](docs/tools/xmind-to-markdown.md) — conversion behavior, limits and safety constraints.

## Use the app

For ordinary users, download and run the published Dev Toolbox Setup .exe. The installer includes the Electron runtime and application files. **Node.js is not required to install or use the packaged application.**

## Developer setup (Windows 10/11 x64)

The repository includes a portable, project-local development environment. You do not need to install Node.js globally or modify the system PATH.

1. Clone or download this repository.
2. Double-click Setup DevKit.bat once. It downloads the pinned Node.js 22.23.5 Windows archive from nodejs.org, verifies its SHA-256 against the official checksum manifest, extracts it into .tools/, runs npm ci from the lockfile, and installs the Electron runtime required for development launch.
3. Double-click Start DevKit.bat whenever you want to work. It opens a small menu for running the app, checks, or building the installer.

The first setup requires an internet connection and can take several minutes because it downloads Node.js, project dependencies and the Electron development runtime. The portable runtime and dependencies stay inside this checkout (.tools/ and node_modules/) and are excluded from Git.

### Developer menu

| Menu | Action |
| --- | --- |
| 1 | Start the app in development mode |
| 2 | Run ESLint, TypeScript and Vitest checks |
| 3 | Build and validate the Windows installer in dist-electron/ |
| 4 | Run the full release verification chain |
| 5 | Open the project folder |

You can rerun Setup DevKit.bat after deleting .tools/ or node_modules/ to repair the local environment. The setup uses the exact Node.js version pinned in .nvmrc.

### Manual commands

After setup, the same commands can be run from a terminal:

| Command | Purpose |
| --- | --- |
| npm run dev | Start Vite and Electron in development mode |
| npm run check | Run lint, TypeScript no-emit checking and Vitest |
| npm test | Run the unit and component test suite |
| npm run build | Compile the main/preload TypeScript and build the renderer |
| npm run package | Build, create the Windows distributable, generate updater metadata and validate the package |
| npm run release:check | Run the full local release verification chain |

Use the project-local Node.js executable when running commands manually:
.\.tools\node-v22.23.5-win-x64\node.exe

## Current support and target direction

- Windows 10/11 x64 for the currently supported desktop package, developer bootstrap and updater.
- Internet access for first-time developer setup and dependency installation.

Windows is the current supported target. Cross-platform operation is a product goal, not a claim about the current release.

## Project layout

- src/main — Electron main-process services, IPC handlers, filesystem operations and updater lifecycle.
- src/preload — the isolated renderer API exposed through contextBridge.
- src/renderer — React application and tool interfaces.
- src/shared — types and pure utilities shared across processes.
- scripts — build validation, developer bootstrap and diagnostic utilities.
- tests — end-to-end and integration-level test scenarios.
- docs — maintained project documentation; see the [documentation index](docs/README.md).

## MCP & Integrations

Manage LocalMCP, LocalMCP Tunnel Edition and Chat2Agent, browse the official MCP Registry, and add local stdio or remote Streamable HTTP servers from the dedicated workspace. See [MCP & Integrations](docs/MCP-INTEGRATIONS.md) for connection behavior, supported transports and credential security.

## Security model

The renderer runs with context isolation enabled, Node integration disabled and Electron sandboxing enabled. Renderer access to privileged operations is mediated by the preload API and validated main-process IPC handlers. Filesystem access is constrained to user-selected directories and explicitly authorized output paths.

XMind archives are validated before extraction and processed under configured entry-count and uncompressed-size limits. See [the XMind guide](docs/tools/xmind-to-markdown.md) for format and safety details.

## Updates

Automatic update support is intended for packaged Windows NSIS builds distributed through GitHub Releases. Development builds and unsupported platforms report updater support as unavailable. The current user-facing update controls are available in Settings.

See [the release guide](docs/releasing.md) for the release process and its verification requirements.
