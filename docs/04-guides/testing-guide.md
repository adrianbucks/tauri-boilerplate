# Testing Strategy & Quality Assurance Guide

This guide details the testing philosophy, pyramid levels, test commands, and quality requirements across TypeScript packages and Rust native crates.

---

## 1. The Testing Pyramid

```text
               ▲
              / \
             / E2E \              Physical Device / Emulators
            /───────\
           /  Sync   \            Convergence, HLC order, Replay attacks
          /───────────\
         /  Security   \          Negative tests: RBAC, Capabilities, Pairing
        /───────────────\
       /   Integration   \        Repositories, Transactions, Migrations, IPC
      /───────────────────\
     /     Unit Tests      \      Pure logic, Clocks, Envelopes, Schemas
    /───────────────────────\
```

---

## 2. Test Execution Commands

| Scope | Command | Target Directories |
| :--- | :--- | :--- |
| **All Unit Tests** | `pnpm turbo test` | `packages/**/__tests__`, `features/**/__tests__` |
| **Integration Tests** | `pnpm test:integration` | `tests/integration/` |
| **Security Tests** | `pnpm test:security` | `tests/security/` |
| **Sync & P2P Tests** | `pnpm test:sync` | `tests/sync/`, `packages/sync` |
| **Rust Native Tests** | `cargo test --workspace` | `crates/*`, `apps/demo/src-tauri` |
| **Full Local Verification** | `pnpm verify` | Runs format check, typecheck, and all test suites |

---

## 3. Test Suites & Focus Areas

### 1. Unit Tests
- **Database Logic**: `MemoryDatabaseConnection` (`sql.js`) provides sub-millisecond execution for schema validation, migration checksum calculations, and query builders.
- **Clock & Ordering**: Hybrid Logical Clock monotonicity, tie-breaking by Node ID, and drift handling.
- **Envelope Serialization**: Deterministic canonical serialization and signature verification.

### 2. Integration Tests
- **Transactions & Rollback**: Verifying that if an audit event or outbox insertion fails, the domain record rolls back atomically.
- **Migration Execution**: Applying migration sequences up and down, verifying foreign key cascade rules and triggers.

### 3. Security Regression Tests (`tests/security/`)
Security tests are strictly negative tests designed to confirm that unauthorized actions are blocked:
- **RBAC**: Attempting mutations without required permission strings fails with `AUTHORIZATION_DENIED`.
- **Tenant Scope**: Querying an entity belonging to Org B using an authenticated Org A session throws cross-tenant access errors.
- **Device Pairing**: Spoofed public keys or invalid Ed25519 signatures during handshake fail Layer 3 verification.
- **Tauri Governance**: Validating that no capability grants broad wildcard (`*`) access or unvetted host subsystems.

### 4. Native Rust Tests (`cargo test --workspace`)
- `crates/native-core`: Tests `validate_safe_sql` against injection payloads (`ATTACH`, `PRAGMA`, `VACUUM INTO`).
- `crates/identity-core`: Verifies Ed25519 key generation, in-memory signing, and Argon2id hash verification with cooldown.
- `crates/sync-core`: Tests iroh endpoint binding, node address generation, and QUIC stream serialization.

---

## 4. Testing Invariants

1. **Never Remove a Security Test**: Security tests in `tests/security/` are permanent regression sentinels.
2. **Deterministic Clocks**: Tests manipulating time must use mock timers or explicit HLC timestamps, never relying on `setTimeout` delays or wall-clock races.
3. **Hermetic Test Environments**: Tests must not share mutable global state, files on disk, or active network ports. Clean up temp files in `afterEach` hooks.
