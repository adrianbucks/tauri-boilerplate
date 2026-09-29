# Build, Release and Distribution Plan

## Current state

CI has a useful foundation, but the release workflows need to execute
actual Tauri desktop and Android build commands rather than only the
frontend build.

## 1. CI stages

```text
install
 ↓
format check
 ↓
lint
 ↓
typecheck
 ↓
unit tests
 ↓
integration tests
 ↓
security tests
 ↓
sync tests
 ↓
web build
 ↓
native build
```

## 2. Windows

Release must produce:

- MSI;
- NSIS EXE where supported.

Acceptance:

- clean install;
- launch;
- persistent database;
- secure identity;
- upgrade;
- uninstall;
- installer signing.

## 3. Android

Release must execute the actual Tauri Android build.

Acceptance:

- API 35+;
- physical device install;
- launch;
- persistent data;
- secure storage;
- scanner if supported;
- network/P2P behaviour;
- upgrade.

## 4. Signing

Document and automate:

- key generation;
- secure storage;
- CI secret injection;
- signing;
- rotation;
- recovery.

Private signing keys must never be committed.

## 5. Versioning

Version:

- application;
- platform protocol;
- feature schema;
- migrations;
- sync operation format;

must be treated as separate concepts.

## 6. Compatibility

The sync protocol needs explicit compatibility rules:

```text
compatible
upgrade required
downgrade unsupported
quarantine
```

Do not silently accept unknown protocol/schema versions.

## 7. Release gates

A release cannot be marked production-ready until:

- all P0 security tests pass;
- native builds succeed;
- signatures verify;
- migration upgrade works;
- rollback/recovery has been tested;
- sync compatibility tests pass.
