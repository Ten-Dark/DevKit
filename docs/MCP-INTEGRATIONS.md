# MCP, Integrations & Storage

## Purpose

DevKit exposes one workspace for local developer services, MCP servers, and read-only knowledge sources:

- **Local development stack** — status and lifecycle controls for LocalMCP, LocalMCP Tunnel Edition, Chat2Agent, and Multi-AI Aggregator.
- **Discover servers** — searchable metadata from the official Model Context Protocol Registry.
- **My MCPs** — saved local stdio and remote Streamable HTTP connections, connection state, and discovered tool names.
- **Storage** — read-only access to a selected local folder and an Obsidian vault's Markdown notes, plus Karakeep connection/authentication status only.

The integrations are separate from the general Runtime Services page. DevKit preserves each external application's ownership and lifecycle semantics. It does not silently adopt processes it did not launch or terminate third-party processes by PID.

## Local development stack

The default Projects root is %USERPROFILE%/Projects. It can be changed from the page and is persisted in the DevKit workspace.

| Integration | DevKit action | Lifecycle boundary |
| --- | --- | --- |
| LocalMCP | Calls the installed %APPDATA%/npm/localmcp.cmd CLI for status/start/stop | LocalMCP owns its background agent and Cloudflare relay |
| LocalMCP Tunnel | Opens MCP/LocalMCP-Tunnel/scripts/start-tunnel.ps1 in a visible PowerShell window | Keep the window open; stop with Ctrl+C in that window so the interactive KeePassXC flow remains available |
| Chat2Agent | Calls Chat2Agent/start.bat, service-status.mjs and stop.bat | Chat2Agent owns the DevSpace supervisor and ngrok tunnel |
| Multi-AI Aggregator | Opens the user-selected Multi-AI Aggregator.exe | Launch-only integration. DevKit detects the exact configured executable path but does not force-terminate the application; close it from its own window |

DevKit Runtime will manage MCPWorkers Manager as an explicit workspace component; it must not terminate an externally running Manager. Other connected services and desktop applications remain opt-in and are not automatically started. The status panel reads their live state; it does not expose MCP URLs, API keys, or passwords. Tunnel Edition deliberately has no force-stop action because its terminal session can be waiting for KeePassXC unlock input.

Multi-AI Aggregator's executable is selected explicitly through a native file picker and stored as a non-secret path in DevKit's workspace settings. DevKit validates that the selected file is a regular executable with the expected application filename. It launches the application detached and leaves window/shutdown ownership to Multi-AI Aggregator.

Chat2Agent's process lifecycle is managed here, but its OAuth/owner-password flow remains the responsibility of Chat2Agent. Adding its public endpoint to the generic MCP list is not an OAuth integration.

### Lifecycle acceptance snapshot — 2026-11-27

- **LocalMCP:** the installed CLI's start/status/stop sequence passed; the service returned to its original stopped state after verification.
- **LocalMCP Tunnel Edition:** the existing local HTTP health endpoint returned `200`, and `tunnel-client` was present. The session was left running; DevKit does not claim stop ownership.
- **Chat2Agent:** service-status JSON and lifecycle-script syntax/preflight checks passed. DevKit treats an already-stopped service as a no-op and permits stop only when the process is identified as managed. The actual start script was not rerun because it creates a public ngrok tunnel; a previous attempt failed while resolving `drizzle-orm/package.js`, so start acceptance remains open.

## Official MCP Registry

The Discover tab queries the official Registry API. Responses are streamed with a 2 MiB search-page limit and a 1 MiB server-detail limit, a 12-second timeout, and redirects rejected:

- Base URL: https://registry.modelcontextprotocol.io
- List/search: GET /v0.1/servers
- Server version details: GET /v0.1/servers/{name}/versions/{version}
- DevKit requests the latest version and pages results using the Registry cursor.

Registry data is publisher-supplied metadata. An active listing is not a code audit, security certification, or guarantee that a server is trustworthy. Review the publisher, repository, requested credentials, permissions, privacy policy, and package contents before connecting.

The current quick-add path supports only Registry entries that declare a compatible npm package, npx runtime, and stdio transport, with no required environment variables or extra package arguments. Other entries remain discoverable but must be configured manually. Hosted Streamable HTTP endpoints can be added directly when they do not require authentication; authenticated endpoints use Manual setup so their headers can be entered explicitly.

