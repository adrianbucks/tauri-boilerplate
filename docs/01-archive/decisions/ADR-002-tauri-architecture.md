# ADR-002: Tauri 2 Architecture and Platform Targets

**Status**: Accepted  
**Date**: 2026-08-30  
**Authors**: Antigravity Pair Programming

---

## Context

The platform requires a native cross-platform application runtime that supports Windows and Android from a single shared codebase, enables granular OS permission scoping, and integrates directly with Rust native libraries for local SQLite and iroh P2P networking.

## Options Considered

### Option A: Electron

- Mature desktop ecosystem.
- _Downsides_: No official Android support, high memory overhead, large binary footprints (~100MB+).

### Option B: React Native / Expo

- Strong mobile support.
- _Downsides_: Windows support (React Native for Windows) has smaller ecosystem, bridging to custom Rust P2P crates requires complex JNI/C++ bindings on both platforms.

### Option C: Tauri 2 (Chosen)

- First-class support for Windows (WebView2) and Android (Android WebView) from a single Rust/TypeScript codebase.
- Native Rust integration: direct access to `sqlx`/`rusqlite`, `iroh`, and secure OS keychains without intermediate bridges.
- Granular capability-based security model.
- Small binary sizes and low memory footprint.

## Target Platform Decisions

1. **Windows**: Windows 10 (22H2+) and Windows 11 (x64).
2. **Android**: Modern Android devices (API Level 35+ / Android 15+). No legacy API constraints.

## Consequences

- Direct embedding of native Rust crates (`crates/sync-core`, `crates/crypto-core`, `crates/identity-core`).
- Security boundary enforced via Tauri capability manifests (`capabilities/*.json`).
- Production builds generate signed `.msi` / NSIS `.exe` on Windows and release `.apk` on Android.
