# Tauri and Native Platform Implementation Plan

## Current state

The repository has Tauri 2 configuration and Rust crates, but the native
implementation is currently small and should be treated as a platform
scaffold.

## Target boundary

```text
React / TypeScript
       ↓
typed platform API
       ↓
Tauri command
       ↓
Rust native-core
       ↓
platform crate
       ↓
OS / SQLite / secure storage / network
```

## 1. Native-core

Responsibilities:

- command registration;
- request validation;
- structured error conversion;
- capability-safe native operations;
- lifecycle management.

It should not contain business domain logic.

## 2. Rust crate boundaries

Recommended:

```text
native-core       Tauri command/native bridge
identity-core     cryptographic identity and secure storage
crypto-core       signatures/HLC/crypto primitives
sync-core         iroh transport and sync engine
```

Maintain one-way dependency direction.

## 3. Capabilities

Every Tauri capability should:

- be minimal;
- have a documented reason;
- be reviewed when added;
- avoid broad filesystem/network access;
- have platform-specific separation where required.

## 4. Error model

Rust errors must map to structured platform errors.

Do not expose:

- raw internal paths;
- stack traces;
- secrets;
- cryptographic material;
- sensitive peer information.

## 5. Platform services

Potential reusable native services:

- persistent SQLite;
- secure key storage;
- file picker;
- export/save dialog;
- scanner integration;
- app metadata;
- updater;
- diagnostics bundle;
- network identity.

## 6. Windows and Android

Treat each platform as a first-class target.

For every native capability, define:

```text
Windows implementation
Android implementation
Unsupported fallback
```

Do not allow Windows-only assumptions to leak into TypeScript APIs.

## 7. Physical-device acceptance

Android capabilities must be validated on real hardware, not only
emulators.

Windows installer acceptance must include:

- clean install;
- upgrade;
- uninstall;
- persistent data;
- secure storage;
- application launch;
- recovery after interrupted update.
