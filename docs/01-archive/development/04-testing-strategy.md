# 14 — Testing Strategy

| | |
| **Current** | Co-located package tests, `tests/integration`, `tests/sync` (in-process harness), `tests/security` (RBAC and sync-authorization). No `tests/e2e` suite. |
| **Target** | Every platform capability ships with tests; security and sync tests are never deferred; real-transport and durable-persistence suites exist. |
| **Remaining** | Coverage gaps in [coverage-matrix.md](../verification/coverage-matrix.md). |

## Principle

Testing is part of the platform, not a later activity. Every platform capability ships with its test suite. Security tests and sync tests are never deferred.

---

## Test locations

```
packages/<name>/src/          ← Unit tests co-located with source (*.test.ts)
features/<name>/tests/unit/   ← Feature unit tests
features/<name>/tests/integration/ ← Feature integration tests
tests/integration/            ← Cross-package integration tests
tests/sync/                   ← In-process sync harness (not multi-device P2P)
tests/security/               ← RBAC and sync-authorization regressions
tests/e2e/                    ← Target: end-to-end Tauri tests (not present)
```

---

## Unit tests

Run with: `pnpm turbo test` (uses Vitest)

### `packages/authorization`

```typescript
// Must test:
describe("can()", () => {
  it("grants permission when subject has role with matching permission");
  it("denies permission when subject has no matching role");
  it("grants scoped permission when scope matches exactly");
  it("denies scoped permission when scope does not match");
  it("denies unscoped request against a scoped grant");
  it("denies permission when membership is REVOKED");
  it("denies permission when membership is SUSPENDED");
});

describe("require()", () => {
  it("throws AuthorizationError when permission denied");
  it("returns void when permission granted");
});
```

### `packages/feature-system`

```typescript
describe("dependency resolver", () => {
  it("resolves linear dependency chain");
  it("detects circular dependency and fails");
  it("fails when hard dependency is missing");
  it("succeeds when optional dependency is missing");
  it("orders migrations correctly across features");
  it("fails when migration version is duplicated within a feature");
  it("fails when permission used in code is not declared in manifest");
  it("fails when synchronisable entity has no sync policy");
});
```

### `packages/database`

```typescript
describe("migration engine", () => {
  it("applies migrations in version order");
  it("skips already-applied migrations");
  it("fails cleanly on a broken migration without corrupting the DB");
  it("records applied migration in core_migrations");
});

describe("transaction runner", () => {
  it("commits all writes on success");
  it("rolls back all writes on error");
  it("handles nested transaction correctly");
});
```

### `packages/sync-protocol` (if custom op log chosen)

```typescript
describe("operation idempotency", () => {
  it("applies a new operation and records operationId");
  it("returns already_applied for duplicate operationId");
  it("never applies the same operation twice regardless of order of receipt");
});

describe("HLC ordering", () => {
  it("orders concurrent operations by HLC timestamp");
  it("handles clock skew correctly");
  it("never assigns the same HLC to two operations on the same device");
});

describe("namespace generator", () => {
  it("produces canonical namespace from valid identifiers");
  it("rejects identifiers with special characters");
  it("produces different namespaces for different org/group combinations");
});

describe("conflict resolution", () => {
  it("applies lww strategy — latest timestamp wins");
  it("applies append-only strategy — rejects updates to immutable records");
  it("detects manual conflict and records it in core_sync_conflicts");
  it("detects additive conflict and sums values");
});

describe("membership state machine", () => {
  it("allows REQUESTED → APPROVED");
  it("allows REQUESTED → REJECTED");
  it("allows APPROVED → ACTIVE");
  it("allows ACTIVE → SUSPENDED");
  it("allows SUSPENDED → ACTIVE");
  it("allows ACTIVE → REVOKED");
  it("rejects REVOKED → ACTIVE");
  it("rejects REJECTED → APPROVED");
});
```

### `packages/import-export`

```typescript
describe("import validation", () => {
  it("rejects row with missing required column");
  it("rejects row with type mismatch");
  it("accepts row with all required columns valid");
  it("reports correct row numbers in error messages");
});

describe("import transaction", () => {
  it("commits all rows in a single transaction on success");
  it("rolls back all rows on validation failure");
  it("emits IMPORT_STARTED and IMPORT_COMPLETED audit events");
  it("emits IMPORT_FAILED audit event on error");
});
```

