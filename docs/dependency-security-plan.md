# Dependency security status and remediation plan

**Audit date:** 2026-11-20
**Project:** DevKi
**Node.js:** 22.23.5 / npm 10.9.9

## Current status

A fresh `npm audit` reports **6 moderate advisories**. All six are in the development/build dependency tree and resolve through nested `minimatch` packages pulled in by `electron-builder` / `app-builder-lib` / `@electron/universal`.

`npm audit --omit=dev` reports **0 vulnerabilities**. No vulnerable production dependency path is currently reported.

The audit's forced automatic remediation proposes downgrading `electron-builder` to 24.13.3, which is a breaking and unsuitable downgrade from the project's current 26.18.0. Do not run `npm audit fix --force`.

## Risk interpretation

The remaining advisories affect build-time tooling rather than the packaged application's production dependency graph. They still matter: compromised or vulnerable build tooling can affect generated artifacts and developer machines. The clean production-only audit is useful evidence, but it is not a reason to ignore the development dependency findings.

## Remediation approach

1. Keep the current working dependency graph stable while the consolidation changes are reviewed.
2. Investigate patched `minimatch` resolutions compatible with `electron-builder` 26.18.0 and its supported `app-builder-lib` tree.
3. Prefer a targeted compatible override or upstream patch only after checking the full dependency tree, package integrity, and builder compatibility. Do not force a major downgrade.
4. Validate the candidate with `npm ls minimatch`, `npm audit`, `npm audit --omit=dev`, all tests, production build, NSIS packaging, ASAR validation, and updater E2E.
5. Record the exact resolved versions and advisory references when the remediation is implemented.

## Current decision

The dependency lockfile was updated as part of the DevKit consolidation and toolchain alignment. The current audit is down from the earlier 22 findings (3 critical, 12 high, 7 moderate) to 6 moderate findings. No forced audit fix was applied. Production dependencies remain at zero reported vulnerabilities.\n