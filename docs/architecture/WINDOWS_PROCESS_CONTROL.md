# Windows Process Control — native provider

**Status:** native Windows x64 provider implemented; production validation is in progress.

The implementation uses a narrowly scoped C++ Node-API addon. Runtime service processes are created suspended, assigned to a private Windows Job Object before their primary thread resumes, and retained through native process and Job Object handles. MCP stdio uses a separate trusted bootstrap protocol that attaches the bootstrap to a Job Object before it receives the configured command.

## Responsibility boundaries

- `ProcessManager` owns shared lifecycle orchestration, persistence, dependency policy, readiness, rollback and runtime events.
- `WindowsProcessControlProvider` owns Windows process creation, direct-child attachment, native identity, Job Object containment, force termination and native handle lifetime.
- Domain contracts and renderer-facing APIs remain OS-independent.
- Linux and macOS providers are not implemented in this MVP.

## Native implementation

Source:
- `native/windows-process-control/windows_process_control.cc`
- `native/windows-process-control/binding.gyp`

Build:
- `scripts/build-windows-native.cjs`
- `scripts/build-stdio-bootstrap.cjs`
- Electron headers are selected for the Electron version declared in `package.json` (currently **45.4.1**).
- The addon is copied to `dist-electron/main/native/windows_process_control.node`.
- Electron Builder unpacks native `.node` binaries, the CommonJS MCP stdio bootstrap, and its cross-spawn runtime dependencies from ASAR.
- The native test host `nested_job_host.exe` is compiled separately and remains under the ignored native build directory; it is not included in application packages.

Build prerequisites: Visual Studio Build Tools 2022 with the MSVC x64 C++ workload, a Windows 10/11 SDK and Python supported by the installed `node-gyp`. The build script locates Visual Studio through `vswhere`.

The addon uses raw Node-API. Its native boundary exposes process creation, direct-child attachment, Job Object state, group termination, root exit code and handle cleanup. The MCP bootstrap is compiled to CommonJS and shipped with its explicit cross-spawn runtime dependency.

### Safe process creation sequence