---

## Integration tests (`tests/integration/`)

Run with: `pnpm test:integration` (requires SQLite in test environment)

### SQLite + Drizzle pipeline

```typescript
describe("database integration", () => {
  it("opens SQLite and applies all platform migrations successfully");
  it("feature migration runs after platform migration");
  it("CRUD operations complete end-to-end through repository layer");
  it("transaction isolates concurrent writes correctly");
  it("health check returns healthy on normal DB");
  it("integrity check detects deliberately corrupted DB");
});
```

### Identity pipeline

```typescript
describe("identity integration", () => {
  it("generates device keypair at first launch and stores in secure storage");
  it("retrieves device identity consistently across restarts");
  it("does not expose private key material through any Tauri command");
  it("session is established for a user on an approved device");
  it("session is invalidated when device is revoked");
});
```

### Import pipeline

```typescript
describe("import integration", () => {
  it("imports a 1,000-row XLSX file with all rows valid");
  it("aborts import and rolls back on partially invalid file");
  it("emits correct audit events for completed import");
  it("import operations appear in sync queue after commit");
});
```

---

## Security regression suite (`tests/security/`)

Run with: `pnpm test:security`

**Every new security rule must add a test here. Tests in this suite are never deleted.**

```typescript
describe("sync authorisation", () => {
  // Device identity
  it("rejects sync from unknown device (no device record)");
  it("rejects sync from device with mismatched applicationId");
  it("rejects sync from device belonging to wrong organisation");

  // Membership
  it("rejects sync from device not in any sync group");
  it("rejects sync from device with PENDING_APPROVAL membership");
  it("rejects sync from device with SUSPENDED membership");
  it("rejects sync from device with REVOKED membership");
  it("rejects sync from device with EXPIRED membership");

  // Data scope
  it("rejects sync request for namespace outside device permitted namespaces");
  it("does not include Birmingham data in Coventry namespace sync");
  it("does not include Coventry data in Birmingham namespace sync");

  // Protocol
  it("rejects sync with incompatible protocolVersion");
  it("rejects sync with tampered handshake message");

  // Operations
  it("rejects duplicate operationId — never applies twice");
  it("rejects operation with invalid schema version (too old)");
  it("quarantines operation with unknown featureId (does not discard)");
  it("rejects operation with invalid signature (when signatures enabled)");

  // Revocation
  it(
    "device revoked mid-session: existing session terminates, new session refused",
  );
  it("revocation propagates to connected peers on reconnect");
  it("revoked device continues local operations (offline policy)");
});

describe("RBAC", () => {
  it(
    "user without inventory.read cannot access inventory data via any code path",
  );
  it(
    "user with scoped permission for COV cannot access BHM via that permission",
  );
  it("admin cannot grant a permission they do not themselves have");
  it("role without permission cannot use require() for that permission");
});

describe("key security", () => {
  it("no Tauri command returns private key material");
  it("no log line contains private key content");
  it("diagnostic bundle does not contain private key material");
});
```

---

## Multi-device sync harness (`tests/sync/`)

Run with: `pnpm test:sync` (requires iroh or iroh-docs to be available)

