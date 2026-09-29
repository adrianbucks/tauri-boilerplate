# Build, Packaging & Release Guide

This guide covers building production installers for Windows, compiling Android APKs, managing GitHub Actions CI/CD pipelines, and signing release artifacts.

---

## 1. Local Production Packaging

### Windows Desktop (MSI / NSIS)

To build the production Windows executable and installer:

```bash
# Build frontend web assets first
pnpm turbo build

# Compile Tauri native executable and package installers
pnpm --filter @apps/demo tauri:build
```

Generated artifacts are located in:
```text
apps/demo/src-tauri/target/release/bundle/
├── msi/Demo_x.y.z_x64_en-US.msi
└── nsis/Demo_x.y.z_x64-setup.exe
```

### Android APK

To build the release Android package:

```bash
# Compile Android release APK
pnpm --filter @apps/demo tauri -- android build --apk
```

Generated artifacts are located in:
```text
apps/demo/src-tauri/gen/android/app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## 2. CI/CD Workflows (`.github/workflows/`)

The repository includes three automated GitHub Actions workflows:

### 1. `ci.yml` (Continuous Integration)
Runs on all PRs and pushes to `main`:
- Checks TypeScript formatting (`pnpm format:check`)
- Verifies type safety across all packages (`pnpm turbo typecheck`)
- Executes TypeScript unit, integration, security, and sync tests
- Verifies Rust formatting (`cargo fmt --check`)
- Runs Rust Clippy lints with `-D warnings`
- Executes all Rust native unit tests (`cargo test --workspace`)

### 2. `build.yml` (Nightly / Artifact Verification)
Builds production packages without publishing:
- Compiles Windows MSI and NSIS installers on a `windows-latest` runner
- Compiles Android APK on an Android SDK-enabled runner
- Computes and records SHA-256 checksums

### 3. `release.yml` (Release Publisher)
Triggered by pushing a version tag (e.g. `git push origin v1.2.0`):
- Builds production Windows installers and Android APKs
- Generates SHA-256 checksum files
- Publishes a formal GitHub Release attaching all binaries and checksums

---

## 3. Code Signing & Security Preparation

### Windows Authenticode Signing
For production Windows distribution, binaries must be signed with an Authenticode certificate:
- Configured in `tauri.conf.json` under `bundle.windows.certificateThumbprint` or via `signtool.exe`.
- Prevents Windows SmartScreen warnings and guarantees publisher identity.

### Android APK Signing
Production Android APKs must be signed using a release keystore:
- Set environment variables `ANDROID_KEYSTORE_PATH`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- Gradle automatically invokes `zipalign` and `apksigner` during release builds.

---

## 4. Release Checklist & Step-by-Step Procedure

1. **Verify Main Branch State**: Ensure all GitHub Actions in `ci.yml` are green.
2. **Version Bump**:
   ```bash
   pnpm version [patch|minor|major]
   ```
   Synchronize the version number across:
   - Root `package.json`
   - `apps/demo/src-tauri/tauri.conf.json`
   - `apps/demo/src-tauri/Cargo.toml`
3. **Update CHANGELOG.md**: Document changes under `Added`, `Changed`, `Fixed`, and `Security` sections.
4. **Commit & Tag**:
   ```bash
   git commit -am "chore: release v1.2.0"
   git tag v1.2.0
   git push origin main --tags
   ```
5. **Verify Release**: Monitor `release.yml` execution on GitHub Actions. Verify that the GitHub Release is published with attached binaries and SHA-256 checksums.
