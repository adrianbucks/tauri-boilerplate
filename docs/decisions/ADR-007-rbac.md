# ADR-007: Scoped Role-Based Access Control (RBAC) Engine

## Status

Accepted

## Context

Local-first applications require robust authorization that works in offline environments. The system needs to support:

1. Role-to-permission mappings loaded from local SQLite tables.
2. Multidimensional scope constraints (e.g. restricting permissions by `organisationId`, `syncGroupId`, or `warehouseId`).
3. Explicit denial handling with structured `AuthorizationError` exceptions and error codes.
4. Complete avoidance of hardcoded role checks in UI or domain feature code.

## Decision

We implement `@platform/authorization` with a decoupled `AuthorizationEngine` and `ScopeEvaluator`:

1. **Permissions as Strings**:
   - Hierarchical namespaced strings (e.g., `organisations.read`, `widgets.create`, `devices.approve`).
   - Wildcard (`*`) support for administrator superuser roles.

2. **Scope Evaluation (`ScopeEvaluator`)**:
   - JSON-encoded scope constraints (`scope_constraints_json`) attached to role-permission mappings.
   - Exact matching on multidimensional attributes (`warehouseId`, `organisationId`, `syncGroupId`).

3. **Public API Contract**:
   - `can(subject, permission, resourceScope?): Promise<AuthorizationDecision>` returns `{ granted: true }` or `{ granted: false, reason, code }`.
   - `require(subject, permission, resourceScope?): Promise<void>` throws a typed `AuthorizationError` on denial.

## Invariant

No domain code or UI component may evaluate `if (user.role === 'admin')`. All checks must execute through `authorization.can()` or `authorization.require()`.