```typescript
const harness = new SyncTestHarness();

describe('basic sync', () => {
  it('Device A write → Device B receives it after connection', async () => {
    const deviceA = harness.addDevice({ org: 'acme', groups: ['coventry'] });
    const deviceB = harness.addDevice({ org: 'acme', groups: ['coventry'] });
    harness.connect(deviceA, deviceB);
    await deviceA.createLocation('COV-01');
    await harness.waitForSync([deviceA, deviceB]);
    expect(await deviceB.findLocation('COV-01')).toBeDefined();
  });

  it('Different groups do not share data', async () => {
    const deviceA = harness.addDevice({ org: 'acme', groups: ['coventry'] });
    const deviceC = harness.addDevice({ org: 'acme', groups: ['birmingham'] });
    harness.connect(deviceA, deviceC);
    await deviceA.createLocation('COV-01');
    await harness.waitForSync([deviceA, deviceC]);
    expect(await deviceC.findLocation('COV-01')).toBeNull();
  });
})

describe('offline sync', () => {
  it('offline write → reconnect → correct sync', async () => { ... });
  it('concurrent offline writes → correct ordering on reconnect', async () => { ... });
  it('tombstone propagates to peer that was offline during delete', async () => { ... });
})

describe('conflict resolution', () => {
  it('lww: concurrent updates → latest HLC timestamp wins', async () => { ... });
  it('manual: concurrent updates → conflict recorded in core_sync_conflicts', async () => { ... });
  it('duplicate operation: idempotency maintained under network duplication', async () => { ... });
})

describe('revocation', () => {
  it('revoked device cannot establish new sync session', async () => { ... });
  it('revocation propagates to all connected peers', async () => { ... });
  it('revoked device keeps local data and continues local operation', async () => { ... });
})

describe('network conditions', () => {
  it('sync recovers after disconnect/reconnect', async () => { ... });
  it('sync handles delayed messages correctly', async () => { ... });
  it('sync handles reordered messages correctly', async () => { ... });
  it('sync handles duplicate messages without double-applying', async () => { ... });
  it('sync works over relay when direct connection fails', async () => { ... });
})
```

---

## Performance baselines (target: `tests/performance/`)

This directory does not exist yet. Measure on hardware before treating numbers as gates. Do not run in default CI.

| Benchmark                                | Target  | Notes                                       |
| ---------------------------------------- | ------- | ------------------------------------------- |
| Application cold start                   | < 2s    | Measured on minimum spec Windows hardware   |
| Page navigation                          | < 200ms | React render + route change                 |
| SQLite query — filtered 10k rows         | < 100ms | With appropriate index                      |
| TanStack Table render — 100 visible rows | < 50ms  | With virtualisation                         |
| Import — 10k rows XLSX                   | < 10s   | Including column mapping and commit         |
| Import — 100k rows XLSX                  | < 120s  | May require chunked approach                |
| Sync — 1k entities LAN                   | < 30s   | Measured between two devices                |
| Sync — 10k entities LAN                  | < 300s  | Document if not achievable                  |
| Android — memory during 50k row import   | < 512MB | Physical device test                        |
| Android — startup                        | < 3s    | Physical device, first launch after install |

Baselines are re-measured for each significant release. Regressions are investigated before release.

---

## E2E tests (target: `tests/e2e/`)

There is no E2E suite yet. End-to-end tests should drive the actual Tauri application.

**RESEARCH REQUIRED** — evaluate E2E testing options for Tauri 2:

- WebdriverIO with Tauri driver
- Playwright with Tauri WebDriver support
- Tauri's own testing utilities (if available)

Initial E2E scenarios:

- Application launches and setup wizard completes
- User logs in with valid credentials
- User creates a Location record
- Admin approves a device pairing request
- Import wizard completes successfully with a test XLSX file

---

## Property-based tests

Consider property-based testing for:

- `operationId` uniqueness across generated operations
- HLC monotonicity under arbitrary interleaving
- Namespace generator always produces the same output for the same input
- Conflict resolution produces a consistent result regardless of operation receipt order
- Membership state machine never reaches an invalid state

**RESEARCH REQUIRED** — select a TypeScript property-testing library (e.g., `fast-check`) after the model is stable. Evaluated in Phase 4.

---

## CI test matrix (current vs target)

| Pipeline job          | Current (`ci.yml` / `build.yml`) | Command / notes         |
| --------------------- | -------------------------------- | ----------------------- |
| Format                | Yes                              | `pnpm format:check`     |
| Typecheck             | Yes                              | `pnpm turbo typecheck`  |
| Unit tests            | Yes                              | `pnpm turbo test`       |
| Rust fmt/clippy/test  | Yes (`rust-check`)               | pinned `1.98.1`         |
| Integration tests     | Yes                              | `pnpm test:integration` |
| Security tests        | Yes                              | `pnpm test:security`    |
| Sync tests            | Yes                              | `pnpm test:sync`        |
| ESLint (`turbo lint`) | Not a CI job                     | Available locally       |
| Native packages       | `build.yml` on main              | Unsigned MSI/NSIS/APK   |
| E2E tests             | Absent                           | Target                  |
| Performance baselines | Absent                           | Target, manual          |
