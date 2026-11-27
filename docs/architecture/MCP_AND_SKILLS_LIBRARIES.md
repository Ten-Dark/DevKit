# MCP Library & Skills Library

**Status:** Product architecture target; MCP Registry discovery exists in the Stage 2 WIP, Skills Library is planned.
**Scope:** Discovery, review, configuration and lifecycle boundaries for MCP servers and agent Skills.

## 1. Why there are two libraries

MCP servers and Skills solve different problems and must remain separate product concepts.

- **MCP server:** exposes tools/resources/prompts through the Model Context Protocol and has a transport and server lifecycle.
- **Skill:** supplies instructions, workflows, reusable agent capability definitions or packaged supporting files. It may depend on MCP tools, but is not itself an MCP server.

A Skill can declare MCP dependencies. DevKit may display the relationship, but must not silently install, enable or grant access to those dependencies.

## 2. MCP Library

### Discovery sources

- Use the official Model Context Protocol Registry API as the primary catalogue source.
- Add other official publisher-controlled registries only through explicit source adapters.
- Preserve source identity, publisher/owner, repository, version, transport, package/runtime requirements, capabilities and source timestamps where available.
- Treat all catalogue metadata as untrusted input.

### User workflow

1. Search or browse the catalogue.
2. Open a server detail view and review source, publisher, version, transport, declared requirements and permissions.
3. Save a configuration without executing it.
4. Review the local command or remote endpoint and required credentials.
5. Explicitly connect and approve the native trust confirmation.
6. View connection state and discovered tools.
7. Update/remove only through supported, ownership-aware operations.

Browsing must never execute packages, contact a server endpoint or download a package. A registry listing is not a security review or trust certification.

## 3. Skills Library

### Discovery sources

Use an official API when the selected Skills source provides one. Otherwise, use the publisher's official repository/release interface. There is no assumption that a single universal official Skills API exists.

Do not scrape unrelated websites or present unofficial aggregators as official sources. Every source adapter must identify its canonical source, supported operations, pagination/rate limits and compatibility metadata.

### User workflow

1. Browse/search supported Skills sources.
2. Inspect the publisher, source repository, version, description, compatibility, required files and declared permissions.
3. Preview the content and file manifest before installation.
4. Review dependencies, including any required MCP servers/tools.
5. Explicitly install/connect and enable the Skill.
6. Manage enable/disable, update and removal.
7. Inspect provenance, installed version, installation location and last update.

Installation and activation are separate states. A downloaded or installed Skill must not become active without explicit user action.

### Trust and permission model

Skills are untrusted content until reviewed. A Skill must not receive implicit:
- filesystem access;
- shell/command execution;
- network access;
- access to secret values;
- access to MCP tools or other integrations;
- permission to modify project files or invoke external actions.

Permissions should be declared, scoped and enforced by the host agent/runtime where supported. If the host cannot enforce a permission boundary, DevKit must disclose the limitation and must not claim that the Skill is sandboxed. Never expose secret values to Skill catalogue metadata, previews or logs.

## 4. Shared catalogue architecture

Each catalogue source is an adapter with:
- stable source ID and adapter version;
- official source URL/API identity;
- search/list/detail capabilities;
- pagination and bounded request behavior;
- normalized metadata schema;
- source-specific version/compatibility representation;
- provenance and trust classification;
- sanitized errors and request limits.

Keep source-specific API logic outside the renderer. The main process validates and normalizes untrusted metadata. The UI displays the canonical source and review status.

Do not build a universal marketplace framework before the first two concrete sources establish the required contracts. Start with one official MCP Registry source and a narrowly scoped Skills source adapter, then generalize only where evidence supports it.

## 5. Relationship to Runtime and MCPWorkers

- DevKit Runtime owns the lifecycle of DevKit-managed local components, including the MCPWorkers Manager process.
- MCPWorkers owns Worker Definitions/Instances, their installation/configuration and worker process lifecycle.
- MCP Library owns saved MCP connection metadata and connection lifecycle for MCP servers configured directly in DevKit.
- Skills Library owns Skill catalogue metadata, installed Skill packages and activation state.
- Starting MCPWorkers Manager does not automatically start Worker Instances.
- Installing/enabling a Skill does not automatically install or authorize its MCP dependencies.

These boundaries prevent duplicate process managers, competing registries and implicit privilege escalation.

## 6. Delivery sequence

1. Complete Stage 2 workspace/runtime ownership and MCPWorkers Manager lifecycle acceptance.
2. Retain the existing MCP Registry discovery and saved-connection vertical slice.
3. Design and implement Skills Library as a separate post-Stage-2 feature with source provenance and trust boundaries.
4. Add additional official sources only after the initial adapters have tests and packaged acceptance.

Skills Library is not a Stage 2 gate and must not expand the current Workspace MVP into a broad third-party marketplace.
