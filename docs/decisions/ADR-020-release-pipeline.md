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

We configure **GitHub Actions workflows**:

1. `.github/workflows/ci.yml`: Full verification pass across Turborepo and Cargo.
2. `.github/workflows/release.yml`: Matrix build generating signed Windows MSI/EXE installers and Android APK packages attached directly to GitHub Releases with SHA256 checksums.

## Consequences

- **Pros**: Fully automated release cadence, reproducible builds, hardened secrets isolation.
- **Cons**: Requires configuring GitHub Actions secrets (`WINDOWS_CERTIFICATE`, `ANDROID_KEYSTORE_BASE64`) prior to production releases.