Quick-add **saves configuration only**. It does not run npx during Registry browsing or when the saved connection is created. The user must press Connect and approve a native main-process trust dialog before a local package is downloaded or executed. Manual stdio commands and remote endpoints use the same main-process confirmation boundary. A third-party local MCP server runs with the current Windows account's permissions.

## Manual MCP connections

Two transports are supported.

### Local process (stdio)

Configure the executable, arguments, working directory, and environment variables. Typical commands include npx.cmd, node.exe, or an application-specific executable. Saving a connection does not start it. Connecting launches the child process, performs MCP initialization, and requests tools/list.

On Windows, the MCP SDK starts a DevKit-owned CommonJS bootstrap rather than launching the configured command directly. The bootstrap waits on a per-connection named-pipe handshake. The native provider verifies that it is a direct child of DevKit and attaches it to a private kill-on-close Job Object before the configured command is released. The command, any cmd.exe/npm/npx wrappers, the MCP server, and its descendants inherit Job Object ownership. If attachment fails, the configured command is never launched. Disconnect first attempts bounded stdin-EOF shutdown; if the process group remains, the transport force-terminates the Job Object. A DevKit crash also closes the owning Job Object handle and terminates the entire group.

### Remote endpoint (Streamable HTTP)

Configure the endpoint URL and optional HTTP headers. Public endpoints must use HTTPS; HTTP is permitted only for loopback addresses. User information, query parameters, and fragments are rejected in endpoint URLs. Put bearer/API credentials in HTTP headers, not in the URL.

Remote requests send MCP protocol data and tool context to the endpoint operator. Verify the service owner and its data handling before connecting.

## Credential storage

The DevKit main process validates all IPC input. The renderer never receives saved environment values, HTTP header values, full endpoint URLs, or raw process arguments. MCP and Karakeep credential encryption is isolated behind `OsSecretStore` in the main process; neither provider calls Electron `safeStorage` directly.

- Environment values, HTTP header values, full remote endpoint URLs (including path components), local command arguments, and the Karakeep API key are encrypted before persistence.
- On Windows, Electron `safeStorage` uses operating-system credential protection facilities. If OS-backed encryption is unavailable, `OsSecretStore` refuses to save or decrypt data that requires encryption; there is no plaintext fallback.
- The MCP connection store contains only safe metadata such as environment/header key names, argument count, and endpoint origin.
- Errors and process diagnostics are filtered to avoid echoing known secrets. MCP stderr is drained but never logged as raw text.
- Encrypted payloads are size-bounded and validated before decryption.

`OsSecretStore` is an OS-backed credential encryption adapter, not the complete DevKit Vault. Independent Locked/Unlocked state, master-key hierarchy, unlock UX, recovery, backup, and cross-device migration remain separate architecture work. The user's existing centralized credential source must be verified before DevKit integrates with it; do not create a competing credential store by assumption.

## Connection lifecycle

1. Discover a Registry entry or add a connection manually.
2. Review transport, source, and publisher details.
3. Save the connection. No server process is started yet.
4. Press Connect and approve the native main-process trust dialog. This confirmation is enforced in the main process, not only by renderer UI.
5. DevKit launches the process or contacts the remote endpoint, initializes an MCP client, and discovers available tool names/descriptions. Connect and tool-discovery handshakes have bounded timeouts.
6. Connection attempts are single-flight per saved connection. Disconnect before removing a saved connection.

Saved MCP servers are not automatically reconnected when DevKit restarts. This avoids silently executing packages or contacting external providers during startup. During application shutdown, pending connection attempts are cancelled and awaited before active sessions are closed.

## Storage providers

### Local Folder

- The user selects a local directory through the native file picker.
- DevKit lists directory entries, searches names, and returns metadata.
- General local folders are metadata-only: file contents are not read.
- Listing/search work is bounded. Hidden entries and known internal directories such as `.git`, `.trash`, `node_modules`, and `.devkit` are excluded.
- Symlink roots and symlink traversal are rejected. Disconnect removes only the stored folder reference; it does not modify the folder.

### Obsidian Vault

