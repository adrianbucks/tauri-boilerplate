# Focused Implementation Plan: Native Interactive Transactions

**Status:** Design required; no transaction semantics changed.

## Problem

`NativeDatabaseConnection.transaction()` executes its TypeScript callback before sending the queued operations to Rust. This supports atomic write batches, but it cannot return query results from the native transaction to the callback. `TransactionClient.query()` therefore rejects calls. The memory adapter supports interactive reads, so code may pass tests there while failing through the production native adapter.

Affected workflows include organisation creation/update, identity administration, widgets, notes, sync-group membership, pairing, and plugin-defined imports. Several perform authorization, tenant-scoped reads, or stale-state checks inside their transaction. Moving those reads outside the transaction is not an acceptable compatibility workaround.

## Contract to preserve

- Keep the existing write-only transaction batch behavior available to migrations and operations that need no intermediate results.
- Do not claim that a queued write has executed or provide a speculative `rowsAffected` value inside the callback.
- Keep authorization and tenant-scoped state checks in the same atomic boundary as the state transition.
- Preserve nested savepoint semantics, rollback on callback failure, and transaction-client lifetime checks.
- Do not widen the renderer's generic SQL IPC access as part of enabling interactive transactions. The generic `db_query`, `db_execute`, and `db_transaction` command authorization issue remains a separate security gate.

## Design decision required

Compare these approaches before implementation:

1. **Native interactive transaction session:** Rust creates a transaction identified by an unguessable session token. Subsequent scoped query/execute/savepoint calls use that token; commit and rollback close it. The connection must reject or serialize unrelated operations until the transaction ends. The design must handle callback exceptions, IPC errors, renderer teardown, cancellation, bounded lifetime, and app shutdown without leaving a transaction open.
2. **Typed atomic operations:** Keep generic callbacks write-only and add narrowly scoped native commands for workflows that require read/validate/write semantics. Each command owns the full authorization and transaction boundary. This avoids a generic interactive SQL surface, but requires an application/platform boundary decision for every consumer and does not automatically support arbitrary plugin commit callbacks.

Do not combine the approaches implicitly. Any selected design must be reviewed against the generic SQL IPC and trusted-context provenance findings before exposing new commands to renderer code.

## Implementation stages

1. **Select the boundary:** Decide whether the generic transaction API is permitted in the renderer at all. Map each affected consumer to either a typed native operation or the interactive session API. Record command-level permissions and trusted identity provenance.
2. **Specify lifecycle and concurrency:** Define begin/read/write/savepoint/commit/rollback states, token ownership, serialization behavior, timeouts, cancellation, process teardown, and error mapping. Ensure a failed callback always attempts rollback and a stale token can never address a later transaction.
3. **Implement native primitives:** Add the Rust state machine and bounded IPC payload/result validation. Keep all SQL parameterized; enforce request, result, operation, and duration budgets. Do not hold a Rust mutex guard across an asynchronous boundary.
4. **Implement the TypeScript adapter:** Extend `TransactionClient` only after native semantics are defined. Keep callback clients scoped and reject use-after-close. Preserve memory-adapter parity and nested savepoint rollback behavior.
5. **Migrate consumers by slice:** Start with organisation create/update, then identity and membership workflows, then widgets/notes/pairing, and finally audit plugin-defined import callbacks. Each slice retains its existing permission, tenant, audit, and atomicity guarantees.
6. **Validate failure behavior:** Exercise native-adapter reads-after-writes, concurrent transactions, cancellation, stale tokens, nested rollback, renderer/native failure, lock contention, and rollback of audit/domain changes. Add security regressions under `tests/security/` for any authorization boundary change.
7. **Reconcile docs and release gates:** Update the transaction contract, native command boundary, downstream-adoption guide, and acceptance gates only after production-driver behavior is verified.

## Acceptance criteria

- Organisation create/update and the other identified consumers work against the production native adapter without moving isolation-sensitive reads outside their transaction boundary.
- Concurrent callers cannot interleave statements into another caller's transaction or observe its uncommitted state.
- Every failure path either commits the full operation or rolls it back; no partial domain/audit/outbox state remains.
- Renderer-facing commands cannot use the transaction mechanism to bypass native authentication, authorization, or tenant scoping.
- The memory adapter and native adapter have documented, matching transaction guarantees for the supported API.
- The write-only batch contract remains explicit for consumers that do not need interactive reads.

## Current verification

The production limitation is confirmed by `NativeDatabaseConnection.transaction()` and `TransactionClient` documentation. Consumer inventory and affected feature workflows are recorded in [the platform package review](./review-platform-packages.md) and [the feature/application review](./review-features-and-apps.md). No implementation or runtime behavior changed in this plan slice.
