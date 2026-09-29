# Research Register & Exploratory Gates

Research gates ensure that complex dependencies, cryptographic primitives, and platform integrations are validated through rigorous spikes and documentation before code is merged into production packages.

---

## Research Register Status

| ID | Title | Status | Resolution / Current Focus |
| :--- | :--- | :--- | :--- |
| **R-001** | Cryptographic Device Key Custody | ✅ RESOLVED | Ed25519 native keypair generated in `crates/identity-core`, seed persisted with restricted file permissions (`device_identity.key`), private keys kept in native memory custody. |
| **R-002** | Replication Substrate Evaluation | ✅ RESOLVED | Decided Option 1: Canonical signed envelopes over direct `iroh::Endpoint` QUIC streams. Rejected `iroh-docs` because it bypasses 7-layer sync admission. Accepted under ADR-012. |
| **R-003** | Handshake & Replay Protocol | ✅ RESOLVED | 32-hex random nonce freshness, 30s clock-skew tolerance, session-tracked nonces, deterministic Ed25519 signature verification. Implemented in `@platform/sync-protocol`. |
| **R-004** | Android Background Sync Lifecycle | 🚧 ACTIVE | Researching Android WorkManager constraints, battery optimization exclusions, and native JNI bridge to iroh QUIC endpoint. |
| **R-005** | Windows Background Execution | 🚧 ACTIVE | Researching system tray lifecycle vs Task Scheduler background process. |
| **R-006** | Database Encryption at Rest | ⏳ DEFERRED | Deferred until key escrow, multi-user key hierarchy, and backup/restore semantics are designed. Will evaluate SQLCipher vs OS-level DPAPI / KeyStore. |
| **R-007** | Conflict Resolution Semantics | ✅ RESOLVED | Deterministic HLC-based LWW, additive policy safety guard for absolute fields, and soft-delete tombstones. Implemented in `@platform/sync`. |
| **R-008** | Large Binary Object Replication | ⏳ DEFERRED | Deferred to Phase 7. Will design content-addressed chunking (BLAKE3/Bao) for attachments exceeding 10MB. |
| **R-009** | Production P2P Relay Infrastructure | 🚧 ACTIVE | Evaluating self-hosted DERP relay fleet orchestration (using `iroh-relay`) vs public infrastructure for enterprise deployments. |
| **R-010** | Runtime Third-Party Plugin Model | ⏳ DEFERRED | Statically registered features prioritized for security. Dynamic plugin loading deferred. |
| **R-011** | Offline Credential Verification | ✅ RESOLVED | Argon2id verification with 5-failure lockout cooldown window implemented in `crates/native-core`. |
