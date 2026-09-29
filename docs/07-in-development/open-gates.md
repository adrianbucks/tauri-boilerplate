# Active Development Gates & Open Work Packages

This document defines the remaining open work packages required before tagging the 1.0.0 production milestone.

---

## 1. Work Package WP-016: OS Background Execution Adapters

### Problem Statement
The current background task subsystem (`@platform/tasks`) implements an asynchronous polling loop (`TaskWorker`, `OutboxSyncWorker`) that executes within the running application process. On desktop, if the application window is closed and no background process remains active, synchronization ceases. On Android, mobile operating systems suspend or terminate background webviews aggressively to preserve battery.

### Technical Scope & Implementation Plan

#### Android (WP-016a): WorkManager Native Plugin
1. **Background Job Registration**: Expose a native Android service using Google's `androidx.work.WorkManager`.
2. **Execution Constraints**:
   - `NetworkType.CONNECTED` (trigger sync when device comes online)
   - `BatteryNotLow(true)`
3. **Foreground Notification**: For large batch transfers exceeding 30 seconds, transition the task to a foreground service with an active Android notification pill.
4. **Crash Durability**: Ensure that if the Android OS kills the process mid-envelope, incomplete batches in `core_sync_outbox` remain un-acknowledged and automatically re-execute upon next worker wake.

#### Windows (WP-016b): System Tray & Background Service
1. **System Tray Minimization**: Configure Tauri's system tray plugin so closing the main window minimizes to tray rather than exiting the process, keeping the native Rust Tokio runtime active.
2. **Windows Task Scheduler (Optional Headless Mode)**: For headless enterprise workstations, register a scheduled task that executes periodic sync maintenance without launching the webview UI.

---

## 2. Work Package WP-018: Production Release Code Signing & Provenance

### Problem Statement
Current GitHub Actions workflows (`build.yml`, `release.yml`) build unsigned Windows installers (`.msi`, NSIS `.exe`) and unsigned Android APKs. Without cryptographic signing, Windows SmartScreen flags installers as untrusted, and Android prevents installation outside developer sideloading.

### Technical Scope & Implementation Plan

#### Windows Authenticode Signing
1. Procure or configure EV/OV code signing certificate.
2. Store signing credentials in GitHub Actions Secrets (`WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`).
3. Integrate `signtool.exe` or Tauri's native `bundle.windows.certificateThumbprint` into `.github/workflows/release.yml`.

#### Android Keystore Signing
1. Generate release keystore using `keytool`:
   ```bash
   keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias tauri-boilerplate
   ```
2. Store base64-encoded keystore in GitHub Secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`).
3. Configure `apps/demo/src-tauri/gen/android/app/build.gradle.kts` with `signingConfigs.release`.

#### Supply Chain Security & Provenance Attestations
1. Integrate `cargo audit` in CI to detect CVEs in Rust dependencies.
2. Integrate `pnpm audit --prod` in CI to detect vulnerabilities in npm packages.
3. Generate SLSA provenance attestations and publish SHA-256 checksums alongside release tags.
