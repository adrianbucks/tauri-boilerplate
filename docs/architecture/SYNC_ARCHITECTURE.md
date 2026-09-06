# Synchronisation Architecture

## Current

The repository contains:

- `SyncOperation` wire-model types;
- HLC implementations in TypeScript and Rust;
- namespace generation/matching;
- conflict strategy registry;
- sync state machine;
- pairing workflow;
- sync diagnostics schema.

It does **not** currently contain an iroh dependency or real P2P replication engine.

## Target replication model

Local mutations produce durable operations:

```text
business mutation
  ↓ same local transaction
outbox(operation_id, namespace, entity, payload, author, HLC, schema, signature)
  ↓
background sync worker
  ↓
real iroh connection
  ↓
authenticated handshake
  ↓
authorised namespace exchange
  ↓
remote inbox/idempotency check
  ↓
apply transaction
  ├── domain state
  ├── cursor/version
  ├── conflict record if required
  └── audit/security event where required
```

## Operation requirements

Every synchronisable operation must be:

- globally identifiable by a stable operation ID;
- attributable to an author and device;
- bound to application/organisation/group/feature/entity namespace;
- versioned for schema and protocol compatibility;
- canonically serialisable;
- integrity protected and, where required, cryptographically signed;
- idempotently applicable;
- safe to retry;
- bounded in size;
- explicit about conflict semantics.

## Namespace

The existing canonical form is:

```text
application/organisation/sync-group/feature/entity
```

Segments must be canonicalised before comparison. Namespace patterns are security policy, not a convenience wildcard mechanism. A wildcard must never escape its organisation/sync-group boundary unintentionally.

## HLC

HLC provides deterministic ordering information but is **not** proof of authenticity and is **not** a security clock.

Use HLC for causal/ordering decisions; use authenticated protocol freshness/nonce mechanisms for replay protection.

The current HLC implementations need additional tests for overflow, malformed values, concurrency and deterministic tie-breaking.

## Conflict semantics

Supported strategy names currently include:

- `lww`;
- `append-only`;
- `additive`;
- `manual`;
- `immutable`;
- `crdt`.

Each application must register explicit policies. The platform must not infer that every numeric field is additive.

Examples:

- stock-on-hand absolute quantity → LWW/manual/domain-specific transaction model;
- stock movement quantity → additive/delta/event model;
- audit event → append-only;
- immutable identifier → immutable;
- collaborative set/document → CRDT only when the actual data model supports it.

## Deletion

Synchronisable entities use tombstones. A delete records enough metadata to prevent an offline peer from resurrecting an old record.

A hard delete is only safe when the data is provably outside replication/history requirements.

## Seven admission gates

1. iroh transport established;
2. cryptographic peer identity verified;
3. application ID + protocol compatibility verified;
4. organisation relationship verified;
5. device/user/session validity verified as required;
6. sync-group membership and status verified;
7. namespace/data-scope permission verified.

Only after gate 7 may application data be exchanged.

## iroh direction

Current official iroh documentation describes an `Endpoint` as the main connection interface, with encrypted/authenticated connections over QUIC and relay fallback. It recommends a single endpoint instance per application. Public relays are suitable for development/hobby use; production should use dedicated/self-hosted relay infrastructure.

`iroh-docs` is a CRDT-backed key-value synchronization protocol. It may be useful, but the platform must not adopt it merely because it exists: the application requires tenant authorization, audit, transaction coupling, tombstones and domain conflict semantics. A research gate must compare a custom operation log, iroh-docs, and a hybrid design before committing.
