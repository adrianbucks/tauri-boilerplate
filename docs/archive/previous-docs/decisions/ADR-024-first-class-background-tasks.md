# ADR-024: First-Class Durable Background Tasks and Replication Workers

## Status
Accepted

## Context
Replication, outbox queue draining, cache compaction, and audit maintenance are background concerns that must not depend on React component lifecycles or permanently open webviews. If an application process crashes or is suspended by the operating system, queued operations must not be lost or double-executed.

## Decision
1. Introduce a dedicated durable task platform package: `@platform/tasks`.
2. Persist task state durably in SQLite (`core_tasks` table) supporting:
   - Atomic state transitions: `queued` → `running` → `completed` or `failed`.
   - Priority queues, concurrency limits, and deduplication keys.
   - Exponential backoff with jitter (`BackoffPolicy`) to mitigate thundering herds.
3. Decouple replication worker execution: `OutboxSyncWorker` periodically polls bounded batches from `core_sync_outbox`, communicates with `SyncTransport`, updates cursors, and marks completed operations.
4. Define native OS lifecycle hooks:
   - For Android: Bridge via Android WorkManager native plugins (WP-016a).
   - For Windows: Bridge via native background scheduling / service integration (WP-016b).

## Consequences
- Clean separation between UI state and asynchronous background operations.
- Crash resilience: interrupted tasks are safely retried upon application restart according to backoff policy.
- Verified by 33 unit and integration tests in `@platform/tasks`.
