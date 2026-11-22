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

**Status:** Mitigation implemented; external signing prerequisite and signed-update verification remain open · **Severity:** P1

**Affected components:** `package.json`, `src/main/updater/app-update.yml`, `src/main/updater/updater.ts`, Windows NSIS release workflow

**Original defect:** The installed `electron-updater` implementation skips downloaded-installer publisher verification when `publisherName` is absent. The Windows package had no signing certificate configured and the packaged build reported that code signing was skipped.

**Implemented mitigations:**

- `win.verifyUpdateCodeSignature` is explicitly enabled, and `win.signtoolOptions.publisherName` is set to the exact certificate publisher for release builds.
- The pre-dist release wrapper injects the publisher into electron-builder configuration and the bundled updater resource, then restores tracked configuration files after packaging. The generated `app-update.yml` is validated as a single-entry publisher list.
- Unsigned builds carry the `UNSIGNED_BUILD_UPDATES_DISABLED` publisher sentinel. The application fails closed: it will not check for updates, download, install, or schedule periodic update checks unless a real publisher name is present.
- Tag-based release builds set `REQUIRE_WINDOWS_CODE_SIGNING=1` and fail before packaging unless the PFX, password, and expected publisher secrets are present.
- The release workflow validates the PFX private key, validity period, Code Signing EKU, and exact publisher name before building.
- Release asset validation checks both the packaged application executable and NSIS installer Authenticode status and exact signer publisher, and confirms the packaged updater publisher list matches the expected publisher before GitHub publication.

**External prerequisite:** No real certificate or GitHub signing secrets are available in this development workspace. The current local Windows package is intentionally unsigned and its updater is disabled. The release workflow is configured to reject unsigned tag releases.

**Required before closing this finding:**

1. Obtain a trusted Windows code-signing certificate with a private key and Code Signing EKU.
2. Configure `WINDOWS_SIGNING_CERT_BASE64`, `WINDOWS_SIGNING_CERT_PASSWORD`, and `WINDOWS_PUBLISHER_NAME` as GitHub Actions repository secrets, following [Windows code signing](WINDOWS_CODE_SIGNING.md).
3. Build a signed release candidate and verify the installed executable and NSIS installer signatures.
4. Exercise the real updater: accept a correctly signed update and reject both unsigned and wrong-publisher updates.

**Confidence:** The fail-closed application guard and release pipeline gates are covered by source review and automated tests. Actual publisher verification remains unproven until a real certificate-backed release candidate passes the signed/unsigned/wrong-publisher update tests.


### SR-03 — Vulnerable minimatch versions in build dependencies

**Status:** Fixed with a scoped npm override · **Severity:** P2

**Affected dependency path:** `@electron/universal` / `app-builder-lib` / `electron-builder`

**Evidence:** The affected `minimatch` 9.x and 10.x instances were replaced with `11.0.9` using the root override `minimatch@>=7.0.0 <11.0.1`. Older `3.x` and `5.x` instances remain on their original compatible versions. `electron-builder` is pinned to the compatible `^26.18.1` range. A clean `npm ci` reproduced the resolved tree, and `npm audit` now reports zero vulnerabilities.

**Correction:** Added a version-qualified override so only package instances inside the advisory range are replaced. No global override, forced major downgrade, or unsupported package-tree substitution was used.

**Validation:** `npm ls minimatch --all` confirms the affected paths resolve to `11.0.9`; `npm audit` and `npm audit --omit=dev` both report zero vulnerabilities. The full test, build, native process-control, dev E2E, packaging, ASAR, and packaged E2E suites passed.

**Confidence:** Confirmed by clean install, resolved dependency tree, audit output, and application validation.

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

| `npm run check` | Passed: 400 tests / 35 files; TypeScript clean; ESLint 0 errors, 6 existing warnings |

Executed on Windows 11 Pro 23H2 x64, build 22631.6199:

| Check | Result |
|---|---:|
| `npm run check` | Passed: 400 tests / 35 files; TypeScript clean; ESLint 0 errors, 6 existing warnings |
| Unsigned packaged updater guard | Passed: sentinel disables update checks, downloads, installs, and periodic scheduling |
| Native Windows process-control tests | Passed |
| Native lifecycle stress | 100 cycles; handles 190 → 189 |
| Packaged-ASAR Electron lifecycle stress | 50 cycles; handles stable during the run |
| `npm run test:e2e:dev` | Passed: 2/2 |
| `npm run pack` | Passed: Windows x64 unpacked package |
| `npm run dist` | Passed: Windows x64 NSIS installer and updater metadata generated |
| `npm run validate:asar` | Passed; publisher sentinel verified in packaged updater config |
| `npm run test:e2e:packaged` | Passed: 4/4 against unpacked and installed NSIS builds |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` | 0 vulnerabilities |

The OS and parent Job Object compatibility matrix remains one-host evidence, not certification across Windows releases or all third-party Job Object policies.

## Remaining limitations and release gates

- **Code signing and updater publisher verification:** release pipeline fails closed without signing secrets; real certificate-backed signed/unsigned/wrong-publisher update tests remain open.
- **Cross-version Windows testing:** Windows 10 and other Windows 11 builds remain unverified.
- **Graceful process shutdown:** not implemented; managed process termination is currently forceful.
- **Linux/macOS Runtime providers:** not implemented and intentionally deferred until after the Windows production milestone.

## Review disposition

The IPC trust-boundary defect and development dependency advisories are corrected. Unsigned updater behavior now fails closed and the release workflow enforces code-signing prerequisites. The P1 publisher-verification gate remains open until a real certificate-backed release candidate passes positive and negative updater tests. Do not label this branch Production Ready before that validation.
