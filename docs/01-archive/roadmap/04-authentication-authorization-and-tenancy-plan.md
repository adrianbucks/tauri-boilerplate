# Authentication, Authorization and Tenancy Implementation Plan

## Current state

The repository has an authorization engine, scope evaluator, sync-group
service and session abstractions. They are valuable foundations, but
authentication and tenant isolation need to become authoritative rather
than caller-supplied.

## Target model

```text
Authenticated User
       +
Authenticated Device
       +
Organisation Membership
       +
Role Assignment
       +
Permission
       +
Resource Scope
       ↓
Authorised OperationContext
```

## 1. Authentication

A session must not accept roles or privileges as trusted caller input.

The serverless/local-first model still requires proof of identity:

- authenticated user;
- authenticated device;
- active membership;
- session validity;
- device status.

The exact user authentication mechanism must be selected for the
application's deployment model. The platform should provide the session
contract without hard-coding one business authentication provider.

## 2. Operation context

Every service operation should receive a trusted context containing:

```ts
interface OperationContext {
  userId: string;
  deviceId: string;
  organisationId: string;
  sessionId: string;
  correlationId: string;
}
```

Context values must originate from authenticated platform state.

## 3. Tenant isolation

Every tenant-sensitive query must be scoped to the organisation.

Do not rely on the caller remembering to add:

```sql
WHERE organisation_id = ?
```

Provide repository helpers and/or transaction context that make tenant
scoping mandatory.

Validate:

- role belongs to organisation;
- membership belongs to organisation;
- device belongs to organisation;
- sync group belongs to organisation;
- resource belongs to organisation.

## 4. RBAC

Use permission names rather than hard-coded roles:

```ts
authorization.require("inventory.read", {
  warehouseId,
});
```

Permissions should support resource scopes such as:

```text
organisation
warehouse
department
record
sync-group
```

## 5. Sync authorization

Separate:

```text
Can user perform operation?
```

from:

```text
Can device/peer receive replicated data?
```

Both must be true where appropriate.

## 6. Revocation

Revocation must affect:

- new sessions;
- pairing;
- new connections;
- active sync sessions;
- data transmission;
- future operation acceptance.

Define whether an already-authorised connection is terminated
immediately or allowed to drain.

## 7. Security gates

Required tests:

- cross-organisation role cannot grant permission;
- cross-organisation resource cannot be accessed;
- revoked device cannot sync;
- suspended user cannot perform operations;
- expired session cannot perform operations;
- unapproved sync-group member cannot receive data;
- namespace outside scope is rejected;
- privilege escalation through caller-supplied roles is impossible.
