# Development Roadmap

**Status:** Current implementation sequence
**Last reviewed:** 2026-09-04

## Phase 0: establish truth

- Keep [implementation status](../verification/status.md) current.
- Keep architecture documents dual-purpose: current code plus target patterns for production work.
- Keep research items and ADRs consistent.
- Treat simulated tests and placeholder implementations as incomplete.
- Keep native build verification reproducible with the pinned Rust toolchain and JDK 17 Android workflow.

## Phase 1: durable platform foundation

1. Complete R-02/R-03 and replace production `sql.js` with a durable native SQLite adapter.
2. Make migrations a startup readiness gate in the native layer.
3. Add restart, WAL, corruption, backup, concurrency, and migration compatibility tests.
4. Complete R-04 and implement real Ed25519 identity plus platform secure storage.
5. Persist sessions and bind them to active user, device, organisation, and membership state.

## Phase 2: authoritative authorization

1. Introduce a trusted authenticated context owned by the identity/session boundary.
2. Make authorization consume trusted context rather than caller-assembled subjects.
3. Validate user, device, organisation, membership, role assignment, and session state together.
4. Add cross-tenant and revoked-state security regressions for every privileged service.

## Phase 3: real synchronization

1. Complete R-06/R-07 and choose the durable operation-log strategy.
2. Implement canonical signed operations, durable queues, idempotent application, quarantine, and replay protection.
3. Integrate the seven authorization layers with real iroh transport.
4. Implement tombstone propagation, conflict recovery, and garbage-collection policy.

## Phase 4: application and native boundary

1. Replace demo ad hoc schema setup with platform/application migrations.
2. Prove a second application can consume the platform without demo internals.
3. Define and validate every Tauri command contract and capability.
4. Add architecture and capability CI checks.

## Phase 5: release readiness

1. Configure signing only in CI secrets and document key rotation.
2. Inspect target, version, architecture, signatures, checksums, and development configuration.
3. Verify upgrade and migration compatibility on Windows and Android.
4. Do not label the template production-ready until the status matrix says every P0 gate is verified.
