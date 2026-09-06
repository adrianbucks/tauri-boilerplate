# Background Tasks

## Target model

Background work is a durable platform concern, not a React component concern.

```text
Task
├── id
├── type
├── unique key
├── state
├── attempt
├── constraints
├── retry policy
├── timeout/deadline
├── created/started/completed timestamps
└── correlation id
```

Tasks must be idempotent, interruptible, resumable where practical and observable.

## Sync worker

A sync task should:

1. load a bounded outbox batch;
2. verify current device/session/revocation state;
3. establish/reuse native transport;
4. perform authenticated handshake;
5. exchange only authorised namespaces;
6. apply bounded inbound work transactionally;
7. mark outbound operations acknowledged;
8. persist diagnostics/cursors;
9. schedule/retry according to policy.

Do not rely on a permanently alive webview.

## Android

Android currently recommends WorkManager for persistent background work. It persists scheduled work across app restarts/reboots and supports constraints, retries and unique work. Long-running work may require foreground execution/notification.

The platform adapter must be lifecycle-safe: process death during a sync operation must leave durable state that can be resumed without duplicate business effects.

## Windows

Windows implementation must use native lifecycle/scheduling mechanisms appropriate to the supported deployment model. The design must not assume the Tauri webview is running when maintenance/sync is expected to continue.

## Retry

Use bounded exponential backoff with jitter for transient network failures. Do not retry permanent authorization, schema or protocol incompatibility failures as if they were network errors.

## Testing

Test process termination, reboot, network loss, duplicate scheduling, retry exhaustion, cancellation, credential/device revocation while queued, migration-in-progress and partially applied batches.
