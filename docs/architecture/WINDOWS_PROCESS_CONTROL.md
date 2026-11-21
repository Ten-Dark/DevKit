# Windows Process Control — native provider

**Status:** native Windows x64 provider implemented; production validation is in progress.

The implementation uses a narrowly scoped C++ Node-API addon. It creates each service process suspended, assigns it to a private Windows Job Object before resuming its primary thread, and retains native process and Job Object handles for the managed lifetime.

## Responsibility boundaries

- `ProcessManager` owns shared lifecycle orchestration, persistence, dependency policy, readiness, rollback and runtime events.
- `WindowsProcessControlProvider` owns Windows process creation, native identity, Job Object containment, force termination and native handle lifetime.
- Domain contracts and renderer-facing APIs remain OS-independent.
- Linux and macOS providers are not implemented in this MVP.

## Native implementation

Source:
- `native/windows-process-control/windows_process_control.cc`
- `native/windows-process-control/binding.gyp`

Build:
- `scripts/build-windows-native.cjs`
- Electron headers are selected for the Electron version declared in `package.json` (currently **45.4.1**).
- The addon is copied to `dist-electron/main/native/windows_process_control.node`.
- Electron Builder unpacks native `.node` binaries from ASAR.
- The native test host `nested_job_host.exe` is compiled separately and remains under the ignored native build directory; it is not included in application packages.

Build prerequisites: Visual Studio Build Tools 2022 with the MSVC x64 C++ workload, a Windows 10/11 SDK and Python supported by the installed `node-gyp`. The build script locates Visual Studio through `vswhere`.

The addon uses raw Node-API and adds no runtime package dependency. Its native boundary exposes only process creation, Job Object state, group termination, root exit code and handle cleanup.

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

## Ownership, termination and recovery

- The native process handle and Job Object handle are held in memory for the managed instance lifetime.
- The persisted PID is diagnostic metadata only. A PID from a previous app lifetime is never reopened, reattached to or terminated.
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
- `gracefulShutdown` remains **false**. Job Object termination is forceful, not graceful.
- A future graceful protocol must be explicitly opted into by a service, bounded by a timeout and validated independently. Until then, stop uses the Job Object termination path.

## Validation

Automated coverage currently includes:
- Provider capability declarations and cross-provider handle rejection.
- ProcessManager orchestration tests using a test-only ChildProcess provider; these do not load the production native addon.
- Native integration test that starts a parent and descendant immediately, terminates the Job Object, and verifies both processes exit.
- Native integration test that closes the Job Object handle and verifies kill-on-close terminates the process.
- Crash-containment test that abruptly terminates the process owning a Job Object handle and verifies that Windows kill-on-close terminates the managed child.
- Nested Job Object test that launches the provider host inside a parent Job Object, verifies compatible nested assignment, and confirms an active-process limit causes fail-closed startup without executing the service.
- Argument/environment boundary tests, including Unicode, quotes, trailing backslashes, Windows command/environment size limits and exit code `259` (`STILL_ACTIVE`) disambiguation.
- Packaged-ASAR Electron smoke test that confirms `app.getAppPath()` resolves to `app.asar`, loads the native addon from adjacent `app.asar.unpacked`, and starts/stops a managed process.
- Packaged-ASAR Electron main-process termination test that forcefully terminates the Electron process while it owns a Job Object handle and verifies kill-on-close terminates the managed child.
- Native lifecycle stress test: 100 consecutive start/force-stop/confirm-empty/close cycles; `GetProcessHandleCount` returns to baseline (190 -> 189 on the validation host).
- Packaged-ASAR Electron provider stress test: 15 warm-up cycles establish a stable Electron baseline, followed by 50 measured start/force-stop/exit cycles; native handle count remains stable (704 -> 704 on the final validation run). Intermediate samples are recorded to distinguish one-time runtime initialization from monotonic handle growth.
- TypeScript build, Electron packaging and packaged application E2E checks.
```sh
npm run build
npm run test:native:windows
```

Remaining production gates:
- Complete follow-up adversarial boundary fuzzing and broader Windows/parent-Job compatibility testing.

- Validate longer-duration and higher-volume start/stop/restart workloads under handle-leak instrumentation; current automated coverage is 100 native and 50 Electron-provider cycles.

- Validate the crash-containment path with the final electron-builder-produced DevKit executable and installed application, not only the synthetic ASAR fixture.

## Security review — 2026-11-21

The first native-boundary security review pass is complete. Two defensive corrections were made:

- Environment variable names are now rejected when they contain an embedded NUL, in addition to the existing empty-name and equals-sign checks. This prevents malformed keys from being truncated or ambiguously compared while constructing the Windows environment block.
- `TerminateJobObject` is now called only after a successful `QueryInformationJobObject`. Query failures are surfaced as Win32 errors instead of being silently treated as a non-empty job.

Native integration coverage now explicitly rejects environment keys containing NUL or `=`, and values containing NUL. The tests execute against the compiled Windows x64 addon.

### Reviewed boundaries

- Process image path and working directory are absolute, canonicalized with `realpath`, and checked as a file/directory by `ProcessManager` before reaching the native provider.
- The native boundary independently rejects empty paths, embedded NULs, malformed UTF-8 conversions, more than 128 arguments, command lines beyond the Windows limit (including an oversized quoted executable path when no arguments are supplied), more than 512 environment entries, malformed environment names/values, and oversized environment blocks.
- Arguments are passed as a correctly quoted Windows command line with `CreateProcessW` receiving the executable path separately as `lpApplicationName`.
- Environment entries are case-insensitively sorted before building the Unicode environment block.
- Process creation disables handle inheritance, keeps the primary thread suspended until Job Object assignment succeeds, and has no PID-based or process-name fallback.
- Native N-API callbacks are wrapped in exception guards so C++ exceptions are translated into JavaScript errors rather than crossing the Node-API boundary.
- A `ManagedProcess` owner is allocated before acquiring OS handles. Job and process handles are transferred into RAII ownership immediately after acquisition, so allocation or later N-API failures cannot strand a resumed process outside the owner's kill-on-close lifetime.
- Native object creation, wrapping, PID exposure and method registration now check N-API return statuses and fail with explicit errors.
- The environment boundary rejects arrays and non-object values; argument/environment type failures and 250 generated malformed-NUL argument cases are covered by native integration tests.
- The provider refuses handles from other provider instances and does not reattach to persisted PIDs after application restart.

### Trust boundary and limitations

Job Objects provide lifecycle containment, not a security sandbox. Managed executables run with the same Windows user token and privileges as DevKit; they are not isolated from the user's files, credentials, network access, or other same-user resources. Service definitions and executable selection must therefore be treated as user-trusted configuration. Do not describe this provider as a privilege boundary or hostile-code execution environment.

This review pass does not certify every Windows version, parent Job Object policy, installed-package crash path, or long-duration workload. Remaining production gates above still apply. The review also does not claim a formal third-party security audit.
