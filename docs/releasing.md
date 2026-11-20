# Release workflow

## Release model

DevKit distributes Windows NSIS installers through GitHub Releases. The packaged application uses electron-updater with the GitHub provider configured for Ten-Dark/DevKit and the latest channel.

A local package build is not a release. No public release is created by npm run package or npm run release:check.

## Versioning

Use SemVer. The version in package.json must match the version in package-lock.json and the v-prefixed Git tag. The release job validates this before invoking the GitHub Release action.

To update the version without automatically creating a Git tag, use the supported Node.js 22 environment:

```powershell
npm version patch --no-git-tag-version
```

For minor or major releases, use the corresponding npm version command. Review package.json and package-lock.json, run npm run check and npm run package, then commit the version change through the normal review process.

## Local release verification

```powershell
npm run release:check
```

This runs lint, TypeScript, unit/component tests, development E2E, production build, NSIS packaging, update metadata generation, ASAR validation and packaged E2E. It does not publish or create tags.

## GitHub Actions release path

A release workflow is triggered by a tag matching v*. The workflow must complete its required checks before the release job can start:

- Unit tests.
- TypeScript check.
- Integration tests.
- Development Electron E2E.
- Production build.
- Production package.
- ASAR and updater configuration validation.
- Packaged Electron E2E.
- NSIS installer E2E.

The release job depends on ASAR validation, packaged E2E and NSIS installer E2E. It is skipped for ordinary branch pushes and pull requests. contents: write is scoped to the release job; other jobs receive contents: read. Checkout credentials are not persisted.

## Release assets

The package stage creates:

- Local build output uses Dev Toolbox Setup X.Y.Z.exe and its .blockmap.
- GitHub Release upload normalizes spaces to dots (Dev.Toolbox.Setup.X.Y.Z.exe); latest.yml must use that exact asset name so electron-updater resolves the correct download URL.
- latest.yml — electron-updater channel metadata.

scripts/generate-update-metadata.mjs computes the installer SHA-512 digest, installer size and blockmap size and writes latest.yml atomically. The release artifact includes all three files. The release job validates that they exist and that the tag version equals package.json before publication.

resources/app-update.yml is copied from src/main/updater/app-update.yml into the packaged resources directory. ASAR validation checks that this external updater configuration matches the provider, owner, repository and channel configured in package.json.

Do not publish a release if latest.yml, the installer, the blockmap or resources/app-update.yml is missing or inconsistent.

## NSIS updater E2E

The dedicated installed v1-to-v2 updater E2E uses an isolated local feed and requires an older NSIS installer plus a newer package feed. See docs/development.md for its environment variables. This local test does not create a public release.

## Manual publication controls

The maintenance scripts do not publish a release. Public publication occurs only through the tag-triggered GitHub Actions release job after all required jobs succeed. Never use a test tag or a local test feed to publish publicly.\n