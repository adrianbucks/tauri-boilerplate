# 13 — Demo Application

---

## Purpose

`apps/demo` is the showcase application built on top of the platform. It serves three purposes:

1. **Platform validation** — proves all platform capabilities actually work together on real hardware
2. **Developer reference** — shows downstream developers how a complete application is structured
3. **Release artefact** — produces signed, installable Windows and Android binaries demonstrating the full platform

The demo application must not contain any production domain-specific business logic beyond what is needed to demonstrate platform features.

---

## Domain: Locations and Warehouses

The demo uses a simplified Warehouse Locations scenario — the vertical slice described in the original architecture document. This domain is ideal because:

- It is easy to understand
- It naturally exercises all seven authorisation layers
- It requires sync, pairing, RBAC, offline writes, and conflict resolution
- It can be demonstrated on real hardware in 10 minutes

### Entities

```
Organisation (e.g., "Acme Logistics Ltd")
  └── SyncGroup: Coventry Warehouse
  │     └── Member: Device A (Windows laptop)
  │     └── Member: Device B (Android tablet)
  │
  └── SyncGroup: Birmingham Warehouse
        └── Member: Device C (Windows laptop)
```

Domain entities:

- `Warehouse` — a physical warehouse site
- `Location` — a storage location within a warehouse (e.g., COV-A-01-01)

---

## The primary validation scenario

This scenario must work end-to-end and is implemented as the primary integration test:

```
Step 1: Device A creates Location COV-01
        → Device B (same Coventry group) receives COV-01
        → Device C (Birmingham group) does NOT receive COV-01

Step 2: Device C creates Location BHM-01
        → Device A does NOT receive BHM-01
        → Device B does NOT receive BHM-01

Step 3: Admin grants Device A access to Birmingham sync group
        → Device A receives BHM-01 (and future Birmingham locations)
        → Device B does NOT receive BHM-01

Step 4: Admin revokes Device B from Coventry sync group
        → Device B cannot establish new authorised sync with Coventry peers
        → Device B keeps its existing local copy (offline policy)
        → Revocation propagates when peers reconnect

Step 5: Device A goes offline and creates COV-02
        → Local write succeeds immediately ("Saved locally, sync pending")
        → Device B reconnects → receives COV-02
        → No data loss, correct HLC ordering
```

If this scenario passes as automated tests, the platform is ready for downstream use.

---

## Demo application features

`apps/demo` registers the following features:

| Feature package            | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `@features/organisations`  | Organisation setup, membership management       |
| `@features/identity-admin` | User/device/role/sync-group admin UI            |
| `@platform/demo-locations` | Warehouse and Location CRUD (demo-only feature) |

`demo-locations` is a minimal feature inside `apps/demo/` itself (not in `features/`), since it is specific to the demo application and would not be useful to downstream developers.

---

## Demo application structure

