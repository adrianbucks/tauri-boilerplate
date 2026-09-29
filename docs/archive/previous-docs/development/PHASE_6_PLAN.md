# Phase 6 Execution Plan: Production Hardening, Live Transport & Release Engineering

**Status**: 🚀 ACTIVE / IN PROGRESS | **Target**: Production-Ready Release

---

## 1. Overview and Objectives

Phase 6 transitions the platform from a fully-implemented local-first architecture to a production-hardened, multi-platform release. The objectives are:
1. Replace simulated network transport with live peer-to-peer `iroh` QUIC connections (WP-014 / R-002).
2. Integrate native OS background execution adapters for Android and Windows (WP-016).
3. Establish verifiable release engineering: code signing, checksum provenance, and supply-chain auditing (WP-018).
4. Prove platform domain neutrality with a second downstream consumer application (WP-019).
5. Pass all remaining acceptance gates defined in [`docs/testing/ACCEPTANCE_GATES.md`](../testing/ACCEPTANCE_GATES.md).

---

## 2. Work Package Execution Detail

### WP-014: Live iroh Peer-to-Peer Transport (Research Gate R-002)
- **Goal**: Implement live decentralized replication between authorized peer devices over encrypted QUIC with relay fallback.
- **Tasks**:
  1. Complete spike comparing custom operation-log stream vs. `iroh-docs` key-value synchronization.
  2. Pin tested `iroh` version in `crates/sync-core/Cargo.toml`.
  3. Implement `IrohEndpointManager` in `crates/sync-core` managing local node identity, ALPN negotiation, and connection events.
  4. Bridge inbound/outbound QUIC byte streams to `OutboxSyncWorker` and `InboxService` via Tauri IPC.
  5. Validate against Acceptance Gates **G-06 (Sync Protocol)** and **G-07 (Replication Durability)**.
  6. Execute multi-device convergence tests (two-device and three-device mesh).

### WP-016: Native OS Background Lifecycle Adapters
- **Goal**: Ensure replication and maintenance tasks run reliably when the application is backgrounded or closed.
- **WP-016a (Android WorkManager Adapter)**:
  - Create native Android plugin bridging `@platform/tasks` `TaskQueueService` with Android's `androidx.work.WorkManager`.
  - Persist periodic and one-off sync constraints (e.g. network unmetered, battery not low).
  - Verify process restart and device reboot recovery.
- **WP-016b (Windows Scheduling Adapter)**:
  - Implement native Windows background execution mechanism (Task Scheduler API / background service runner).
  - Verify outbox queue draining continues when the main Tauri window is minimized or closed.
- **Acceptance Gate**: **G-09 (Background Execution)**.

### WP-018: Release Engineering & Artifact Provenance
- **Goal**: Production packaging, verifiable signatures, and supply-chain guarantees.
- **Tasks**:
  1. **Windows Authenticode Signing**: Integrate Windows certificate signing for the `.msi` and `.exe` installers in GitHub Actions CI.
  2. **Android Keystore Signing**: Configure release AAB/APK signing via GitHub secrets.
  3. **Provenance & Checksums**: Automate SHA-256 checksum generation and GitHub release asset attestation.
  4. **Supply-Chain Security**: Add `cargo audit` and `pnpm audit` automated gates to pull request checks.
- **Acceptance Gate**: **G-11 (Release)**.

### WP-019: Downstream Adoption Test
- **Goal**: Empirically verify that the platform packages (`@platform/*`) are domain-neutral and reusable.
- **Tasks**:
  1. Scaffold `apps/minimal-consumer` (a secondary minimal Tauri app, e.g. a simple note-taking or asset-tracking tool).
  2. Consume `@platform/database`, `@platform/identity`, `@platform/authorization`, and `@platform/sync` without importing `apps/demo` or modifying `@platform/*`.
  3. Verify independent migrations and feature manifest registration.
- **Acceptance Gate**: **G-12 (Downstream Adoption)**.

### WP-020: Fine-Grained Tauri Capability Governance
- **Goal**: Audit and minimize Tauri IPC command capabilities to absolute least privilege.
- **Tasks**:
  1. Audit all registered commands in `apps/demo/src-tauri/src/lib.rs`.
  2. Enforce window-specific and capability-specific scopes in `capabilities/*.json`.
  3. Add automated negative tests ensuring unauthorized IPC commands are rejected by Tauri's security boundary.
- **Acceptance Gate**: **G-05 (Native Boundary)**.

---

## 3. Acceptance Gate Alignment Matrix

| Acceptance Gate | Description | Governing Work Package | Target Outcome |
| :--- | :--- | :--- | :--- |
| **G-01** | Durable Storage | WP-001 | ✅ PASS (file-backed SQLite, WAL, FKs) |
| **G-02** | Trusted Identity | WP-005 | ✅ PASS (native Ed25519 custody, persistent binding) |
| **G-03** | Authentication | WP-006 | ✅ PASS (Argon2id, lockout cooldown, native sessions) |
| **G-04** | Authorization / Tenancy | WP-007 | ✅ PASS (central engine, mandatory org scope) |
| **G-05** | Native Boundary | WP-009 / WP-020 | ✅ PASS (typed commands active; least-privilege capability audit WP-020) |
| **G-06** | Sync Protocol | WP-010 / WP-011 | ✅ PASS (canonical envelopes, signed handshake) |
| **G-07** | Replication Durability | WP-012 | ✅ PASS (durable outbox/inbox queues, idempotency) |
| **G-08** | Convergence | WP-013 / WP-014 | ✅ PASS (engines complete; live network iroh transport WP-014) |
| **G-09** | Background Execution | WP-015 / WP-016 | 🚧 IN PROGRESS (task subsystem complete; OS adapters WP-016) |
| **G-10** | Import / Hardware | WP-017 | ✅ PASS (hostile input limits, formula neutralization) |
| **G-11** | Release | WP-018 | 🚧 IN PROGRESS (code signing, checksums, CI audit) |
| **G-12** | Downstream Adoption | WP-019 | ✅ PASS (verified via apps/minimal-consumer & Gate G-12 test suite) |
