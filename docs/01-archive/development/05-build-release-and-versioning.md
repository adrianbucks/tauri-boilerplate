# 15 — Build, Release and Versioning

| | |
| **Current** | `ci.yml` (format, typecheck, unit/integration/security/sync tests, Rust fmt/clippy/test), `build.yml` (unsigned Windows MSI/NSIS + Android APK inspection), `release.yml` (same packages uploaded to a GitHub Release with SHA-256 checksums). Rust toolchain is pinned in `rust-toolchain.toml` (`1.98.1`). |
| **Target** | Signed Windows and Android artefacts, updater `latest.json`, pinned third-party action SHAs, license/CVE gates, and key-rotation docs. |
| **Remaining** | [S-12](../specifications/S-12-release-and-distribution.md), [R-09](../research/R-09-testing-supply-chain-and-release-integrity.md). |

The YAML snippets that used to appear here were a target pipeline. The live workflows in `.github/workflows/` are the source of truth; this document summarises them and keeps the signing/updater design as the production standard.

## GitHub Actions pipeline overview

```
.github/workflows/
├── ci.yml           ← Push/PR to main: TypeScript + Rust verification
├── build.yml        ← Push to main / manual: unsigned native package check
└── release.yml      ← Tag `v*`: unsigned packages + GitHub Release upload
```

Local equivalent of the TypeScript verification sequence: `pnpm verify`.

CI does not currently run `pnpm turbo lint` as a separate job; it runs `pnpm format:check` and `pnpm turbo typecheck`. Native jobs call `pnpm --filter @apps/demo tauri:build` and `pnpm --filter @apps/demo tauri -- android build --apk` rather than `tauri-apps/tauri-action`.

### `ci.yml` (current)

- **lint-and-typecheck** on `windows-latest`: checkout, Node 20, pnpm 10, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm turbo typecheck`, `pnpm turbo test`, `pnpm test:integration`, `pnpm test:security`, `pnpm test:sync`.
- **rust-check** on `windows-latest`: toolchain `1.98.1` with clippy/rustfmt, `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.

### `build.yml` (current)

Does not sign or publish. Records SHA-256 hashes of generated artefacts.

- **build-windows**: `pnpm --filter @apps/demo tauri:build`; fails if no `.msi` / NSIS `.exe` under `target/release/bundle/`.
- **build-android**: JDK 17, Android SDK (API 36 / build-tools 35), Android Rust targets, `tauri -- android build --apk`; fails if no `.apk` under `apps/demo/src-tauri/gen`.

### `release.yml` (current)

Same native builds as `build.yml`, then uploads artefacts and checksum files to a GitHub Release via `softprops/action-gh-release`. Signing secrets are not referenced.

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

GitHub Actions currently:

- Builds unsigned Windows installer (`.msi` / NSIS `.exe`)
- Builds unsigned Android APK
- Creates a GitHub Release for the tag
- Attaches artefacts and SHA-256 checksum files

Signed artefacts, updater metadata, and Authenticode/Play signing remain target work. Do not treat a GitHub Release as production-ready until [S-12](../specifications/S-12-release-and-distribution.md) is verified.

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

## Secrets management (target)

These secrets are **not configured** in this repository today. Configure them only in GitHub Actions when implementing production signing. Never commit keys.

### GitHub Actions Secrets (required before a signed production release)

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
- Document key rotation procedure (target: `docs/security/key-rotation.md`; file does not exist yet)
- Use separate keys for updater signing and Authenticode signing and Android signing

### Developer machine keys

Developers do not hold production signing keys. Local development builds use debug signing. Only the CI pipeline has access to production keys.

---

## Updater (auto-update) — target

The Tauri updater plugin is the intended auto-update path. It is not configured in the current demo `tauri.conf.json`.

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

**RESEARCH REQUIRED** — [R-09](../research/R-09-testing-supply-chain-and-release-integrity.md).

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
