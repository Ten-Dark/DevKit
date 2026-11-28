# MCP, Integrations & Storage

> Chat2Agent was retired on 2026-11-28 and is no longer an active DevKit integration. See [the retirement record](../architecture/CHAT2AGENT_RETIREMENT.md).

## Purpose

DevKit exposes one workspace for local developer services, MCP servers, and read-only knowledge sources:

- **MCPWorkers** — the sole management path for LocalMCP and LocalMCP Tunnel Worker Instances, including health and lifecycle actions.
- **Desktop integrations** — explicit configuration and launch-only status for Multi-AI Aggregator.
- **Discover servers** — searchable metadata from the official Model Context Protocol Registry.
- **My MCPs** — saved local stdio and remote Streamable HTTP connections, connection state, and discovered tool names.
- **Storage** — read-only access to a selected local folder and an Obsidian vault's Markdown notes, plus Karakeep connection/authentication status only.

The integrations are separate from the general Runtime Services page. DevKit preserves each external application's ownership and lifecycle semantics. It does not silently adopt processes it did not launch or terminate third-party processes by PID.

## MCPWorkers and desktop integrations

MCPWorkers is the sole management integration for LocalMCP and LocalMCP Tunnel Worker Instances. DevKit uses the documented MCPWorkers Public API v1 for Definition/Instance discovery, health checks and explicit Worker lifecycle actions. It does not inspect or modify MCPWorkers Registry files, worker configuration files, package directories or worker processes directly.

DevKit Runtime starts or attaches to MCPWorkers Manager according to process ownership:

- A Manager launched by the current DevKit session is owned by that Runtime session and may be gracefully shut down by it.
- An already-running external Manager is attached without claiming ownership and is never stopped by DevKit.
- Starting the Manager does not automatically start Worker Instances.
- The external LocalMCP Tunnel HTTP runtime remains independently managed. MCPWorkers may observe and validate its health, but DevKit does not stop or claim ownership of that process.

The MCP & Integrations page intentionally exposes no direct LocalMCP or LocalMCP Tunnel status/start/stop controls. Worker management is centralized in Services through MCPWorkers.

The default Projects root is %USERPROFILE%/Projects. It can be changed from the page and is persisted in the DevKit workspace.

| Integration | DevKit action | Lifecycle boundary |
| --- | --- | --- |
| Multi-AI Aggregator | Opens the user-selected Multi-AI Aggregator.exe | Launch-only integration. DevKit detects the exact configured executable path but does not force-terminate the application; close it from its own window |

Multi-AI Aggregator's executable is selected explicitly through a native file picker and stored as a non-secret path in DevKit's workspace settings. DevKit validates that the selected file is a regular executable with the expected application filename. It launches the application detached and leaves window/shutdown ownership to Multi-AI Aggregator.

The MCPWorkers Manager/Worker lifecycle acceptance evidence and complete Stage 2 validation results are maintained in the [Stage 2 acceptance record](../architecture/STAGE_2_UNIFIED_WORKSPACE.md). This guide remains the operational reference for MCP connection, credential and Storage behavior.
- The external LocalMCP Tunnel runtime was left running and was not restarted or terminated.

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

`OsSecretStore` is an OS-backed credential encryption adapter, not the complete DevKit Vault. Independent Locked/Unlocked state, master-key hierarchy, unlock UX, recovery, backup, and cross-device migration remain separate architecture work. The KeePassXC SecretProvider reference is verified for the accepted connection-only workflow. Additional credential sources remain out of scope until their provider, API and scoped-reference contracts are verified; do not create a competing credential store by assumption.

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

### Obsidian Vaul

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

- MCP server connections are not automatically reconnected and packages are not automatically updated or uninstalled. MCPWorkers Manager lifecycle is coordinated separately by DevKit Runtime.
- Karakeep write operations, two-way sync, Obsidian plugin workflows, content indexing, and attachment downloads remain out of scope.
- The main-process SecretProvider contract/registry, KeePassXC CLI adapter, and separate PowerShell secure-console unlock prompt are implemented. The master password is not sent through renderer IPC or CLI arguments. The configured KeePassXC reference was resolved through the Main Process and the Karakeep connection-only provider returned `connected`; bookmark content was not accessed.

## Validation

Current end-to-end acceptance and test counts are maintained only in the [Stage 2 acceptance record](../architecture/STAGE_2_UNIFIED_WORKSPACE.md). This avoids maintaining competing historical test snapshots in the operational guide. The user-confirmed Karakeep workflow is connection/authentication-only; bookmark content remains outside DevKit's access boundary.
