# ADR-020: Cross-Platform Build, Code Signing, and Release Pipeline

## Status

Accepted

## Context

The boilerplate must produce installable, production-ready release packages for both Windows (`.msi`, `.exe`) and Android (`.apk`, `.aab`) without requiring manual developer compilation.

Key requirements:

1. Automated CI verification on all pull requests (format, lint, typecheck, unit tests, security tests).
2. Automated GitHub Release packaging triggered on SemVer git tags (`v*`).
3. Secure code signing via GitHub Actions secrets (Windows Authenticode and Android Keystore) to prevent OS malware warnings.
4. Zero secret or private key leakage into source control or release artifacts.

## Decision

**Current:** GitHub Actions workflows verify TypeScript/Rust quality and
unsigned native packages, and can attach those packages to a GitHub Release.

**Target production pipeline:**

1. `.github/workflows/ci.yml`: Full verification pass across Turborepo and Cargo.
2. `.github/workflows/release.yml`: Signed Windows MSI/EXE and Android APK/AAB
   attached to GitHub Releases with SHA256 checksums and updater metadata.

## Consequences

- **Pros**: Fully automated release cadence, reproducible builds, hardened secrets isolation.
- **Cons**: Requires configuring GitHub Actions secrets (`WINDOWS_CERTIFICATE`, `ANDROID_KEYSTORE_BASE64`) prior to production releases.

## Implementation status

The repository now verifies unsigned Windows and Android packages locally
and defines non-publishing and tagged release workflows with artifact
inspection. Production signing, updater metadata, and release secret
configuration remain incomplete. See [S-12](../specifications/S-12-release-and-distribution.md)
and the [status matrix](../verification/status.md).
