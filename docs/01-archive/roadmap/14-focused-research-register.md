# Focused Research Register

This register identifies questions that should be researched and
experimentally verified before committing to high-risk implementation.

## R-001 --- iroh-docs versus custom operation log

Determine whether iroh-docs provides the required:

- namespace partitioning;
- selective replication;
- revocation behaviour;
- historical access controls;
- authorship verification;
- offline merge;
- conflict semantics;
- SQLite interoperability;
- scale;
- Android memory profile;
- tombstone handling.

**Decision output:** ADR and working prototype.

## R-002 --- iroh Android support

Verify:

- API 35;
- background behaviour;
- lifecycle;
- NAT traversal;
- relay fallback;
- battery impact;
- network changes.

## R-003 --- SQLite Rust integration

Compare suitable Rust SQLite libraries and Tauri integration options.

Evaluate:

- WAL;
- migrations;
- concurrency;
- bundled SQLite;
- Android support;
- performance;
- licensing;
- backup;
- encryption options if later required.

## R-004 --- Secure key storage

Compare:

- Windows DPAPI;
- Windows Credential Manager;
- Stronghold or equivalent;
- Android Keystore;
- platform key APIs.

Document guarantees and failure/recovery behaviour.

## R-005 --- User authentication model

The platform is offline/local-first, so determine how user
authentication should work without imposing a central server.

Potential models to research:

- local credential;
- administrator-issued device/user credentials;
- organisation bootstrap;
- external identity provider plus local cached session;
- device-bound authentication.

## R-006 --- Conflict semantics

Research domain-neutral conflict semantics.

Particular attention:

- additive counters;
- inventory quantities;
- state machines;
- immutable records;
- append-only events;
- manual resolution.

## R-007 --- Tombstone garbage collection

Define safe GC conditions in an intermittently connected peer network.

## R-008 --- Large dataset sync

Benchmark:

- 10k;
- 100k;
- 1M records;

on Windows and Android.

Measure:

- initial sync;
- incremental sync;
- memory;
- storage;
- battery;
- query performance.

## R-009 --- Payload schema/versioning

Research canonical serialization and validation.

Need:

- deterministic signing;
- schema compatibility;
- evolution;
- unknown fields;
- downgrade protection.

## R-010 --- Application/plugin model

Determine whether the repository should remain a monorepo template only
or evolve toward installable platform packages.

The initial recommendation is to preserve a straightforward
copy/template model and avoid unnecessary runtime plugin complexity.
