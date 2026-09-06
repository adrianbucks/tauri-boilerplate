# Platform Invariants and Acceptance Gates

These invariants are intended to become automated checks.

## Core invariants

### INV-001 --- Local-first writes

No business mutation requires a network round trip to commit locally.

### INV-002 --- Atomic replication metadata

A synchronisable mutation and its sync operation commit in one SQLite
transaction.

### INV-003 --- Repository boundary

UI and services do not open raw database connections.

### INV-004 --- Tenant isolation

Every tenant-sensitive operation is constrained to the authenticated
organisation.

### INV-005 --- Permission-based authorization

Business code never relies on role names for access decisions.

### INV-006 --- Cryptographic key isolation

Private keys never cross the native/TypeScript boundary.

### INV-007 --- Authenticated peer

No replication payload is accepted before peer authentication.

### INV-008 --- Seven-layer authorization

No replication payload is transmitted or applied before all required
authorization layers pass.

### INV-009 --- Idempotency

A sync operation ID can produce at most one business mutation.

### INV-010 --- Tombstone integrity

Synchronisable deletion produces durable deletion metadata.

### INV-011 --- Conflict determinism

The same valid operation set produces the same resulting state on all
authorised peers.

### INV-012 --- Version safety

Unknown or incompatible schema/protocol versions are rejected or
quarantined.

### INV-013 --- Migration integrity

Applied migrations cannot silently change without checksum detection.

### INV-014 --- Application boundary

Domain-specific business logic stays outside platform infrastructure
packages.

### INV-015 --- Frontend replaceability

The demo frontend can be removed and replaced without modifying platform
internals.

## Acceptance gates

### Gate A --- Persistent platform

- database survives restart;
- migrations work;
- transactions work;
- health check reports real state.

### Gate B --- Secure identity

- real keypair;
- persistent identity;
- signing/verification;
- secure storage;
- no private-key leakage.

### Gate C --- Secure authorization

- real sessions;
- tenant isolation;
- scoped RBAC;
- revocation.

### Gate D --- P2P

- real Windows-to-Windows;
- Windows-to-Android;
- relay fallback;
- authenticated handshake.

### Gate E --- Replication

- durable operation log;
- offline writes;
- convergence;
- conflict handling;
- tombstones;
- idempotency.

### Gate F --- Boilerplate adoption

A clean application can:

- replace frontend;
- define database;
- define feature;
- build;
- run;
- use platform infrastructure;
- remain isolated from demo business logic.

### Gate G --- Release

- signed Windows package;
- signed Android package;
- clean install;
- upgrade;
- recovery.