1. Create a private, non-inheritable Job Object.
2. Configure `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
3. Call `CreateProcessW` with `CREATE_SUSPENDED`, `CREATE_UNICODE_ENVIRONMENT` and `CREATE_NO_WINDOW`; handle inheritance is disabled.
4. Assign the suspended process to the Job Object with `AssignProcessToJobObject`.
5. If assignment fails, terminate the still-suspended process, wait for it and close every native handle. Do not resume it.
6. Resume the primary thread only after successful assignment.
7. Keep both process and Job Object handles inside a native object owned by the JavaScript wrapper.

This removes the post-spawn assignment race: the service's primary thread cannot execute application code or create descendants before Job Object membership is established.

The provider does not enable breakaway. Normal descendants created through `CreateProcess` remain members of the managed Job Object. If Windows rejects Job Object assignment (including incompatible host/nested-job restrictions), startup fails closed; there is no fallback to `taskkill`, process-name matching or PID-only termination.

## MCP stdio bootstrap and ownership

The MCP SDK normally spawns stdio servers itself, outside Runtime's native process provider. DevKit therefore uses ManagedStdioClientTransport on Windows instead of allowing the SDK to launch the configured MCP command directly:

1. The SDK starts a DevKit-owned CommonJS bootstrap process with piped stdio. The bootstrap connects to a per-connection random Windows named pipe and sends READY; it does not execute the configured command yet.
2. The main process obtains the bootstrap PID from the SDK child reference. Native attachManagedProcess verifies through a Toolhelp process snapshot that the PID is a direct child of the current DevKit process, opens that process, creates a private kill-on-close Job Object, and assigns the bootstrap to it.
3. Only after successful attachment does the main process send the command, argument array and working directory over the named pipe. If attachment fails, the command is never launched.
4. The bootstrap launches the configured command through cross-spawn with shell disabled and inherited stdio. Any cmd.exe, npm/npx wrapper, MCP server and further descendants inherit the Job Object. The internal ELECTRON_RUN_AS_NODE flag is removed before the configured command receives its environment.
5. The main process retains the Job Object handle. Disconnect waits for the SDK bootstrap to close and then force-terminates the group if it has not emptied. If DevKit crashes, Windows closes the owning Job Object handle and kill-on-close terminates the bootstrap and all descendants.

The bootstrap is compiled to CommonJS and unpacked from ASAR together with its cross-spawn dependencies. ASAR validation checks every required runtime file. The renderer cannot choose a PID or invoke the native attachment API; attachment receives only the PID of the SDK-created bootstrap after the named-pipe readiness handshake.

## Ownership, termination and recovery

- The native process handle and Job Object handle are held in memory for the managed instance lifetime.
- The persisted PID is diagnostic metadata only. A PID from a previous app lifetime is never reopened, reattached to or terminated. MCP attachment is limited to the live, direct-child bootstrap PID created by the current process after its readiness handshake.
- `TerminateJobObject` is used for forceful stop of the complete managed group.
- Completion is not reported until Job Object accounting confirms `ActiveProcesses === 0`.
- Closing the final Job Object handle enforces kill-on-close. The native wrapper closes the job handle on confirmed group exit and from its finalizer; process termination or crash also causes Windows to close the process's handles.
- Handle ownership is scoped to the provider instance. A handle created by another provider instance is rejected.

Microsoft references:
- [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Nested Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs)
- [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- [TerminateJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject)
- [SetInformationJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-setinformationjobobject)

## Shutdown semantics

- `processTreeManagement` is enabled because the root process is assigned before it can execute and the provider waits for the Job Object to become empty.
- `ownershipVerification` is `native-process-handle`; no PID-based recovery path exists.
- Runtime provider `gracefulShutdown` remains **false**; Runtime service stop uses Job Object termination.
- MCP stdio has a separate bounded EOF-based close attempt through the SDK transport. If the bootstrap and its Job Object group do not exit within the cleanup window, the transport force-terminates the Job Object. This does not change the Runtime provider capability.

## Validation

Automated coverage currently includes:
- Provider capability declarations and cross-provider handle rejection.
- ProcessManager orchestration tests using a test-only ChildProcess provider; these do not load the production native addon.
- Native integration test that starts a parent and descendant immediately, terminates the Job Object, and verifies both processes exit.
- Native attach-before-launch test verifies that a direct child bootstrap can be assigned before it creates descendants and that an unrelated PID is rejected.
- Native Windows command-wrapper integration test starts cmd.exe -> batch wrapper -> Node launcher -> long-lived Node server, terminates the Job Object and verifies all three processes exit. This models npm/npx .cmd launchers without a network package install.
- Dev and packaged MCP E2E start a real stdio fixture that spawns a descendant; after disconnect both the configured MCP command PID and its descendant PID must exit.
- Native integration test that closes the Job Object handle and verifies kill-on-close terminates the process.
- Crash-containment test that abruptly terminates the process owning a Job Object handle and verifies that Windows kill-on-close terminates the managed child.
- Parent-Job compatibility matrix: (1) ordinary nested assignment succeeds; (2) a parent with `JOB_OBJECT_LIMIT_BREAKAWAY_OK` still contains the provider child because Runtime does not request `CREATE_BREAKAWAY_FROM_JOB`; (3) `JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1` rejects the Runtime-managed child before it executes. The native host remains outside the parent Job Object, and the Node.js provider test is its sole allowed member, so the constrained case exercises the provider rather than blocking the test harness.
- Argument/environment boundary tests, including Unicode, quotes, trailing backslashes, Windows command/environment size limits and exit code `259` (`STILL_ACTIVE`) disambiguation.
- Packaged-ASAR Electron smoke test confirms app.getAppPath resolves to app.asar, loads the native addon and CommonJS MCP bootstrap from adjacent app.asar.unpacked, and starts/stops managed processes.
- Packaged-ASAR Electron main-process termination test that forcefully terminates the Electron process while it owns a Job Object handle and verifies kill-on-close terminates the managed child.
- Native lifecycle stress defaults to 100 consecutive start/force-stop/confirm-empty/close cycles; `DEVKIT_NATIVE_STRESS_CYCLES` can raise the run up to 5,000 cycles. Maximum configured validation passed 5,000 cycles; `GetProcessHandleCount` returned to baseline (182 -> 181 on the validation host).
- Packaged-ASAR Electron provider stress defaults to 50 measured cycles after 15 warm-ups; `DEVKIT_ELECTRON_STRESS_CYCLES` can raise the run up to 2,000 cycles. Maximum configured validation passed 2,000 measured cycles with all 10-cycle samples stable at 702 handles and a settled count of 704 (+2, within the +3 tolerance).
- TypeScript build, Electron packaging and packaged application E2E checks.
- Installed NSIS crash-containment E2E: install the generated per-user package into an isolated directory, start a managed service through the real Runtime IPC, verify explicit stop/restart, terminate the actual Electron main-process PID and confirm the managed child heartbeat stops. Validated with Dev Toolbox 1.0.4 on Windows 11 Pro 23H2 x64 (build 22631.6199); Playwright's launcher PID is deliberately not treated as the Electron main-process PID.
- Compatibility matrix host: Windows 11 Pro 23H2 x64 (build 22631.6199). Ordinary nested Job Objects, a parent allowing explicit breakaway without the provider requesting it, and a parent active-process limit that rejects the managed child all passed. This is one-host evidence, not certification across Windows releases or third-party parent-job policies.
```sh
npm run build
npm run test:native:windows
```

Two-hour native Runtime soak: **PASS on 2026-11-24**. The supervised run completed 7,201 seconds and 1,779,051 lifecycle cycles across 17,961 batches/samples. Process handles remained stable at 172 (baseline/final/minimum/maximum: 172/172/172/172). The run emitted `RUNTIME_SOAK_PASS`; supervisor status was `COMPLETED`, exit code was 0, crash event count was 0, and stderr was empty. The final status and exit-code artifacts were inspected independently.

Remaining production gates:
- Run the installed NSIS crash-containment check across each supported Windows version and host parent-Job policy. Current evidence covers one Windows 11 x64 validation host.
- Complete broader Windows-version, recovery, update/rollback and security validation before declaring the Runtime production-ready or expanding platform support.
- Scheduled-task wrapper result discrepancy fixed: the supervisor now passes `-Confirm:$false` when unregistering the watchdog task. A 40-second supervised smoke run confirmed `COMPLETED`, supervisor exit code 0, `exit-code.txt = 0`, Task Scheduler `LastTaskResult = 0`, event 201 return code 0, empty stderr, and stable process handles (172 -> 172).

## Security review — 2026-11-21

The native-boundary security review has been extended with additional resource-boundary checks:

- Environment block size is now calculated from the normalized, case-insensitive environment map before allocating the contiguous UTF-16 block. The builder rejects oversized blocks before duplicating large values into a second allocation.
- Executable paths and individual arguments are rejected before command-line quoting when their raw lengths already exceed the Windows command-line budget. The fully quoted command line is still checked after each argument is appended.
- Integration tests now cover 513 environment entries, aggregate environment overflow, oversized executable paths, oversized arguments, the 128-argument limit, non-object environment input, and embedded-NUL working directories.
- Existing generated malformed-NUL argument coverage remains at 250 cases, alongside the process-tree, nested-job, owner-crash and handle-stress tests.

### Reviewed boundaries

- Process image path and working directory are absolute, canonicalized with `realpath`, and checked as a file/directory by `ProcessManager` before reaching the native provider.
- The native boundary independently rejects empty paths, embedded NULs, malformed UTF-8 conversions, more than 128 arguments, oversized executable paths and arguments before quoting, command lines beyond the Windows limit, more than 512 environment entries, malformed environment names/values, and oversized normalized environment blocks before contiguous block allocation.
- Arguments are passed as a correctly quoted Windows command line with `CreateProcessW` receiving the executable path separately as `lpApplicationName`.
- Environment entries are case-insensitively sorted before building the Unicode environment block.
- Process creation disables handle inheritance, keeps the primary thread suspended until Job Object assignment succeeds, and has no PID-based or process-name fallback.
- Native N-API callbacks are wrapped in exception guards so C++ exceptions are translated into JavaScript errors rather than crossing the Node-API boundary.
- A `ManagedProcess` owner is allocated before acquiring OS handles. Job and process handles are transferred into RAII ownership immediately after acquisition, so allocation or later N-API failures cannot strand a resumed process outside the owner's kill-on-close lifetime.
- Native object creation, wrapping, PID exposure and method registration now check N-API return statuses and fail with explicit errors.
- The environment boundary rejects arrays and non-object values; argument/environment type failures, 250 generated malformed-NUL argument cases, environment entry-count overflow, aggregate environment-size overflow, executable/argument length overflow, and embedded-NUL working directories are covered by native integration tests.
- The provider refuses handles from other provider instances and does not reattach to persisted PIDs after application restart.

### Trust boundary and limitations

Job Objects provide lifecycle containment, not a security sandbox. Managed executables run with the same Windows user token and privileges as DevKit; they are not isolated from the user's files, credentials, network access, or other same-user resources. Service definitions and executable selection must therefore be treated as user-trusted configuration. Do not describe this provider as a privilege boundary or hostile-code execution environment.

The installed NSIS crash-containment path has been exercised on the current Windows 11 x64 validation host. This review does not certify every Windows version, parent Job Object policy, or long-duration workload. Remaining production gates above still apply. The review also does not claim a formal third-party security audit.

## Security review follow-up — 2026-11-22

- The native addon now checks N-API value creation and export-registration results in process-state queries, exit-code reporting, handle-count reporting, close handling, and module initialization. Allocation or registration failures return explicit JavaScript errors rather than potentially returning an uninitialized `napi_value`.
- The `ResumeThread` result is now required to equal exactly `1`, the expected initial suspend count. Any other result fails startup, requests Job Object termination, closes the final Job Object handle as the kill-on-close fallback, and records termination, wait, and thread-handle cleanup outcomes in the error.
- The `AssignProcessToJobObject` failure path now checks whether termination of the still-suspended process was accepted and whether the process reached a signaled state. It also checks closure of the suspended primary-thread handle. Cleanup uncertainty is surfaced together with the original assignment error; the primary thread is never resumed on this path.
- Validation on 2026-11-22: `npm run check` passed (423 tests / 39 files, TypeScript clean, ESLint 0 errors / 6 warnings); `npm run build` passed with the MSVC Electron 45.4.1 x64 addon; maximum configured native stress passed 5,000 start/stop cycles with handles 182 -> 181; maximum configured packaged-ASAR Electron stress passed 2,000 cycles with all 10-cycle samples stable at 702 handles and settled count 704 (+2, within the +3 tolerance); owner-crash containment and all three parent-Job scenarios passed; development E2E passed 2/2; unpacked packaged E2E passed 4/4; installed NSIS E2E passed 4/4 against an isolated install of the newly built 1.0.3 installer, including managed-service crash containment; `npm run validate:asar` passed; `npm audit` and `npm audit --omit=dev` both reported zero vulnerabilities.
- Direct fault injection was added using a second native build target, `windows_process_control_fault_test`, compiled with `DEVKIT_NATIVE_FAULT_INJECTION`. It can inject a one-shot `AssignProcessToJobObject` access-denied failure after `CreateProcessW` succeeds, and `ResumeThread` results of `0`, `2`, and `DWORD(-1)`. The fault-control export exists only in this test target; the production `windows_process_control.node` is compiled without the define and is asserted not to expose `setNativeFaultMode`.
- The new `scripts/test-windows-native-fault-injection.cjs` suite primes each failure path before taking its handle-count baseline, then repeats all four scenarios five times each (20 measured injected failures). Every run asserts that startup throws and the child does not survive long enough to write a delayed execution marker. The `ResumeThread`-zero injection now performs a real first resume followed by a second `ResumeThread` call that returns zero, accurately modeling an already-running primary thread; the test verifies that Job Object termination prevents the delayed marker from firing. Other injected failures leave the primary thread suspended. A one-time +1 process-handle increase was observed during initial error-path warm-up; its source is not attributed to an individual native handle. After priming, the measured suite settled from 176 to 177 in the build run (and 177 to 177 in a standalone rerun), within a strict +1 maximum allowance. Repeated execution showed no per-failure handle growth. This directly exercises both cleanup branches; the constrained parent-Job test remains a distinct CreateProcessW rejection case.
- Latest regression rerun on 2026-11-22: `npm run check` passed (423 tests / 39 files, TypeScript clean, ESLint 0 errors / 6 warnings) with `APPDATA` supplied for the MCP integration tests; `npm run build` passed and ran the native integration suite; maximum native stress passed 5,000 cycles (handles 185 -> 184); fault injection passed 20 measured failures after path priming (handles 177 -> 177); maximum packaged-ASAR Electron stress passed 2,000 cycles (handles 712 -> 714, with samples stable at 714 from cycle 1,170 through cycle 2,000); development E2E passed 2/2; unpacked packaged E2E passed 4/4 including managed-service crash containment; ASAR validation passed; `npm audit --omit=dev` reported zero vulnerabilities.
- The provider remains lifecycle containment, not a sandbox. Validation still covers one Windows 11 Pro 23H2 x64 host only.
