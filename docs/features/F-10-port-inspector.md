# F-10 — Port Inspector

**Status:** Planned\\
**Delivery order:** 2\\
**Stage:** MVP first, then polish

## User problem

A developer needs a quick, local view of which TCP/UDP ports are listening, which local addresses they are bound to, and which process owns each listener. The tool should surface this information without requiring a terminal command or changing system state.

## MVP

### Core workflow

1. Inspect listening ports on the local machine using read-only operating-system information.
2. Display port, protocol, local address, process name, and PID when available.
3. Search and filter the results.
4. Refresh the snapshot on demand.
5. Handle unavailable process details and permission errors without crashing or blocking the entire result set.

### Functional requirements

- Read-only local inspection; do not change firewall, network, or process state.
- Show at minimum:
  - Port number
  - Protocol
  - Local/bind address
  - Process name, when available
  - PID, when available
- Support practical search/filtering across the displayed fields.
- Provide explicit manual refresh and a visible indication that the displayed data is a snapshot.
- Treat process metadata as best-effort: a listener may be visible even when its owning process cannot be resolved.
- Handle access-denied, process-exited, and partial-query failures gracefully. Explain missing information instead of presenting guesses.
- Keep inspection local; do not transmit port or process information to a remote service.

### MVP acceptance

- A user can view the local listening-port snapshot.
- Each result displays the available port, protocol, address, process, and PID data.
- Search/filter and refresh work.
- Partial permission failures do not prevent the rest of the results from being shown.
- The feature performs no process termination or other destructive action.

## Polish

- Add protocol and operating-system coverage where justified by actual user demand.
- Improve diagnostics for unavailable or incomplete process metadata.
- Improve large-result performance and table usability.
- Add more filtering and optional export formats.
- Consider refresh cadence or additional sorting only when the UX remains clear and resource use is controlled.

## Explicit MVP exclusions

- **No process termination, killing, or restart controls.**
- No firewall rule creation or modification.
- No port blocking, forwarding, or network configuration changes.
- No remote host scanning or network discovery.
- No elevation prompt solely to obtain a more complete list; report permission limitations.

## Security and privacy notes

- Treat process names, paths, and command-line metadata (if ever added later) as untrusted local data.
- Do not collect or upload inspection results.
- Keep the MVP read-only and avoid privileged execution paths.
