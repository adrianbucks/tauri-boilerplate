# S-05 --- Synchronisation Operation Log

**Status:** Research required / protocol spike\
**Priority:** P0

## Objective

Implement durable immutable replication operations.

## Envelope

```text
operationId
applicationId
organisationId
syncGroupId
featureId
entityType
entityId
operationType
payload
authorId
deviceId
logicalTimestamp
schemaVersion
protocolVersion
signature
createdAt
```

## Storage

Create a dedicated operation table. Do not use `core_sync_sessions` as
an operation queue.

Outbound states should include pending, sending, acknowledged and
failed. Inbound processing requires applied-operation/idempotency state
and quarantine for invalid operations.

## Atomicity

`BEGIN -> business mutation -> append operation -> COMMIT`

## Idempotency

Validate, authenticate and authorize an inbound operation before
applying it. Record its operation ID atomically with the mutation.

## Retry

Use bounded exponential backoff with jitter. Security/validation
failures are quarantined.

## Tests

Duplicate delivery, out-of-order operations, restart recovery, network
failure, unauthorized operation, malformed payload and atomic
mutation/operation behaviour.

## Acceptance criterion

A syncable business mutation cannot report success while its outbound
operation is absent.
