# 15 — Build, Release and Versioning

---

## GitHub Actions pipeline overview

Three workflow files handle CI and release:

```
.github/workflows/
├── ci.yml           ← Triggered on every push / PR
├── build.yml        ← Triggered on push to main (full Tauri build)
└── release.yml      ← Triggered on version tag push (v*)
```

---

## `ci.yml` — Continuous integration

Runs on every push and pull request. Must pass before merge.

```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm turbo typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm turbo test # Vitest unit tests
      - run: cargo test --workspace # Rust tests

  integration-test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:integration

  security-test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:security

  sync-test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:sync
```

Turborepo caching reduces rebuild time for unaffected packages.

---

## `build.yml` — Tauri build (full binaries)

Runs on push to `main` to verify that Tauri builds succeed. Does not sign or publish.

```yaml
name: Build
on:
  push:
    branches: [main]

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - uses: tauri-apps/tauri-action@v0
        with:
          projectPath: apps/demo
          args: --target x86_64-pc-windows-msvc

  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi
      - uses: android-actions/setup-android@v3
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - uses: tauri-apps/tauri-action@v0
        with:
          projectPath: apps/demo
          args: android build
```

---

## `release.yml` — Full release pipeline

Triggered when a version tag matching `v*` is pushed.

```yaml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  release-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile

      - name: Build and sign Windows installer
        uses: tauri-apps/tauri-action@v0
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
          WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
        with:
          projectPath: apps/demo
          tagName: ${{ github.ref_name }}
          releaseName: "Tauri Boilerplate Demo v${{ github.ref_name }}"
          releaseBody: "See CHANGELOG.md for release notes"
          args: --target x86_64-pc-windows-msvc

  release-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi
      - uses: android-actions/setup-android@v3
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile

      - name: Build and sign Android APK
        uses: tauri-apps/tauri-action@v0
        env:
          ANDROID_KEYSTORE: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        with:
          projectPath: apps/demo
          tagName: ${{ github.ref_name }}
          args: android build --apk
```

---

## Release workflow (human steps)

```bash
# 1. Ensure all tests pass on main
git checkout main
git pull

# 2. Update version in package.json (root)
pnpm version minor  # or patch, or major

# 3. Update CHANGELOG.md
# Add entry for the new version with date, Added/Changed/Fixed/Security sections

# 4. Commit version bump and changelog
git add .
git commit -m "chore: release v1.2.0"

# 5. Tag the release
git tag v1.2.0

# 6. Push (triggers release pipeline)
git push origin main --tags
```

GitHub Actions automatically:

- Builds Windows installer (signed)
- Builds Android APK (signed)
- Creates a GitHub Release with the tag
- Attaches all artefacts to the release
- Generates SHA256 checksums

---

## Versioning

### Root package version

```json
// package.json (root)
{
  "name": "tauri-boilerplate",
  "version": "0.1.0"
}
```

This version represents the **platform version** — the boilerplate itself. It follows semver:

| Bump    | When                                                                                       |
| ------- | ------------------------------------------------------------------------------------------ |
| `PATCH` | Bug fix, dependency update, documentation update, security patch                           |
| `MINOR` | New platform package capability, new platform feature, new ADR                             |
| `MAJOR` | Breaking change to a platform package public API, Tauri command contract, or sync protocol |

### Version co-ordination

```
Root package.json version    ← Platform release version (git tag)
apps/demo/package.json       ← Must match root for demo releases
packages/*/package.json      ← Must match root (all platform packages move together)
features/*/package.json      ← May version independently (own semver)
```

Platform packages use a lockstep versioning model — all platform packages release together at the same version. This simplifies compatibility tracking for downstream developers.

---

## CHANGELOG.md format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) strictly.

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] — 2026-10-15

### Added

- packages/hardware: Android barcode scanning via Tauri barcode-scanner plugin
- features/identity-admin: Device revocation from admin panel

### Changed

- packages/sync: SyncState machine adds EXPIRED terminal state

### Security

- crates/sync-core: Handshake now validates organisationId before data-scope check

## [1.1.0] — 2026-09-20

### Added

- packages/import-export: XLSX export with SheetJS CE
  ...
```

Security section entries are **mandatory** whenever a security-relevant change is made.

---

## Secrets management

### GitHub Actions Secrets (required before first release)

| Secret name                          | Purpose                                       |
| ------------------------------------ | --------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Tauri updater signing private key             |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the above                        |
| `WINDOWS_CERTIFICATE`                | Authenticode certificate (PFX, base64)        |
| `WINDOWS_CERTIFICATE_PASSWORD`       | Certificate password                          |
| `ANDROID_KEYSTORE_BASE64`            | Android release keystore (JKS/PKCS12, base64) |
| `ANDROID_KEYSTORE_PASSWORD`          | Keystore password                             |
| `ANDROID_KEY_ALIAS`                  | Key alias within keystore                     |
| `ANDROID_KEY_PASSWORD`               | Key password                                  |

### Key lifecycle rules

- **Never commit keys or keystores to the repository**
- Rotate the Tauri signing key annually or on compromise
- Store offline backups of signing keys in a physically secure location
- Document key rotation procedure in `docs/security/key-rotation.md`
- Use separate keys for updater signing and Authenticode signing and Android signing

### Developer machine keys

Developers do not hold production signing keys. Local development builds use debug signing. Only the CI pipeline has access to production keys.

---

## Updater (auto-update)

The Tauri updater plugin supports automatic in-app update notifications.

```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/your-org/tauri-boilerplate/releases/latest/download/latest.json"
      ],
      "dialog": true,
      "pubkey": "YOUR_UPDATER_PUBLIC_KEY"
    }
  }
}
```

The `latest.json` file is produced by tauri-action and uploaded to the GitHub Release. The public key verifies the update signature — the corresponding private key is stored in `TAURI_SIGNING_PRIVATE_KEY`.

Downstream developers must generate their own updater key pair and endpoint URL. They must not use the boilerplate's keys.

---

## Dependency update automation

**RESEARCH REQUIRED** — see R-015 in doc 17.

Evaluate:

- Dependabot (GitHub-native, automatic PR creation for dependency updates)
- Renovate (more configurable, supports monorepos well)

Requirements for the chosen tool:

- Updates `pnpm` lockfile correctly
- Updates `Cargo.lock` correctly
- Groups related updates (e.g., all Tauri plugins in one PR)
- Runs CI on dependency update PRs automatically
- License checks are run as part of CI

---

## License compliance

Before any public or commercial release:

- Run automated license check: `pnpm license-checker` (or equivalent)
- All direct and indirect dependencies must have compatible licenses
- Maintain `docs/licenses.md` listing: package, version, license, repository, purpose
- SPDX identifiers preferred

**RESEARCH REQUIRED** — select and configure a license checking tool for both npm and Cargo dependencies. Cargo: `cargo-license` or `cargo-deny`.
