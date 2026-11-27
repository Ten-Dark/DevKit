# Development workflow

## Runtime and installation

Use Node.js **22.23.5**, as pinned by .nvmrc. package.json also constrains the supported range to >=22.23.0 <23. Do not install dependencies under a different major version.

```powershell
node --version
npm ci
```

The preinstall script rejects unsupported Node versions before npm installs project dependencies.

### MCPWorkers Manager build dependency

DevKit bundles the MCPWorkers Manager CLI as an Electron-hosted sidecar. For a local build, check out the Ten-Dark/MCPWorkers repository either beside DevKit at `../MCPWorkers` or inside the DevKit repository at `./MCPWorkers`. Alternatively, set `MCPWORKERS_REPO` to its absolute path. Install the Manager package dependencies before building:

```powershell
# MCPWorkers checked out beside DevKit
npm ci --prefix ..\MCPWorkers\platform\worker-manager

# MCPWorkers checked out inside the DevKit repository
npm ci --prefix .\MCPWorkers\platform\worker-manager
```

The selected Manager source must implement the `DEVKIT_MCPWORKERS_SHUTDOWN_PIPE` and `MCPWORKERS_DATA_ROOT` contracts; the sidecar build fails closed if they are absent. Runtime execution uses Electron's embedded Node runtime and does not require the MCPWorkers checkout or a global Node installation.

CI checks out Ten-Dark/MCPWorkers into the `MCPWorkers` subdirectory. If the repository is private or cross-repository checkout is restricted, configure the `MCPWORKERS_REPO_TOKEN` repository secret with read access.

## Daily development

```powershell
npm run dev
```

This starts Vite and launches the Electron desktop application.

## Validation

```powershell
npm run check
```

check runs, in order:

1. ESLint across the repository.
2. TypeScript no-emit check.
3. Vitest unit and component tests.

Vitest runs with one worker and a 60-second per-test timeout. This avoids worker-process exhaustion on Windows and gives the large filesystem-bound Project Markdown regression fixture enough time under load.

Run a focused Vitest file with:

```powershell
npx vitest run src/main/project-markdown.test.ts
```

Run development Electron E2E with npm run test:e2e:dev. Playwright uses a single worker in CI; packaged Electron tests should also be run sequentially to avoid single-instance collisions.

## Build and package

```powershell
npm run build
npm run package
```

build compiles the main/preload TypeScript and builds the renderer. package then packages the already-built application, generates electron-updater latest.yml metadata from the NSIS installer and its blockmap, and validates the resulting ASAR and updater configuration.

Lower-level commands:

- npm run dist — rebuild and package the application without publishing.
- npm run dist:from-build — internal CI path; expects current compiled output and does not rebuild.
- npm run pack — build and create an unpacked Windows application directory.
- npm run validate:asar — validate app.asar plus resources/app-update.yml.

Do not invoke dist:from-build manually after changing source files unless npm run build has completed successfully.

## E2E and updater testing

- `npm run test:e2e:dev` — development Electron smoke/regression suite.
- `npm run test:e2e:packaged` — packaged application E2E suite, including Windows x64 Runtime crash containment.
- `npm run test:manager-sidecar` — starts an isolated MCPWorkers Manager sidecar with a temporary data root, verifies API v1 readiness and requests graceful shutdown through the Runtime named pipe using Electron's embedded Node runtime.
- `npm run test:manager-sidecar:packaged` — repeats the same lifecycle test against the unpacked packaged Electron executable. Set `DEVKIT_ELECTRON_EXECUTABLE` to an installed executable to test an NSIS-installed app.
- Both sidecar tests use a temporary data root and do not touch the user's configured or live MCPWorkers Manager.

To validate the actual NSIS-installed application rather than `dist/win-unpacked`, run `npm run dist` to create the NSIS installer, install it into an isolated per-user directory, and set `PACKAGED_EXE` to that installed `Dev Toolbox.exe` before running the suite:

```powershell
$env:PACKAGED_EXE = 'C:/path/to/installed/Dev Toolbox.exe'
npm run test:e2e:packaged
```

The crash-containment test terminates the Electron main process itself (not the Playwright launcher) and verifies that the managed child process stops.

- `npm run test:e2e:updater` — optional NSIS v1-to-v2 local-feed upgrade scenario.

The updater E2E requires two local artifacts supplied through environment variables:

- DEVTOOLBOX_UPDATER_E2E_INSTALLER — path to the older installed NSIS installer.
- DEVTOOLBOX_UPDATER_E2E_FEED_DIR — directory containing latest.yml, the newer NSIS installer and its matching blockmap.

The updater E2E creates isolated install and user-data directories and serves the feed over loopback HTTP. It does not publish a public GitHub Release. Without both variables, the test is explicitly skipped.

## Full local release verification

```powershell
npm run release:check
```

This runs check, development E2E, production build, packaging, updater metadata generation, ASAR validation and packaged E2E. It does not create a Git tag, push, or publish a release.

## Diagnostics

Manual XMind ZIP helpers live under scripts/diagnostics. They are not part of the application runtime or standard validation pipeline. See scripts/diagnostics/README.md and docs/tools/xmind-to-markdown.md.\n