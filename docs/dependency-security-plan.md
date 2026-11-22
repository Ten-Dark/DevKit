# Dependency security remediation

**Completed:** 2026-11-22
**Project:** DevKit
**Node.js:** 22.23.5 / npm 10.9.9

## Result

The six moderate findings associated with vulnerable `minimatch` versions in the development/build dependency tree have been resolved. Both `npm audit` and `npm audit --omit=dev` report **0 vulnerabilities**.

## Dependency changes

- Updated `electron-builder` to `^26.18.1`; the lockfile resolves `electron-builder`, `app-builder-lib`, `dmg-builder`, and the related builder packages to `26.18.1`.
- Added a root, version-qualified npm override: `minimatch@>=7.0.0 <11.0.1` resolves to `11.0.9`.
- The override is limited to versions in the advisory range. Compatible legacy `minimatch` 3.x and 5.x dependencies are not replaced.
- No `npm audit fix --force`, major downgrade, or broad override was used.

## Verification

- Clean `npm ci`: passed.
- `npm ls minimatch --all`: vulnerable 9.x/10.x paths now resolve to `11.0.9`; legacy 3.x/5.x paths retain their expected versions.
- `npm audit`: 0 vulnerabilities.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm run check`: 397 tests / 35 files passed; TypeScript clean; ESLint 0 errors and 6 existing warnings.
- `npm run build`: passed, including native Windows process-control tests.
- Native lifecycle stress: 100 cycles, process handles 190 → 189.
- Packaged-ASAR Electron lifecycle stress: 50 cycles, process handles stable (702 → 702 and 709 → 709 across runs).
- `npm run test:e2e:dev`: 2/2 passed.
- `npm run pack`: passed with electron-builder 26.18.1, Windows x64.
- `npm run validate:asar`: passed.
- `npm run test:e2e:packaged`: 4/4 passed, including packaged main-process crash containment.
- `git diff --check`: passed.

## Advisory reference

- GHSA-g3hv-75wg-m249 — minimatch globparts amplification; patched in `11.0.1` and later. DevKit resolves affected dependency paths to `11.0.9`.

## Follow-up

No open remediation remains for this advisory set. Re-run `npm audit` after future dependency updates and remove or revise the override only when all upstream dependency ranges safely require a patched version.
