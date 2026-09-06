# Demo Application (`@apps/demo`)

**Role:** Downstream reference consumer application composing platform mechanisms and domain features.

---

## 1. Overview

The demo app demonstrates:

- **UI Layer**: React 19, TypeScript, Tailwind CSS, Vite 6.
- **Platform Integration**: Native database connection (`NativeDatabaseConnection`), session management, and feature registration.
- **Native Shell**: Tauri 2 Rust desktop & mobile host (`src-tauri/`).

---

## 2. Development Commands

Run from the repository root:

| Command          | Action                                                     |
| ---------------- | ---------------------------------------------------------- |
| `pnpm dev`       | Run all workspace dev servers via Turborepo                |
| `pnpm dev:web`   | Run demo app in browser via Vite (`http://localhost:5173`) |
| `pnpm dev:tauri` | Run native desktop Tauri application with hot-reload       |

---

## 3. Production Build Commands

| Target              | Build Command                       | Native Prerequisites                                    |
| ------------------- | ----------------------------------- | ------------------------------------------------------- |
| **Web Frontend**    | `pnpm build:web`                    | Node.js 24                                              |
| **Windows Desktop** | `pnpm build:tauri`                  | Rust toolchain (`1.98.1`), MSVC C++ Build Tools         |
| **Android Mobile**  | `pnpm tauri -- android build --apk` | JDK 17, Android SDK (API 36), NDK, Rust Android targets |

---

## 4. Build Artifacts & Release Executables

### Output Architecture

To optimize build caching and maintain monorepo boundaries:

- **Compiler Caches & Intermediate Objects**:
  - Desktop (Cargo): `<repo_root>/target/release/`
  - Android (Gradle): `src-tauri/gen/android/app/build/`
- **Unified Release Executables**:
  - Staged into **`apps/demo/release/`** (gitignored) for quick access and distribution.

```text
apps/demo/release/
├── windows/
│   ├── demo-app_0.1.0_x64_en-US.msi
│   └── demo-app_0.1.0_x64-setup.exe
└── android/
    └── app-universal-release-unsigned.apk
```

### Artifact Commands

After building, collect all platform installers into the unified folder:

```bash
# Gather Windows (.msi, .exe) and Android (.apk, .aab) into apps/demo/release/
pnpm artifacts:collect

# Open the release folder directly in the OS file explorer
pnpm artifacts:open
```