```
apps/demo/
├── src/
│   ├── main.tsx
│   ├── App.tsx                        ← Router, feature registration
│   ├── bootstrap/
│   │   ├── platform.ts                ← Platform init (DB, identity, sync)
│   │   └── features.ts                ← Feature registration list
│   ├── features/
│   │   └── locations/                 ← Demo-specific feature (not in features/ root)
│   │       ├── manifest.ts
│   │       ├── schema/
│   │       ├── repositories/
│   │       ├── services/
│   │       ├── pages/
│   │       │   ├── WarehouseListPage.tsx
│   │       │   ├── LocationListPage.tsx
│   │       │   └── LocationDetailPage.tsx
│   │       └── components/
│   ├── routes/
│   │   └── routes.tsx
│   └── pages/
│       ├── SetupPage.tsx              ← First-launch wizard
│       ├── LoginPage.tsx
│       └── DiagnosticsPage.tsx        ← Sync diagnostics + diagnostic bundle export
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs
│   ├── icons/                         ← All required icon sizes
│   │   ├── icon.ico                   ← Windows
│   │   ├── icon.png                   ← Android/general
│   │   ├── 32x32.png
│   │   ├── 128x128.png
│   │   └── ...
│   ├── capabilities/
│   │   ├── default.json               ← Minimal default capabilities
│   │   ├── filesystem.json            ← File picker and save
│   │   └── dialog.json                ← Native dialog
│   ├── tauri.conf.json
│   └── Cargo.toml
│
├── public/
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Application screens

| Screen              | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| Setup wizard        | First-launch: generate device identity, join or create an organisation |
| Login               | Session establishment                                                  |
| Dashboard           | Sync status overview, pending operations count                         |
| Admin — Users       | Create/edit users, assign roles                                        |
| Admin — Devices     | Approve/revoke devices, view membership state                          |
| Admin — Sync Groups | Create groups, manage members                                          |
| Admin — Audit Log   | View audit events with filtering                                       |
| Warehouses          | List and create warehouses                                             |
| Locations           | List, create, edit, delete locations within a warehouse                |
| Import              | Import locations from XLSX/CSV                                         |
| Export              | Export locations to XLSX/CSV                                           |
| Barcode Demo        | Scan a barcode → look up matching location                             |
| Diagnostics         | Sync state per peer, export diagnostic bundle                          |

---

## Installable build requirements

The demo must produce **production-grade, signed, installable** binaries. This is part of the platform Definition of Done.

### Windows

| Artefact      | Description                                |
| ------------- | ------------------------------------------ |
| `.msi`        | Windows Installer package                  |
| `.exe` (NSIS) | Alternative self-extracting installer      |
| `.msi.sig`    | Tauri updater signature                    |
| `latest.json` | Updater manifest (for auto-update support) |

**Windows code signing**: The installer must be signed with an Authenticode certificate to avoid SmartScreen warnings. The signing key is stored in GitHub Actions Secrets. Never commit the key.

**Windows installer requirements**:

- Installs to `%LOCALAPPDATA%\Programs\TauriBoilerplateDemo\` by default
- Creates Start Menu shortcut
- Creates optional Desktop shortcut
- Uninstaller registered in Add/Remove Programs
- Auto-update support via Tauri updater plugin

### Android

| Artefact | Description                                                |
| -------- | ---------------------------------------------------------- |
| `.apk`   | Debug or release APK (sideloadable)                        |
| `.aab`   | Android App Bundle (for Play Store distribution, optional) |

**Android signing**: The APK must be signed with a release keystore. The keystore is stored in GitHub Actions Secrets. Never commit the keystore file.

**Android build requirements**:

- Targets API 35+ (Android 15+)
- Minimum required permissions declared in `AndroidManifest.xml` only
- No unnecessary permissions requested
- Tested on a physical device before release

---

## First-launch experience

```
First launch detected (no core_devices record)
        ↓
SetupPage: Welcome screen
        ↓
Generate device identity (Rust generates keypair → stores in secure storage)
        ↓
Two paths:
  A) Create new organisation → admin flow (creates org, user, syncs)
  B) Join existing organisation → enter pairing code or scan QR

Path A:
  Create organisation
      ↓
  Create admin user account
      ↓
  Device registered and immediately ACTIVE
      ↓
  Landing on Dashboard

Path B:
  Enter invitation code
      ↓
  Device sends membership request
      ↓
  Waiting for admin approval (poll / receive push notification via iroh-gossip)
      ↓
  Approved → assigned role and sync groups
      ↓
  Landing on Dashboard
```

---

## Diagnostic bundle

The diagnostics screen provides a "Download Diagnostic Bundle" button that produces a ZIP or JSON file containing:

```
diagnostic-bundle-{deviceId}-{timestamp}.zip
├── metadata.json         ← App version, DB version, platform version, device ID (public)
├── sync-status.json      ← Current SyncDiagnostic for each peer
├── pending-ops.json      ← Pending/failed operation counts
├── recent-errors.json    ← Last 100 error log entries
└── feature-list.json     ← Installed features and versions
```

**Must never include**: private keys, credentials, plaintext passwords, full audit log (privacy), raw SQL dumps.

Support staff receive the bundle to diagnose issues without gaining access to secrets or business data.

---

## Demo application — Definition of Done

- [ ] Windows MSI builds and installs cleanly on a fresh Windows 10/11 machine
- [ ] Windows installer is Authenticode signed (no SmartScreen warning)
- [ ] Android APK builds and installs on a physical Android device (API 35+)
- [ ] APK is release-signed
- [ ] First-launch setup wizard works on both platforms
- [ ] Device pairing works between Windows and Android on the same LAN
- [ ] Sync group membership approval works through the admin UI
- [ ] Coventry data does not appear on Birmingham devices (primary security test)
- [ ] Revocation prevents new sync sessions without blocking local operations
- [ ] Offline write → reconnect → sync works correctly
- [ ] Barcode scanning works on Windows (keyboard-wedge) and Android (camera)
- [ ] XLSX import of locations works with column mapping and validation
- [ ] XLSX and CSV export of locations works
- [ ] Diagnostic bundle exports without secrets
- [ ] GitHub Actions release pipeline produces all artefacts from a version tag push
- [ ] CHANGELOG.md updated for the release
