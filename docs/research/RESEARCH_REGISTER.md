# Research Register

Research is a controlled engineering activity. Each item must end in a decision, explicit deferral or a reproducible proof-of-concept.

## R-001 — Cryptographic device identity and platform key custody

**Status:** WINDOWS EVIDENCE COMPLETE; ALGORITHM/POC GATE OPEN — see [R-001](./R-001-device-identity-key-custody.md)

Questions:

- Can the required signing algorithm remain non-exportable on Windows and Android?
- Can the chosen iroh API use a signer abstraction or must transport keys be application-managed?
- What key storage APIs and hardware backing are available on the supported OS/API matrix?
- How should user authentication keys differ from transport/device keys?

Deliverable: spike + ADR + integration test.

## R-002 — Replication substrate

**Status:** REQUIRED ARCHITECTURAL GATE

Compare:

1. custom signed operation log over iroh;
2. iroh-docs;
3. hybrid operation-log + iroh blobs/docs.

Evaluate transaction coupling, authorization, schema evolution, conflicts, large objects, recovery, performance and Android lifecycle.

## R-003 — Handshake and replay protocol

**Status:** REQUIRED

Define canonical encoding, signature input, nonce/freshness, clock-skew tolerance, protocol negotiation, peer binding, rejection semantics and downgrade policy.

## R-004 — Android background sync

**Status:** REQUIRED

Validate WorkManager constraints, process death, reboot, network availability, long-running work and native iroh lifecycle.

## R-005 — Windows background execution

**Status:** REQUIRED

Select the supported Windows scheduling/lifecycle model and prove sync/maintenance can recover without a visible webview.

## R-006 — Database encryption

**Status:** DEFERRED

Storage abstraction must permit future encryption without leaking key material. Do not add encryption merely as a checkbox; define key hierarchy, backup/recovery and migration semantics first.

## R-007 — Conflict semantics

**Status:** REQUIRED PER DOMAIN

Every synchronisable entity/field must declare whether it is immutable, LWW-safe, additive/delta, append-only, manual or CRDT.

## R-008 — Large objects

**Status:** REQUIRED BEFORE LARGE PAYLOADS

Define blob size threshold, storage, retention, hashing, authorization, encryption and cleanup.

## R-009 — Production relay infrastructure

**Status:** REQUIRED BEFORE PRODUCTION P2P

Public iroh relays are development/test infrastructure. Production requires dedicated/self-hosted relay policy, capacity, monitoring, residency and failure strategy.

## R-010 — Runtime plugin model

**Status:** DEFERRED

Default to statically compiled/build-time features. Runtime third-party plugins require a separate threat model and capability isolation design.

## R-011 — Offline authentication and credential verification

**Status:** VERIFIER PROTOTYPE IMPLEMENTED; INTEGRATION REQUIRES SECURITY REVIEW

Define Argon2id parameters, credential storage, native verification, lockout,
recovery and session issuance before changing authentication code. See
[R-011](./R-011-offline-authentication.md).
