# ADR-025: Strict Organisation Isolation and Cross-Tenant Governance

## Status
Accepted

## Context
The platform is inherently multi-tenant. Devices and users operate within designated organisations. In multi-tenant environments, cross-tenant data leakage or accidental cross-organisation queries present critical security vulnerabilities.

## Decision
1. **Mandatory Tenant Scoping**: All tenant-owned repositories and domain queries must explicitly require `organisationId`.
2. **Deny-by-Default Cross-Organisation Mutation**:
   - Every service mutation must enforce that target entities belong to the caller's authorized organisation.
   - Cross-tenant requests (e.g., creating a user or widget in an organisation other than the caller's active context) are strictly rejected with authorization errors.
3. **Explicit Administrative Exceptions**:
   - Cross-organisation visibility (e.g. system administration) requires explicit, high-privilege permissions (e.g. `organisations.manage`) verified by the central `AuthorizationEngine`.
   - Every cross-tenant operation generates an attributed audit event in `core_audit_events`.

## Consequences
- Total isolation between distinct organisations sharing a single device database.
- Repository layer prevents accidental un-scoped table scans (`findAll()`).
- Verified by regression test suites: `tests/security/tenant-isolation.test.ts` and `tests/security/rbac-security.test.ts`.
