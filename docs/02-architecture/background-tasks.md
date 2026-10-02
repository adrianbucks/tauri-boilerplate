# Background Tasks & Durable Workers

## Current Implementation

**Status**: ✅ Durable SQLite task queue, concurrent worker pool, outbox replication worker, and jittered exponential backoff implemented and verified.

The background task subsystem is implemented in `packages/tasks` (`@platform/tasks`) with 33 unit and integration tests passing:

- **Durable Task Queue (`TaskQueueService`)**:
  - Tasks persist across application lifecycles in SQLite (`core_background_tasks` table).
  - State transitions: `PENDING` → `RUNNING` → `COMPLETED` / `FAILED` / `CANCELLED`.
  - Concurrency management, priority-based ordering, scheduled-at delays, and unique task deduplication keys.
- **Task Worker (`TaskWorker`)**:
  - Asynchronous polling loop leasing tasks atomically.
  - Handles timeouts with `AbortSignal` cooperative cancellation.
  - Dispatches typed payloads to registered `TaskHandler<TPayload>` instances.
- **Outbox Replication Worker (`OutboxSyncWorker`)**:
  - Dedicated worker polling pending batches from `core_sync_outbox`.
  - Dispatches operations via `SyncTransport`, processes acknowledgements, updates HLC watermarks, and applies exponential backoff on transport errors.
- **Exponential Backoff with Full Jitter (`BackoffPolicy`)**:
  - Configurable exponential backoff formula: $t_{delay} = \min(t_{max}, t_{base} \times 2^{attempt}) \pm jitter$. Eliminates thundering-herd spikes during reconnects.

### Test Evidence

```bash
pnpm --filter @platform/tasks test
# ✓ TaskQueueService: enqueue, deduplicate, lease, complete, fail, retry
# ✓ TaskWorker: polling, execution, cancellation token abort, timeout
# ✓ OutboxSyncWorker: batch retrieval, dispatch, ack marking, backoff
# ✓ BackoffPolicy: exponential calculation, jitter bounds, max limit
# 33 passed (100% pass rate)
```

---

## Architecture & Principles

Background work is a **durable platform concern**, never an ephemeral React component lifecycle concern:

```
               Application / UI / Service
                          │
                   enqueue(definition)
                          ▼
             ┌─────────────────────────┐
             │ core_background_tasks   │ (SQLite WAL)
             │   state = 'PENDING'     │
             └────────────┬────────────┘
                          │
                 leaseNext() [Atomic]
                          ▼
             ┌─────────────────────────┐
             │       TaskWorker        │
             │   state = 'RUNNING'     │
             └────────────┬────────────┘
                          │
               ┌──────────┴──────────┐
               │                     │
           Success                 Error
               ▼                     ▼
      state = 'COMPLETED'     attempt < maxAttempts ?
                               ├── Yes: state = 'PENDING', scheduledAt = now + backoff
                               └── No:  state = 'FAILED', lastError = msg
```

### Core Invariants

1. **At-Least-Once Execution**: A task will run to completion or fail its maximum attempts. Process crashes during execution leave leases that expire and get reclaimed.
2. **Idempotency**: All task handlers must be idempotent or use deduplication keys (`uniqueKey`).
3. **Cooperative Cancellation**: Handlers receive an `AbortSignal` and must abort long operations when signaled.
4. **Tenant Isolation**: Tasks are bound to an `organisationId`. Workers operate within explicit tenant scopes.
5. **No Webview Dependency**: The task queue operates independently of whether any specific UI view is mounted.

---

## Core Type Definitions

```typescript
// packages/tasks/src/types.ts

export type TaskState =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface TaskRetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly backoffMultiplier: number;
  readonly maxDelayMs: number;
  readonly jitter: number; // e.g. 0.25 = ±25%
}

export const DEFAULT_RETRY_POLICY: TaskRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  backoffMultiplier: 2.0,
  maxDelayMs: 60_000,
  jitter: 0.25,
};

export interface TaskDefinition<TPayload = unknown> {
  readonly taskType: string;
  readonly uniqueKey?: string;
  readonly payload: TPayload;
  readonly scheduledAt?: string; // ISO-8601 UTC
  readonly retryPolicy?: Partial<TaskRetryPolicy>;
  readonly timeoutMs?: number;
  readonly organisationId: string;
  readonly userId?: string;
  readonly correlationId: string;
}

export interface TaskRecord<TPayload = unknown> {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly taskType: string;
  readonly uniqueKey: string | null;
  readonly organisationId: string;
  readonly userId: string | null;
  readonly payload: TPayload;
  readonly state: TaskState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly backoffMultiplier: number;
  readonly maxRetryDelayMs: number;
  readonly scheduledAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
  readonly lastError: string | null;
  readonly timeoutMs: number;
}
```

---

## Task Handler Registration

Task handlers implement `TaskHandler<TPayload>` and are registered on the `TaskWorker`:

```typescript
// packages/tasks/src/worker/TaskHandler.ts
export interface TaskExecutionContext {
  readonly taskId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly correlationId: string;
}

export interface TaskHandler<TPayload = unknown> {
  readonly taskType: string;
  execute(payload: TPayload, ctx: TaskExecutionContext): Promise<void>;
}
```

