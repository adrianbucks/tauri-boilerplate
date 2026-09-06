# Implementation Work Packages

Work packages are intentionally ordered by dependency and risk.

## WP-001 Durable SQLite adapter

Implement native durable storage, configuration and health verification.

**Done when:** restart persistence, FK, WAL/journal, integrity and backup tests pass.

## WP-002 Core migration authority

Move platform schema creation into platform-owned migrations.

**Done when:** demo contains no manual `core_*` table creation.

## WP-003 Tenant-aware repositories

Remove unrestricted tenant queries and allowlist dynamic SQL identifiers.

**Done when:** cross-tenant negative tests pass.

## WP-004 Trusted operation context

Introduce native/session-issued principal and remove caller authority over user/device/org identity.

## WP-005 Device key provider

Implement real cryptographic identity with protected native custody.

## WP-006 Offline authentication/session lifecycle

Implement credential verification, lockout, expiry, revocation, switching and recovery.

## WP-007 Authorization enforcement

Require permission/scope checks at every privileged service boundary.

## WP-008 Typed native gateway

Expose typed native operations only; remove arbitrary database/native authority from the webview.

## WP-009 Tauri capability/CSP hardening

Create narrowly scoped capabilities and minimise CSP allowances.

## WP-010 Canonical sync envelope

Define deterministic serialization, hashing/signature input and version negotiation.

## WP-011 Authenticated handshake

Implement nonce/freshness, peer-key verification, application/protocol negotiation and replay protection.

## WP-012 Durable outbox/inbox

Persist outbound operations atomically with business mutations; make inbound apply idempotent.

## WP-013 Conflict/tombstone engine

Implement explicit per-entity policies and replication-safe deletion.

## WP-014 Real iroh transport

Resolve R-002, add the selected iroh integration and physical two-device tests.

## WP-015 Background task subsystem

Persist task state, retry and cancellation semantics.

## WP-016 Android/Windows adapters

Implement platform lifecycle integration and process/reboot recovery tests.

## WP-017 Import/export hardening

Add resource limits and safe export behavior.

## WP-018 Release hardening

Signing, provenance, dependency checks, artifact verification and supported-runtime enforcement.

## WP-019 Downstream adoption

Build a second minimal application to prove the platform/domain boundary.