- The local provider recognizes an Obsidian vault by its actual `.obsidian` directory.
- It exposes a read-only Markdown preview for `.md` files up to 256 KiB.
- The `.obsidian` settings directory and other hidden/internal paths remain excluded from browsing.
- No Obsidian settings are changed. Write, delete, bulk mutation, and sync capabilities remain disabled.
- This is a folder-level adapter, not a full Obsidian plugin integration.

### Karakeep

- Connect to a self-hosted or HTTPS Karakeep instance using its API base URL and API key.
- The accepted workflow performs only a bounded authentication/status probe against `GET /api/v1/users/me`.
- DevKit must not list, search, preview, read, index, download, create, edit, archive, delete or synchronize bookmarks or attachments.
- API keys are encrypted in the main process with `OsSecretStore`; they are never returned to the renderer or written in plaintext.
- The API key is resolved through the approved KeePassXC secret reference in the main process; the renderer never receives the secret value.
- HTTPS is required for remote hosts. Plain HTTP is allowed only for loopback. Redirects are rejected and the status probe is bounded.
- Disconnect removes only DevKit's stored encrypted connection reference. It does not modify the Karakeep account or data.
- Regression tests must prove that startup, connect and refresh do not invoke bookmark list/search/read methods.
- The user confirmed the connection status as `Connected`; this confirms authentication only, not bookmark-content access.

Storage access does not grant MCP servers access to the selected folder or Karakeep account. MCP servers receive no Storage capability implicitly.

## Current scope and limitations

- Supported MCP client transports: local stdio and remote Streamable HTTP.
- The current UI lists discovered tools; invoking a third-party tool directly from DevKit is a separate capability and is not part of this initial integration.
- Registry is a preview service and its API/schema can evolve. The Registry client isolates that dependency behind a dedicated adapter.
- Registry packages requiring secrets, package arguments, custom runtimes, or unsupported transports are not auto-installed from a card. Use Manual setup and inspect the instructions first.
- Chat2Agent's OAuth flow is not automatically imported into the generic Streamable HTTP connection store.
- MCP server connections are not automatically reconnected and packages are not automatically updated or uninstalled. MCPWorkers Manager lifecycle is coordinated separately by DevKit Runtime.
- Karakeep write operations, two-way sync, Obsidian plugin workflows, content indexing, and attachment downloads remain out of scope.
- The main-process SecretProvider contract/registry, KeePassXC CLI adapter, and separate PowerShell secure-console unlock prompt are implemented. The master password is not sent through renderer IPC or CLI arguments. Interactive unlock and the configured database/entry still require live runtime verification. The previously verified KeePassXC reference is for LocalMCP-Tunnel runtime credentials, not Karakeep; no Karakeep-specific KeePassXC entry has been read or authenticated through the KeePassXC provider flow.

## Validation

Historical pre-MCPWorkers-integration audit snapshot: 500 tests across 48 files, including Registry normalization/search/pagination, MCP connection lifecycle, Storage path protections, Karakeep connection-only regression coverage and Multi-AI Aggregator process handling. The latest Stage 2 validation snapshot is maintained in [STAGE_2_UNIFIED_WORKSPACE.md](architecture/STAGE_2_UNIFIED_WORKSPACE.md); its 531-test result does not establish live MCPWorkers Manager acceptance or Runtime-managed Manager startup/shutdown.

The full `npm run release:check` pipeline passed on 2026-11-27: 491 tests, TypeScript/ESLint, native build and fault-injection checks, development Electron E2E (**3/3**), NSIS packaging, ASAR validation (**7,093 files**, including the unpacked CommonJS bootstrap and cross-spawn runtime), and packaged Electron E2E (**5/5**). `npm audit --audit-level=moderate` reported 0 vulnerabilities. The isolated NSIS install/uninstall smoke (installed E2E **5/5**, installer and uninstaller exit codes 0) remains prior evidence from 2026-11-24. The development and packaged E2E suites exercise add → trust confirmation → connect → tools/list → disconnect → remove with a real stdio fixture that spawns a descendant; both the configured server and descendant PIDs are confirmed exited after disconnect. Native tests verify attach-before-launch ownership and reject unrelated process IDs.

The user confirmed Karakeep status as `Connected` through the restricted connection-only workflow. This confirms authentication/status only; bookmark content must remain inaccessible. The KeePassXC-backed secret reference and interactive unlock path must be independently verified before claiming that credential-provider integration has passed live acceptance. Do not read, copy or duplicate unrelated credential entries.
