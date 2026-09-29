# Test Strategy

## Pyramid

```text
unit
  ↓
service/repository integration
  ↓
native IPC
  ↓
security
  ↓
sync/convergence
  ↓
physical platform/device
  ↓
release artifact
```

## Unit tests

Cover pure behavior:

- validation;
- correlation IDs;
- HLC ordering/update;
- namespace canonicalisation/matching;
- permission/scope evaluation;
- conflict policy;
- migration checksum logic;
- error mapping;
- retry policy.

## Database integration

Required scenarios:

- fresh install;
- upgrade from each supported schema baseline;
- checksum mismatch;
- transaction rollback;
- nested transaction/savepoint behavior;
- foreign-key enforcement;
- WAL/journal policy;
- restart persistence;
- corruption/integrity failure;
- concurrent read/write behavior;
- backup/restore.

## Authentication/security

Required negative tests:

- wrong password/PIN;
- retry exhaustion/lockout;
- inactive/revoked user;
- revoked/suspended device;
- forged principal;
- cross-organisation request;
- role injection;
- insufficient scope;
- insufficient authentication strength;
- session expiry/revocation;
- recovery cannot reveal private key.

## Native/Tauri

Test:

- command input validation;
- capability isolation;
- no arbitrary SQL/file/shell access;
- private key never crosses IPC;
- CSP policy;
- native error mapping.

## Sync/convergence

Test:

- connect/disconnect;
- authenticated handshake;
- replay;
- stale timestamp;
- duplicate operation;
- out-of-order operation;
- offline edits;
- three-way convergence;
- schema/protocol mismatch;
- revoked peer;
- namespace mismatch;
- tombstone vs stale update;
- conflict resolution;
- crash during apply;
- long offline period.

## Import/export

Test:

- oversized file;
- excessive sheets/rows/cells;
- malformed workbook;
- formula injection;
- invalid data types;
- duplicate records;
- partial failure/rollback;
- unauthorized import/export.

## Property-based testing

Prefer property tests for namespace matching, HLC ordering, canonical serialization, idempotency and convergence.

## Mutation testing

Use selectively against authorization, tenant filters, sync admission and cryptographic verification so deletion of a guard causes a test failure.

## Physical matrix

At minimum:

- supported Windows versions;
- Windows x64;
- supported Android API levels;
- Android arm64;
- low-memory Android device;
- offline device;
- shared-device authentication;
- process kill/reboot during background sync.
