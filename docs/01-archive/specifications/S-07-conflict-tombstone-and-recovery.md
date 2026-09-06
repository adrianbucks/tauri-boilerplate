# S-07 --- Conflict, Tombstone and Recovery

**Status:** Draft pending sync spike\
**Priority:** P0

## Objective

Make multi-device offline mutation deterministic and safe.

## Policies

Every syncable entity must declare a conflict policy: LWW,
immutable/reject, append-only, additive-delta, custom merge or human
resolution.

## Critical rule

Do not sum replicated absolute values for additive conflicts. Replicate
deltas/operations when the domain represents increments/decrements.

## Tombstones

Delete operations create and replicate stable deletion metadata
including `deletedAt`, `deletedBy` and `deleteOperationId`.

## Garbage collection

Tombstones may be collected only when replication safety proves that
eligible peers cannot reintroduce the deleted object.

## Recovery

Restore/new-device bootstrap must authenticate identity, reconcile
operations, rebuild local state and verify invariants.

## Tests

Concurrent updates, delete/update races, duplicate delivery,
out-of-order delivery, long offline periods, peer rejoin and database
restore.
