# Windows code signing and updater publisher verification

**Project:** DevKit  
**Target:** Windows x64 NSIS releases  
**Status:** Pipeline and fail-closed runtime guard implemented; real certificate validation and signed-update E2E remain pending.

## GitHub Actions secrets

Add these three **repository Actions secrets** under GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `WINDOWS_SIGNING_CERT_BASE64` | Base64-encoded PFX containing the Windows code-signing certificate and private key |
| `WINDOWS_SIGNING_CERT_PASSWORD` | Password protecting that PFX |
| `WINDOWS_PUBLISHER_NAME` | Exact publisher simple name returned by the certificate |

Do not commit the PFX, its password, base64 contents, or exported private key to Git.

## Prepare the PFX secret

On a trusted Windows machine, export the certificate as a password-protected PFX with its private key. The certificate must:

- Be currently valid and chain to a trusted public certificate authority.
- Include the Code Signing EKU `1.3.6.1.5.5.7.3.3`.
- Contain the private key required to sign the installer and application binaries.

Convert the PFX to a single-line base64 value in PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('DevKit-CodeSigning.pfx'))
```

Store the output as `WINDOWS_SIGNING_CERT_BASE64`; store the PFX password separately.

Derive the exact publisher value from the same certificate:

```powershell
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
  'DevKit-CodeSigning.pfx',
  'PFX_PASSWORD'
)
$cert.GetNameInfo(
  [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
  $false
)
```

Store that exact output as `WINDOWS_PUBLISHER_NAME`. Do not substitute the organization name from memory or a marketing brand name.

## Release behavior

- Non-tag development and CI builds remain unsigned. Their packaged `app-update.yml` contains the `UNSIGNED_BUILD_UPDATES_DISABLED` sentinel.
- The application refuses update checks, downloads, installs, and periodic update scheduling when no trusted publisher is configured.
- A version tag matching `v*` sets `REQUIRE_WINDOWS_CODE_SIGNING=1`. The release package job fails before electron-builder unless all signing secrets are present and the PFX is valid.
- The workflow checks the PFX private key, validity period, Code Signing EKU, and exact publisher name before packaging.
- The release asset validation checks the installer Authenticode status is `Valid` and its signer matches `WINDOWS_PUBLISHER_NAME`.
- electron-updater has `verifyUpdateCodeSignature: true`; its packaged `app-update.yml` receives the expected publisher name for NSIS update verification.

## Remaining verification before closing SR-02

After the secrets are configured, run a real tag/release candidate and verify:

1. The installed application executable and NSIS installer have valid Authenticode signatures from the expected publisher.
2. A correctly signed update downloads and installs through electron-updater.
3. An unsigned update is rejected.
4. An update signed by a different publisher is rejected.
5. The installed application can complete the update and relaunch successfully.

Until these tests pass, keep SR-02 open and do not describe the updater as production-verified. A tag release intentionally fails closed when signing secrets are absent.
