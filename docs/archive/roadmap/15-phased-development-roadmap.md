# Phased Development Roadmap

## Phase 0 --- Re-baseline architecture status

Deliver:

- audit findings incorporated;
- milestone statuses corrected;
- future-development documentation adopted;
- invariants defined;
- focused research register established.

## Phase 1 --- Production persistence

Deliver:

- persistent SQLite;
- Rust/native database path;
- WAL;
- foreign keys;
- platform migrations;
- feature/application migration separation;
- checksum validation;
- repository contract.

**Exit:** database survives restart and passes persistence acceptance
suite.

## Phase 2 --- Real identity and secure storage

Deliver:

- real device keypair;
- secure storage;
- signing;
- verification;
- identity lifecycle;
- Windows and Android support.

**Exit:** cryptographic identity survives restart and no private-key
leakage is possible.

## Phase 3 --- Authentication, tenancy and authorization

Deliver:

- trusted OperationContext;
- real session model;
- organisation membership;
- tenant-scoped repositories;
- RBAC;
- revocation.

**Exit:** security regression suite passes.

## Phase 4 --- Secure pairing and handshake

Deliver:

- challenge/response;
- signature verification;
- replay protection;
- protocol negotiation;
- organisation/device validation.

**Exit:** real peer handshake passes security suite.

## Phase 5 --- Local-first replication model

Deliver:

- operation log;
- atomic mutation + operation;
- durable queue;
- idempotency;
- schema/version validation.

**Exit:** local offline operations survive restart and are ready for
transport.

## Phase 6 --- iroh transport

Deliver:

- actual iroh node;
- discovery;
- direct connections;
- relay fallback;
- connection lifecycle.

**Exit:** two physical devices connect securely.

## Phase 7 --- Replication and convergence

Deliver:

- outbound/inbound pipelines;
- conflict engine;
- tombstones;
- ACK/retry;
- convergence tests.

**Exit:** real multi-device convergence is demonstrated.

## Phase 8 --- Feature/application extension model

Deliver:

- application feature registration;
- application migrations;
- dynamic optional UI contributions;
- validator;
- template consumer.

**Exit:** a new app can be created without changing platform internals.

## Phase 9 --- Native platform completeness

Deliver:

- Android parity;
- hardware;
- file dialogs;
- diagnostics;
- updater;
- capabilities.

## Phase 10 --- Release hardening

Deliver:

- signed Windows builds;
- signed Android builds;
- upgrade tests;
- recovery;
- release documentation.

## Phase 11 --- Business-feature readiness

Only after platform gates pass should domain-specific applications build
substantial modules.

## Priority model

P0:

- persistence;
- identity;
- authentication;
- tenant isolation;
- cryptographic handshake;
- actual sync.

P1:

- conflict/tombstone/recovery;
- Android hardening;
- application extension model.

P2:

- UI refinement;
- diagnostics;
- import/export;
- hardware maturity;
- updater.

P3:

- developer tooling and generators.
