# Getting Started

This guide walks you through setting up your local environment, installing dependencies, and running the Tauri Boilerplate application on Windows and Android.

---

## 1. System Prerequisites

Ensure the following runtimes and tools are installed:

### Node.js & Package Manager

- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **pnpm**: `v10.x` (`corepack enable && corepack use pnpm@10.5.2`)

### Rust Toolchain

- **Rust**: Version `1.98.1` (pinned in `rust-toolchain.toml`)
- **Components**: `rustfmt`, `clippy`
  ```bash
  rustup toolchain install 1.98.1
  rustup component add rustfmt clippy --toolchain 1.98.1
  ```

### Windows Build Tools (for Windows Desktop)

- Visual Studio 2022 with **"Desktop development with C++"** workload installed
- Microsoft WebView2 Runtime (installed by default on Windows 10/11)

### Android Build Tools (for Android Mobile)

- **JDK**: Java Development Kit 17 (Temurin / OpenJDK 17)
- **Android Studio & SDK**:
  - Android SDK Platform `API Level 35` or `36`
  - Android SDK Build-Tools `35.0.0`
  - NDK (Side by Side) `26.x` or `27.x`
- **Rust Android Targets**:
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```
- **Environment Variables**:
  ```bash
  export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"
  export NDK_HOME="$ANDROID_HOME/ndk/<version>"
  ```

---

## 2. Clone & Initial Installation

```bash
# Clone the repository
git clone https://github.com/adrianbucks/tauri-boilerplate.git
cd tauri-boilerplate

# Install all pnpm monorepo dependencies
pnpm install

# Verify Rust crates build cleanly
cargo check --workspace
```

---

## 3. Running in Development Mode

### Running the Web Frontend Only (Browser Sandbox)

For rapid UI iteration with in-memory database mocks:

```bash
pnpm --filter @apps/demo dev
```

Open [http://localhost:1420](http://localhost:1420) in your browser.

### Running the Full Tauri Desktop App (Windows)

Runs the live application with bundled native SQLite, Ed25519 identity, and iroh P2P networking:

```bash
pnpm --filter @apps/demo tauri:dev
```

### Running on Android Device or Emulator

Ensure an Android emulator is running or a physical device is connected via USB with USB Debugging enabled:

```bash
# Check device is recognized
adb devices

# Start Tauri Android dev session
pnpm --filter @apps/demo tauri -- android dev
```

---

## 4. Validating the Installation

Run the complete local verification suite to ensure all TypeScript and Rust components pass:

```bash
# Verify TypeScript formats, types, and unit tests
pnpm verify

# Verify Rust formatting, clippy lints, and native tests
cargo test --workspace
```
