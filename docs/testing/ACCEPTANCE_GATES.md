# Acceptance Gates

A capability is production-ready only when all relevant gates pass.

## G-01 Durable storage

- restart preserves committed data;
- FK constraints are enabled and tested;
- journal/WAL mode is verified;
- integrity check is real;
- backup/restore is tested.

## G-02 Trusted identity

- native key generated/stored by protected provider;
- public identity is stable across restart;
- private material never reaches JS;
- key rotation/revocation/re-enrollment tested.

## G-03 Authentication

- credential/platform proof required;
- brute-force resistance tested;
- sessions expire/revoke correctly;
- shared-device switching clears prior user authority.

## G-04 Authorization/tenancy

- every privileged service authorises;
- organisation scope is mandatory;
- cross-org is explicit and audited;
- revoked devices/users cannot operate.

## G-05 Native boundary

- capabilities are least-privilege;
- native commands are typed and validated;
- arbitrary SQL/filesystem/shell access is unavailable;
- CSP contains only justified allowances.

## G-06 Sync protocol

- canonical serialization is deterministic;
- peer identity is cryptographically verified;
- freshness/replay protection works;
- protocol/schema compatibility is explicit;
- seven admission gates are enforced.

## G-07 Replication durability

- every synchronisable mutation has durable outbox state;
- duplicate operations are harmless;
- inbound operations are transactionally applied;
- crash recovery cannot lose or double-apply a committed operation.

## G-08 Convergence

- supported conflict policies converge deterministically;
- tombstones prevent resurrection;
- long-offline peers converge after reconnect;
- manual conflicts are visible and recoverable.

## G-09 Background execution

- Android work survives app/process restart within OS constraints;
- Windows background execution does not depend on visible webview;
- retries are bounded and idempotent.

## G-10 Import/hardware

- hostile input limits are enforced;
- export cannot create formula injection;
- scanner input is bounded and lifecycle-aware.

## G-11 Release

- Windows artifacts are signed;
- Android release artifacts are signed;
- checksums/provenance are published;
- dependency lockfile is reproducible;
- supported runtime/toolchain versions are enforced in CI.

## G-12 Downstream adoption

A second minimal application can consume the platform without modifying platform internals for domain-specific behavior.
