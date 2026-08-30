# ADR-008: Append-Only Audit Event Subsystem

## Status

Accepted

## Context

Enterprise compliance and local-first tamper evidence require tracking significant business and security actions (e.g. user creation, role assignment, device approval, sync membership changes, import/export operations) with high fidelity and zero data loss.

## Decision

We implement `@platform/audit` as an append-only subsystem on top of SQLite table `core_audit_events`:

1. **Immutability Invariant**:
   - `core_audit_events` supports `INSERT` and `SELECT` only.
   - `UPDATE` and `DELETE` queries are strictly forbidden.

2. **Atomic Attribution**:
   - Every event must record `id`, `eventType`, `userId`, `deviceId`, `organisationId`, `correlationId`, `timestamp` (UTC ISO 8601), and optional `metadataJson`.
   - `AuditService.emit()` participates in surrounding database transactions (`tx`), ensuring business mutations and audit logs commit or roll back atomically together.

3. **Catalogue of Standard Events**:
   - `USER_CREATED`, `USER_UPDATED`, `USER_SUSPENDED`
   - `ROLE_ASSIGNED`, `ROLE_REVOKED`
   - `DEVICE_REGISTERED`, `DEVICE_APPROVED`, `DEVICE_REVOKED`
   - `MEMBERSHIP_REQUESTED`, `MEMBERSHIP_DECIDED`
   - `IMPORT_STARTED`, `IMPORT_COMPLETED`, `IMPORT_FAILED`
   - `SYNC_STARTED`, `SYNC_COMPLETED`, `SYNC_FAILED`
