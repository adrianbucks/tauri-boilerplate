# Implementation Specifications

These specifications are the executable planning contracts for major platform capabilities. Each must be converted into tests before the capability is considered complete.

## S-01 — Durable local database

**Inputs:** app identity, storage configuration.

**Guarantees:** durable SQLite, explicit FK/journal configuration, migrations, integrity checks, transaction semantics.

**Failure:** fail closed on migration/integrity errors; never silently create a new empty production database when an existing database is unreadable.

## S-02 — Device identity

**Guarantees:** stable device identity, real cryptographic keypair, protected private key, native signing, rotation/revocation.

**Forbidden:** fabricated public keys, caller-selected device identity, private key IPC.

## S-03 — User authentication

**Guarantees:** credential/platform proof before session issuance, rate limiting, expiry and recovery.

## S-04 — Trusted authorization

**Guarantees:** principal derived from authenticated session/device state; permissions and scopes evaluated centrally; tenant isolation mandatory.

## S-05 — Feature lifecycle

**Guarantees:** deterministic manifest validation, dependency ordering, feature-owned migrations and permissions.

## S-06 — Native IPC

**Guarantees:** typed commands, narrow capabilities, input validation and no arbitrary SQL/filesystem/shell authority.

## S-07 — Sync envelope

**Guarantees:** deterministic serialization, versioning, namespace binding, author/device attribution and signature verification.

## S-08 — Sync admission

**Guarantees:** all seven admission gates pass before application data exchange.

## S-09 — Replication durability

**Guarantees:** atomic local outbox creation, idempotent inbound apply, cursors, retry safety and crash recovery.

## S-10 — Conflict/deletion semantics

**Guarantees:** explicit policy per entity/field, deterministic convergence and tombstone-based deletion where synchronised.

## S-11 — Background execution

**Guarantees:** durable/retryable task state and platform-specific execution that survives normal app lifecycle interruptions.

## S-12 — Release assurance

**Guarantees:** supported toolchains, reproducible dependencies, signed artifacts, checksums/provenance and platform acceptance evidence.

## Specification lifecycle

A specification is complete only when:

1. implementation exists;
2. tests cover success and failure paths;
3. security impact is reviewed;
4. current-state verification is updated;
5. relevant ADR/research entries are updated.
