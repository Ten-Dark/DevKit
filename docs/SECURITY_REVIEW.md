# DevKit Security Review

**Review date:** 2026-11-22
**Repository:** `Ten-Dark/DevKit`
**Branch:** `feat/runtime-mvp`
**Reviewed baseline:** `03dc0cfd344e5e4c764dd6b4a4d1866dc75b1e30`
**Target:** Windows x64 Runtime MVP

## Executive summary

The review found one high-priority IPC trust-boundary defect. It has been corrected in the current working tree: all registered IPC handlers now enforce the trusted top-level renderer origin, and the main window rejects untrusted navigation, redirects, and child windows.

A separate high-priority release gate remains open: Windows update packages are not code-signed and no `publisherName` is configured. The installed `electron-updater` implementation skips publisher verification when that value is absent. Until a signing identity is configured and verified, update integrity relies on the HTTPS/GitHub release trust chain rather than an independently verified publisher identity.

No production-readiness or security-certification claim is made. This is a source review plus automated validation, not an independent penetration test.

## Scope

Reviewed the relevant paths and controls in:

- Electron main/preload boundary, IPC registration, renderer origin validation, and BrowserWindow navigation
- Runtime IPC, service registration, process lifecycle, and persisted process ownership
- Native Windows process-control addon and Job Object lifecycle
- Filesystem authorization, symlink/junction handling, and authorized file reads/writes
- Workspace bootstrap, settings persistence, service registry, and recovery
- XMind archive selection/extraction and Project-to-Markdown filesystem traversal
- Auto-updater configuration and release packaging
- Production and development dependency audit results

## Findings

### SR-01 — IPC handlers did not authenticate the sender

**Status:** Fixed in working tree · **Severity:** P1

**Affected components:** `src/main/ipc-registry.ts`, `src/main/core/secure-ipc.ts`, `src/main/window.ts`

**Scenario:** A renderer navigates to an external document or an untrusted frame invokes an IPC channel.

**Evidence:** Before this review, only Runtime IPC used a sender-origin check. The general IPC registry forwarded calls directly to handlers. The main BrowserWindow did not block external navigation or child-window creation, while preload exposed filesystem, settings, XMind, and updater methods.

**Impact:** An untrusted document could potentially inherit the preload bridge and invoke privileged application IPC. The exact impact depended on the exposed channel and its own validation.

**Correction:** Added a shared renderer trust policy and enforced it centrally in `registerIpcHandler`. Calls are accepted only from the top-level renderer at the configured loopback development origin or the packaged renderer entry point. The main window now blocks untrusted `will-navigate` and `will-redirect` events and denies new windows.

**Regression coverage:** Added a registry test proving an external origin is rejected before the handler runs and the trusted development renderer remains accepted. Updated IPC integration fixtures to include an authenticated main-frame identity.

**Confidence:** Confirmed defect; correction covered by automated tests.

### SR-02 — Windows auto-updates have no publisher-signature verification

**Status:** Open release gate · **Severity:** P1

**Affected components:** `package.json`, `src/main/updater/app-update.yml`, Windows NSIS release configuration

**Evidence:** The Windows package has no configured signing certificate and no `publisherName`. The installed `electron-updater` version returns without verifying the downloaded installer when `publisherName` is absent. The current packaged build also reports that code signing is skipped.

**Impact:** HTTPS protects transport to the configured GitHub release provider, but the updater does not independently verify that an update was signed by the expected publisher. A compromised release account or release pipeline could therefore publish an installer without a publisher-identity check.

**Required remediation before production distribution:**

1. Obtain and protect a Windows code-signing certificate.
2. Configure signing in the release pipeline and configure the expected `publisherName`.
3. Add a release validation that fails when signing metadata is absent.
4. Verify that validly signed updates install and mismatched/unsigned updates are rejected.
5. Rebuild and test the actual NSIS installer and updater lifecycle.

If signing cannot be configured, automatic update installation should remain disabled for public production builds.

**Confidence:** Confirmed configuration gap; exploitation requires compromise of the trusted release path.

### SR-03 — Moderate development-tool dependency advisories remain

**Status:** Tracked · **Severity:** P2

**Affected dependency path:** nested `minimatch` versions under `@electron/universal` / `app-builder-lib` / `electron-builder`

**Evidence:** On 2026-11-22, `npm audit` reports six moderate findings in the development/build dependency tree. `npm audit --omit=dev` reports zero vulnerabilities in production dependencies.

**Impact:** The advisories affect build tooling rather than the packaged production dependency graph, but vulnerable build tooling still presents a developer-machine and supply-chain risk.

**Decision:** Do not run `npm audit fix --force`; npm proposes a breaking electron-builder downgrade. Continue with the targeted compatible remediation described in `docs/dependency-security-plan.md`, then validate the lockfile, tests, build, packaging, ASAR, and updater flow.

**Confidence:** Confirmed audit output.

## Controls verified

- All IPC handlers are centrally guarded by trusted top-level renderer identity.
- Runtime IPC retains its explicit sender validation and input validation.
- BrowserWindow uses context isolation, sandboxing, and disabled Node integration.
- External navigation, redirects, and new windows are blocked by default.
- Filesystem access resolves canonical paths and checks symlink/junction boundaries; authorized reads and writes verify file identity through open handles.
- XMind conversion requires a file selected through the application dialog and applies bounded archive extraction.
- Persisted process PIDs are diagnostic only; the Runtime does not reattach to or terminate a process from a previous application lifetime based only on a PID.
- Managed Windows processes are assigned to private Job Objects before their primary thread resumes; Job Object kill-on-close provides crash containment.
- Native lifecycle stress and packaged-ASAR crash-containment tests passed on the current Windows host.

## Validation evidence

Executed on Windows 11 Pro 23H2 x64, build 22631.6199:

| Check | Result |
|---|---:|
| `npm run check` | Passed: 397 tests / 35 files; TypeScript clean; ESLint 0 errors, 6 existing warnings |
| `npm run build` | Passed |
| Native Windows process-control tests | Passed |
| Native lifecycle stress | 100 cycles; handles 190 → 189 |
| Packaged-ASAR Electron lifecycle stress | 50 cycles; handles stable during the run |
| `npm run test:e2e:dev` | Passed: 2/2 |
| `npm run pack` | Passed: Windows x64 unpacked package |
| `npm run validate:asar` | Passed |
| `npm run test:e2e:packaged` | Passed: 4/4 |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` | 6 moderate development/build dependency findings |

The OS and parent Job Object compatibility matrix remains one-host evidence, not certification across Windows releases or all third-party Job Object policies.

## Remaining limitations and release gates

- **Code signing and updater publisher verification:** open; must be resolved before public production distribution.
- **Development dependency advisories:** six moderate findings remain; tracked in the dependency security plan.
- **Cross-version Windows testing:** Windows 10 and other Windows 11 builds remain unverified.
- **Graceful process shutdown:** not implemented; managed process termination is currently forceful.
- **Linux/macOS Runtime providers:** not implemented and intentionally deferred until after the Windows production milestone.

## Review disposition

The IPC trust-boundary defect is corrected and the current automated checks pass. The code-signing/updater verification gap and development dependency advisories remain open. Do not label this branch Production Ready until the release gates above are addressed and revalidated.
