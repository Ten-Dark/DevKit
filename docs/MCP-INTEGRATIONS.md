# MCP & Integrations

## Purpose

DevKit exposes one workspace for local developer services and MCP servers:

- **Local development stack** — lifecycle controls and health snapshots for LocalMCP, LocalMCP Tunnel Edition and Chat2Agent.
- **Discover servers** — searchable metadata from the official Model Context Protocol Registry.
- **My MCPs** — saved local stdio and remote Streamable HTTP connections, connection state and discovered tool names.
- **Manual setup** — add an existing local MCP command or a remote endpoint without relying on a Registry listing.

This area is separate from the general Runtime Services page. It manages existing external launchers with their established start/stop semantics; it does not wrap background supervisors as short-lived child processes or take ownership of their internal process trees.

## Local development stack

The default Projects root is %USERPROFILE%/Projects. It can be changed from the page and is persisted in the DevKit workspace.

| Integration | DevKit action | Lifecycle boundary |
| --- | --- | --- |
| LocalMCP | Calls the installed %APPDATA%/npm/localmcp.cmd CLI for status/start/stop | LocalMCP owns its background agent and Cloudflare relay |
| LocalMCP Tunnel | Opens MCP/LocalMCP-Tunnel/scripts/start-tunnel.ps1 in a visible PowerShell window | Keep the window open; stop with Ctrl+C in that window so the interactive KeePassXC flow remains available |
| Chat2Agent | Calls Chat2Agent/start.bat, service-status.mjs and stop.bat | Chat2Agent owns the DevSpace supervisor and ngrok tunnel |

DevKit does not automatically start any of these services on application launch. The status panel reads their live state; it does not expose MCP URLs, API keys or passwords. Tunnel Edition deliberately has no force-stop action in DevKit because its terminal session can be waiting for KeePassXC unlock input.

Chat2Agent's process lifecycle is managed here, but its OAuth/owner-password flow remains the responsibility of Chat2Agent. Adding its public endpoint to the generic MCP list is not an OAuth integration.

## Official MCP Registry

The Discover tab queries the official Registry API:

- Base URL: https://registry.modelcontextprotocol.io
- List/search: GET /v0.1/servers
- Server version details: GET /v0.1/servers/{name}/versions/{version}
- DevKit currently requests the latest version and pages results using the Registry cursor.

Registry data is publisher-supplied metadata. An active listing is not a code audit, security certification or guarantee that the server is trustworthy. DevKit shows the published source links and status metadata; review the publisher, repository, requested credentials, permissions, privacy policy and package contents before connecting.

The current quick-add path supports only Registry entries that declare a compatible npm package, npx runtime and stdio transport, with no required environment variables or extra package arguments. Other entries remain discoverable, but must be configured manually. Hosted Streamable HTTP endpoints can be added directly when they do not require authentication; authenticated endpoints use Manual setup so their headers can be entered explicitly.

Quick-add **saves configuration only**. It does not run npx during Registry browsing or when the saved connection is created. The user must press Connect and approve a native main-process trust dialog before a local package is downloaded/executed. Manual stdio commands and remote endpoints use the same main-process confirmation boundary. A third-party local MCP server runs with the current Windows account's permissions.

## Manual MCP connections

Two transports are supported:

### Local process (stdio)

Configure the executable, arguments, working directory and environment variables. Typical commands include npx.cmd, node.exe or an application-specific executable. Saving a connection does not start it. Connecting launches the child process, performs MCP initialization and requests tools/list.

### Remote endpoint (Streamable HTTP)

Configure the endpoint URL and optional HTTP headers. Public endpoints must use HTTPS; HTTP is permitted only for loopback addresses. User information, query parameters and fragments are rejected in endpoint URLs. Put bearer/API credentials in HTTP headers, not in the URL.

Remote requests send MCP protocol data and tool context to the endpoint operator. Verify the service owner and its data handling before connecting.

## Credential storage

The DevKit main process validates all IPC input. The renderer never receives saved environment values, HTTP header values, full endpoint URLs or raw process arguments. MCP credential encryption is isolated behind OsSecretStore in the main process; the MCP Hub does not call Electron safeStorage directly.

- Environment values, HTTP header values, full remote endpoint URLs (including path components) and local command arguments are encrypted before persistence.
- On Windows, Electron safeStorage uses operating-system credential protection facilities. If OS-backed encryption is unavailable, OsSecretStore refuses to save or decrypt data that requires encryption; there is no plaintext fallback.
- The connection store contains only safe metadata such as environment/header key names, argument count and the endpoint origin.
- Errors and process diagnostics are filtered to avoid echoing known secrets.
- Encrypted payloads are size-bounded and validated before decryption.

Credentials are decrypted only in the main process when a connection is started. Never put secrets into command arguments, package names or repository URLs.

**Vault boundary:** OsSecretStore is an OS-backed credential encryption adapter, not the complete DevKit Vault. Independent Locked/Unlocked state, master-key hierarchy, unlock UX, recovery, backup and cross-device migration remain open design work. The user's existing centralized credential source must be verified before DevKit integrates with it; do not create a competing credential store by assumption.

## Connection lifecycle

1. Discover a Registry entry or add a connection manually.
2. Review transport, source and publisher details.
3. Save the connection. No server process is started yet.
4. Press Connect and approve the native main-process trust dialog. This confirmation is enforced in the main process, not only by renderer UI.
5. DevKit launches the process or contacts the remote endpoint, initializes an MCP client and discovers available tool names/descriptions. Connect and tool-discovery handshakes have bounded timeouts.
6. Connection attempts are single-flight per saved connection. Disconnect before removing a saved connection.

Saved MCP servers are not automatically reconnected when DevKit restarts. This avoids silently executing packages or contacting external providers during startup. During application shutdown, pending connection attempts are cancelled and awaited before active sessions are closed.

## Current scope and limitations

- Supported client transports: local stdio and remote Streamable HTTP.
- The current UI lists discovered tools; invoking a third-party tool directly from DevKit is a separate capability and is not part of this initial integration.
- Registry is a preview service and its API/schema can evolve. The Registry client isolates that dependency behind a dedicated adapter.
- Registry packages requiring secrets, package arguments, custom runtimes or unsupported transports are not auto-installed from a card. Use Manual setup and inspect the instructions first.
- Chat2Agent's OAuth flow is not automatically imported into the generic Streamable HTTP connection store.
- No automatic service start, package update, uninstall or background re-connect is performed.
- Storage folder browsing is implemented separately in the Storage area; it does not grant MCP servers access to the selected folder.

## Validation

The current local validation covers **448 tests across 43 files**, including Registry normalization/search/pagination, install eligibility, encrypted persistence, URL/HTTP validation, missing OS encryption, real local stdio handshakes, single-flight connections, shutdown during an in-flight connection, timeout cleanup, native main-process trust confirmation, start-only service capabilities, Storage path/symlink protections, and read-only provider behavior.

Build, development Electron E2E (**3/3**), packaged Electron E2E (**5/5**), ASAR validation (**7,085 files**), and isolated NSIS install/uninstall smoke (installed E2E **5/5**; install/uninstall exit codes 0) pass on the current Windows 11 x64 host. The packaged E2E suite includes a real stdio MCP fixture exercising add → trust confirmation → connect → tools/list → disconnect → remove.
