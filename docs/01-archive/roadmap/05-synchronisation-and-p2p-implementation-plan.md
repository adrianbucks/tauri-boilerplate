# Synchronisation and P2P Implementation Plan

## Current state

The repository defines sync types, a state machine, pairing
abstractions, HLC, conflict policies and test harnesses. The actual iroh
transport and durable replication pipeline are not yet production
implementations.

## Target architecture

```text
SQLite business state
       ↕
Atomic sync operation log
       ↕
Sync engine
       ↕
Authorisation + crypto
       ↕
iroh transport
       ↕
Remote sync engine
       ↕
Remote SQLite
```

## 1. Architecture decision gate

Before implementing the final replication layer, complete the existing
iroh-docs research questions.

Choose explicitly:

- iroh-docs;
- custom operation log;
- hybrid.

The platform boundary should remain stable regardless of the choice.

## 2. Operation log

If custom/hybrid replication is selected, implement a durable operation
log.

Suggested fields:

```text
operation_id
application_id
organisation_id
sync_group_id
feature_id
entity_type
entity_id
operation_type
payload
author_id
device_id
hlc
schema_version
protocol_version
signature
created_at
state
```

`operation_id` must be globally unique and indexed.

## 3. Atomic mutation

Synchronisable business changes must write their replication operation
in the same SQLite transaction as the business mutation.

This prevents:

```text
business row committed
sync operation missing
```

and:

```text
sync operation committed
business row missing
```

## 4. Outbound queue

Implement durable states:

```text
PENDING
PROCESSING
SENT
ACKNOWLEDGED
FAILED
QUARANTINED
```

Requirements:

- retry with bounded backoff;
- crash recovery;
- peer-specific cursors;
- batching;
- backpressure;
- diagnostics.

## 5. Inbound pipeline

Never apply an incoming operation directly.

Required pipeline:

```text
receive
  ↓
decode
  ↓
protocol validation
  ↓
signature verification
  ↓
organisation validation
  ↓
device authentication
  ↓
sync-group membership
  ↓
namespace/data scope
  ↓
schema validation
  ↓
idempotency check
  ↓
conflict evaluation
  ↓
SQLite transaction
  ↓
audit
  ↓
ACK
```

## 6. Idempotency

Persist received operation IDs.

A duplicate must result in:

```text
already_applied
```

and never a second mutation.

## 7. HLC

Persist HLC state across restarts and establish a canonical
cross-language format.

Required:

- TS/Rust conformance tests;
- clock rollback tests;
- malformed input tests;
- future timestamp limits;
- deterministic ordering.

## 8. Conflict policies

Conflict policy belongs to the feature/entity definition.

Do not apply generic arithmetic to arbitrary absolute values.

Prefer operation semantics such as:

```text
increment quantity by +5
decrement quantity by -2
```

rather than:

```text
quantity = 105
quantity = 98
```

for additive domains.

Policies should include explicit semantics for:

- LWW;
- append-only;
- immutable;
- additive/delta;
- manual;
- CRDT where genuinely required.

## 9. Tombstones

Synchronisable deletion must produce durable deletion metadata.

Tombstones need:

- operation ID;
- author;
- timestamp;
- retention policy;
- replication status.

Garbage collection must only occur after proving that relevant peers can
no longer resurrect the deleted entity.

## 10. Transport

Implement actual iroh connectivity:

- node lifecycle;
- discovery;
- direct connection;
- relay fallback;
- connection authentication;
- streams;
- graceful disconnect;
- reconnect;
- Android compatibility.

## 11. Convergence tests

Use at least two real application instances and eventually Windows +
Android.

Test:

- online writes;
- offline writes;
- concurrent writes;
- duplicate delivery;
- out-of-order delivery;
- packet interruption;
- reconnect;
- revocation;
- tombstone propagation;
- schema mismatch;
- large datasets.

A simulation-only harness must not be used as proof of production
convergence.
