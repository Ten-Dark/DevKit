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
- TypeScript build, Electron packaging and packaged application E2E checks.

The native integration and Electron-provider smoke tests run automatically through the `postbuild` lifecycle hook. They can also be rerun independently:
```sh
npm run build
npm run test:native:windows
```

Remaining production gates:
- Verify behavior across the supported Windows version matrix and additional real-world parent Job Object configurations; current nested coverage runs on the development Windows host.
- Repeat start/stop/restart cycles under handle-leak instrumentation.
- Validate the crash-containment path with the final electron-builder-produced DevKit executable and installed application, not only the synthetic ASAR fixture.
- Complete security review of native input validation, handle lifetime and process environment construction.

Do not describe the Windows provider as fully production-certified until these gates and packaged E2E checks pass.
