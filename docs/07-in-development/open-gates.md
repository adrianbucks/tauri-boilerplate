# Active Development Gates & Open Work Packages

This document defines the remaining open work packages required before tagging the 1.0.0 production milestone.

---

## 1. Work Package WP-016: OS Background Execution Adapters

### Problem Statement

The current background task subsystem (`@platform/tasks`) implements an asynchronous polling loop (`TaskWorker`, `OutboxSyncWorker`) that executes within the running application process. On desktop, if the application window is closed and no background process remains active, synchronization ceases. On Android, mobile operating systems suspend or terminate background webviews aggressively to preserve battery.

### Technical Scope & Implementation Plan

#### Android (WP-016a): WorkManager Native Plugin ✅ RESOLVED

1. **Background Job Registration**: Expose native Android `SyncWorker` using `androidx.work.WorkManager` via `PeriodicWorkRequestBuilder` with 15-minute interval and 5-minute flex window.
2. **Execution Constraints**:
   - `NetworkType.CONNECTED` (trigger sync when device comes online)
   - `BatteryNotLow(true)`
3. **Crash Durability & Permission Scoping**: Foreground service permissions scoped to `dataSync`, durable SQLite transaction boundaries protect against premature task acknowledgement.
4. **Security Regression Tests**: 7 automated tests in `tests/security/android-lifecycle-governance.test.ts`.

#### Windows (WP-016b): System Tray & Background Service ✅ RESOLVED

1. **System Tray Minimization**: Configured Tauri tray icon and intercepted window `CloseRequested` on Windows (`api.prevent_close()` + `window.hide()`). The native Rust Tokio runtime and `OutboxScheduler` remain active.
2. **Tray Context Menu**: Show, Sync Now (`background://sync-now-requested` IPC event), and Quit (`app.exit(0)`).
3. **Decoupled Worker**: `usePlatform` hooks `background_start` at platform initialization and binds the sync-now event listener with unlisten cleanup.
4. **Security Regression Tests**: 8 tests passing in `tests/security/windows-tray-lifecycle.test.ts` validating no key leakage, stable IDs, and narrow capability scope.

---

## 2. Work Package WP-021: Build-Time Feature Permission Enforcement Gate ✅ RESOLVED

### Implementation Summary

1. **Static AST Scanner**: `scanFeaturePermissions` parses all TypeScript/TSX files in feature `src/` directories using the TypeScript compiler API, identifying calls to `can()`, `require()`, and `requireTrusted()`.
2. **Constant Reference Resolution**: Statically resolves permission constants defined as `as const` in feature `permissions.ts` files (e.g. `WIDGET_PERMISSIONS.READ`).
3. **Cross-Check Engine**: `checkPermissionCoverage` compares discovered call sites against the declared permissions in the feature's `FeatureManifest`, producing errors for undeclared permissions with file paths and line numbers.
4. **CLI & CI Gate**: Executable via `pnpm feature-validate`, integrated into Turborepo pipeline, and enforced in `.github/workflows/ci.yml`.
5. **Security Regression Suite**: 13 automated tests in `tests/security/feature-permission-governance.test.ts`.

---

## 3. Work Package WP-018: Production Release Code Signing & Provenance

### Problem Statement

Current GitHub Actions workflows (`build.yml`, `release.yml`) build unsigned Windows installers (`.msi`, NSIS `.exe`) and unsigned Android APKs. Without cryptographic signing, Windows SmartScreen flags installers as untrusted, and Android prevents installation outside developer sideloading.

### Technical Scope & Implementation Plan

#### Supply Chain Security & Provenance Attestations (WP-018a) ✅ RESOLVED

1. **Automated Rust Audit**: Integrated `cargo audit` in `.github/workflows/ci.yml` to audit against RustSec advisory database.
2. **Automated NPM Audit**: Integrated `pnpm audit --prod` in CI. Upgraded `drizzle-orm` to `^0.45.3` to resolve GHSA-gpj5-g38j-94v9.
3. **Evidence**: `pnpm audit --prod` runs clean with 0 vulnerabilities; CI supply-chain checks automated.

#### Windows Authenticode Signing (WP-018b) — Optional Downstream Feature

Commercial code signing certificates require paid annual subscriptions with a commercial Certificate Authority (e.g. Sectigo, DigiCert). In open-source templates and boilerplates, this is treated as an optional downstream configuration:

1. Downstream enterprise users configure their EV/OV certificate in GitHub Actions Secrets (`WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`).
2. The release workflow conditionally runs `signtool.exe` or Tauri's `bundle.windows.certificateThumbprint` when the secret is present; otherwise, it packages clean unsigned release installers.

#### Android Keystore Signing (WP-018c) — Free Local / CI Keystore

Android APK signing is 100% free and does not require paid certificates:

1. Generate release keystore using the standard JDK `keytool` command:
   ```bash
   keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias tauri-boilerplate
   ```
2. Store base64-encoded keystore in GitHub Secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`).
3. Configure `apps/demo/src-tauri/gen/android/app/build.gradle.kts` with `signingConfigs.release`.

#### SLSA Provenance Attestations (WP-018d) — Free GitHub Actions Provenance ✅ RESOLVED

Free cryptographically signed build provenance and checksums:

1. Integrated `actions/attest-build-provenance@v2` into `.github/workflows/release.yml` with `id-token: write` and `attestations: write` permissions.
2. Generates immutable Sigstore SLSA build provenance attestations for Windows (`.msi`, `.exe`) and Android (`.apk`) release artifacts.
3. Publishes SHA-256 checksum files (`checksums-windows.txt`, `checksums-android.txt`) alongside each release.

---

## 4. Native Subsystem Diagnostics & Live P2P Controls ✅ RESOLVED

### Implementation Summary

1. **Native Gateway Diagnostics**: Extended `NativePlatformGateway` with `getDatabaseHealth()`, `getDeviceIdentity()`, `getBackgroundStatus()`, `getSyncEndpointInfo()`, `signMessage()`, and `verifyMessage()`.
2. **Interactive UI (`DiagnosticsPage.tsx`)**:
   - Live SQLite WAL mode, foreign keys, path, and table row counters (`core_sync_outbox`, `core_sync_inbox`, `core_audit_events`, `widgets`).
   - Genuine Ed25519 device identity and key custody status (Invariant #5).
   - Live iroh 1.2.0 QUIC node identifier and ALPN (`tauri-boilerplate-sync/1.0`).
   - Interactive P2P peer connection controls (`transport.connect`, `platform.sync.connect`).
   - Test signed sync envelope generator: Signs diagnostic envelopes via native Ed25519 delegate and commits to durable SQLite outbox with real-time UI feedback.
   - Manual sync trigger button invoking native `background_start`.