### Example: Registering a Maintenance Task

```typescript
import { TaskWorker, TaskQueueService } from "@platform/tasks";

const worker = new TaskWorker(taskQueueService, {
  pollIntervalMs: 2000,
  concurrency: 4,
});

worker.registerHandler({
  taskType: "maintenance.cleanup_tombstones",
  async execute(payload: { olderThanDays: number }, ctx) {
    if (ctx.signal.aborted) return;
    await repository.purgeOldTombstones(payload.olderThanDays);
  },
});

await worker.start();
```

---

## Outbox Sync Worker

The `OutboxSyncWorker` is a specialized background worker responsible for reliable, ordered P2P data synchronization:

```
┌──────────────────┐
│ core_sync_outbox │
└────────┬─────────┘
         │ 1. Lease pending batch (LIMIT 50, ordered by HLC)
         ▼
┌──────────────────┐
│ OutboxSyncWorker │
└────────┬─────────┘
         │ 2. Check peer connection & active session
         │ 3. Build CanonicalSyncEnvelope
         │ 4. Send via Native iroh QUIC stream
         │ 5. Await 1-byte ACK from peer
         ▼
┌──────────────────┐
│ Ack Received?    │
├────────┬─────────┤
│ Yes    │ No      │
▼        ▼         ▼
Mark ACK Apply backoff delay, keep in outbox for retry
```

### Sync Step Contract

A sync task execution strictly adheres to the following sequence:

1. **Load Bounded Batch**: Fetch up to $N$ pending records from `core_sync_outbox`.
2. **Verify Authorization**: Confirm local device is active and not revoked.
3. **Transport Check**: Reuse established `SyncTransport` or connect to target peer.
4. **Handshake Verification**: Confirm mutual Ed25519 identity handshake and shared sync group membership.
5. **Namespace Filter**: Transmit envelopes only for namespaces authorised for that sync group.
6. **Transactional Ack**: On peer acknowledgement, mark rows as dispatched (`sent_at`, `peer_ack = true`).
7. **Cursor Update**: Update sync progress vector clock in `core_sync_cursors`.

---

## Platform Adapters

### Android (WorkManager)

- On Android, background work must survive app suspension and system process termination.
- Android uses **WorkManager** to schedule persistent background sync tasks.
- Constraints configured:
  - NetworkType: `CONNECTED` or `UNMETERED`
  - BatteryNotLow: `true`
- Long-running sync operations transition to a Foreground Service with an active notification.
- SQLite remains in a clean state if the OS kills the process mid-task; incomplete batches are automatically re-leased on next startup.

### Windows (Desktop Background Tasks & System Tray — WP-016b)

- **System Tray Minimization**: On Windows, the main window `CloseRequested` event is intercepted via `on_window_event`. It calls `api.prevent_close()` followed by `window.hide()`, preventing process termination when the user closes the window.
- **Native Runtime Continuity**: The native Rust Tokio runtime and `background-core::OutboxScheduler` remain active in the background, continuously driving outbox replication checks without requiring a visible webview.
- **Tray Context Menu**:
  - `Show`: Restores and focuses the main window (`window.show()`, `window.set_focus()`).
  - `Sync Now`: Emits `background://sync-now-requested` over the native IPC event bus (carrying only a UTC timestamp, adhering to Invariant #5) to trigger an immediate batch sync.
  - `Quit`: The sanctioned process exit path (`app.exit(0)`), ensuring background schedulers release leases gracefully before termination.
- **Left-Click Restore**: Left-clicking the tray icon restores and focuses the window.
- **Bootstrap Lifecycle**: `OutboxSyncWorker` is initiated during platform bootstrap (`usePlatform` hook), decoupled from individual UI view lifecycles.
- **Security Validation**: Dedicated regression suite `tests/security/windows-tray-lifecycle.test.ts` validates that no private key material leaks into tray events and least-privilege capability boundaries are maintained.

---

## Failure Recovery & Retry Strategy

| Error Class                | Example                          | Handling Strategy                                                          |
| :------------------------- | :------------------------------- | :------------------------------------------------------------------------- |
| **Transient Network**      | QUIC connection reset, timeout   | Retry with exponential backoff + jitter up to `maxAttempts`.               |
| **Authentication Expired** | Session token expired            | Pause worker queue; emit re-authentication event; do not discard task.     |
| **Permanent Protocol**     | Envelope schema version mismatch | Fail immediately (`state = 'FAILED'`); emit alert; never retry infinitely. |
| **Authorisation Denied**   | Device removed from sync group   | Mark task `FAILED`; trigger peer disconnection; do not retry.              |
| **Database Busy**          | SQLite `SQLITE_BUSY` (WAL lock)  | Immediate micro-backoff (50ms) and retry up to 5 times.                    |

---

## Security Invariants

- **Credential Hygiene**: Task payloads must NEVER contain private keys, passwords, or raw auth tokens.
- **Tenant Scope**: Every query in `TaskQueueService` filters by `organisationId` where applicable.
- **Audit Logging**: Task failures exceeding retry limits generate an `AuditEvent` with `eventType: 'TASK_EXHAUSTED'`.
