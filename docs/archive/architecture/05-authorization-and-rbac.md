# 08 — Authorisation and RBAC

| | |
| **Current** | Async `AuthorizationEngine` with persisted org-scoped role lookup, exact/`*` permission matching, and resource scope checks. Caller supplies `Subject`. |
| **Target** | Deny-by-default RBAC; services call `require()`; UI `can()` is display-only; engine consumes trusted authenticated context, not caller-assembled subjects. |
| **Remaining** | Trusted context, hierarchical scopes, universal service `require()`. [S-04](../specifications/S-04-authorization-engine.md). |

Keep deny-by-default, tenant-scoped role resolution, and security regressions. Treat role names on the caller as untrusted.

## Package: `packages/authorization`

```
packages/authorization/src/     ← current
├── index.ts
├── types.ts
├── engine/
│   ├── AuthorizationEngine.ts
│   └── ScopeEvaluator.ts
└── sync-group/
    └── SyncGroupService.ts
```

The API sketch below is the target contract. Live methods are `async` and still take a caller-assembled `Subject`.

---

## Core API

```typescript
// packages/authorization/src/index.ts

interface AuthorizationEngine {
  /**
   * Evaluate whether the subject has permission for the given action on the resource.
   * Returns a typed decision — does not throw.
   */
  can(
    subject: Subject,
    permission: PermissionName,
    resource?: ResourceScope,
  ): AuthorizationDecision;

  /**
   * Evaluate and throw AuthorizationError if denied.
   * Use this inside service methods where denial means the operation cannot proceed.
   */
  require(permission: PermissionName, resource?: ResourceScope): void;

  /**
   * Returns the effective permissions of the current session subject.
   * Used by UI to show/hide navigation items.
   */
  effectivePermissions(): EffectivePermissions;
}

type AuthorizationDecision =
  | { granted: true }
  | { granted: false; reason: string; code: AuthorizationDeniedCode };
```

---

## Permission naming convention

Permissions are hierarchical dot-separated strings. The convention is:

```
<resource>.<action>
<resource>.<sub-resource>.<action>
```

### Platform permissions (built-in)

```
users.read
users.create
users.update
users.delete

roles.read
roles.manage

devices.read
devices.approve
devices.revoke

sync.read
sync.request
sync.approve
sync.revoke

organisations.read
organisations.manage

audit.read
audit.export
```

### Feature permissions (registered by each feature)

```
inventory.read
inventory.create
inventory.update
inventory.delete
inventory.import
inventory.export

warehouse.read
warehouse.manage

barcode.scan
```

### Rules for permission names

- Always two parts minimum (`resource.action`)
- Use all lowercase with dots
- Avoid generic names: `is_admin`, `can_do_everything`, `warehouse_user`
- **Roles are collections of permissions; roles are not permissions**

---

## Scoped authorisation

A permission can be granted with a resource scope:

```typescript
// Can read inventory at any warehouse
can(user, "inventory.read");

// Can read inventory only at Coventry warehouse
can(user, "inventory.read", { warehouseId: "COV" });

// Can read inventory at any warehouse in organisation
can(user, "inventory.read", { organisationId: "org_abc" });
```

### Scope dimensions

Start with these three. Add more only when a real requirement exists:

| Dimension        | Database field                            | Description              |
| ---------------- | ----------------------------------------- | ------------------------ |
| `organisationId` | `core_user_roles.organisation_id`         | Limits to a specific org |
| `syncGroupId`    | `core_role_permissions.scope_constraints` | Limits to sync group     |
| `warehouseId`    | Feature-level scope                       | Limits to a warehouse    |

Future scope dimensions (do not implement now):

- `siteId`, `departmentId`, `entityId`, `recordId`

### Scope resolution rule

A permission is granted if **any** role assignment for the subject matches both:

- The permission name (exact or hierarchical parent match)
- The resource scope constraints (scoped grants must be at least as specific as the request)

Example:

- Subject has `inventory.read` scoped to `{ warehouseId: 'COV' }`
- Request is `can(subject, 'inventory.read', { warehouseId: 'BHM' })` → **DENIED**
- Request is `can(subject, 'inventory.read', { warehouseId: 'COV' })` → **GRANTED**
- Request is `can(subject, 'inventory.read')` (no scope) → **DENIED** (unscoped request against scoped grant)

---

## Feature code rules

### Never do this

```typescript
// ❌ FORBIDDEN in any feature code
if (user.role === 'admin') { ... }
if (user.roles.includes('manager')) { ... }
if (session.userId === ownerId) { ... }
```

### Always do this

```typescript
// ✅ CORRECT — use the authorization service
this.auth.require("inventory.update", { warehouseId: warehouse.id });

// or check without throwing:
const decision = this.auth.can(subject, "inventory.delete", {
  warehouseId: warehouse.id,
});
if (!decision.granted) {
  return { error: decision.reason };
}
```

---

## Sync groups

Sync groups are the primary mechanism for scoping which data a device participates in.

### Sync group service

```typescript
interface SyncGroupService {
  createGroup(
    input: CreateGroupInput,
    ctx: OperationContext,
  ): Promise<SyncGroup>;
  inviteMember(
    groupId: string,
    deviceId: string,
    ctx: OperationContext,
  ): Promise<void>;
  requestMembership(
    groupId: string,
    ctx: OperationContext,
  ): Promise<MembershipRequest>;
  approve(requestId: string, ctx: OperationContext): Promise<void>;
  reject(
    requestId: string,
    reason: string,
    ctx: OperationContext,
  ): Promise<void>;
  revoke(
    deviceId: string,
    groupId: string,
    reason: string,
    ctx: OperationContext,
  ): Promise<void>;
  listMembers(groupId: string): Promise<SyncGroupMember[]>;
  getAuthorisedNamespaces(deviceId: string): Promise<string[]>;
  canSync(deviceId: string, groupId: string): Promise<boolean>;
}
```

### Sync group security principle

**Never**: `download all → filter locally`

**Always**: `authorised namespaces → synchronise only those namespaces`

The sync group determines which replication streams a device is allowed to participate in. The sync engine is given only the set of authorised namespaces — it has no mechanism to request or receive data outside those namespaces.

---

## Membership state machine

```
                    ┌──────────────┐
                    │  REQUESTED   │
                    └──────┬───────┘
                    approve│    │reject
                           │    │
              ┌────────────┘    └─────────────┐
              ▼                               ▼
        ┌──────────┐                   ┌───────────┐
        │ APPROVED │                   │ REJECTED  │
        └────┬─────┘                   └───────────┘
         1st │sync
             ▼
        ┌──────────┐
        │  ACTIVE  │◄────────────────────────┐
        └────┬─────┘                         │
     suspend │                    reinstate  │
             ▼                               │
        ┌───────────┐                        │
        │ SUSPENDED ├────────────────────────┘
        └─────┬─────┘
              │ revoke
              ▼
        ┌──────────┐ ◄── also from ACTIVE
        │  REVOKED │
        └──────────┘

Additional terminal states:
  EXPIRED  — membership lease expired (if leases are configured)
```

### Valid transitions

| From      | To        | Actor                          |
| --------- | --------- | ------------------------------ |
| REQUESTED | APPROVED  | Admin                          |
| REQUESTED | REJECTED  | Admin                          |
| APPROVED  | ACTIVE    | System (on first sync)         |
| ACTIVE    | SUSPENDED | Admin                          |
| SUSPENDED | ACTIVE    | Admin                          |
| ACTIVE    | REVOKED   | Admin                          |
| SUSPENDED | REVOKED   | Admin                          |
| ACTIVE    | EXPIRED   | System (if lease model active) |

Invalid transitions must fail with `ValidationError`. Attempting `REVOKED → ACTIVE` is not permitted.

---

## Permission registration

Every feature registers its permissions in its `FeatureManifest`:

```typescript
// features/inventory/src/manifest.ts

export const inventoryManifest: FeatureManifest = {
  id: "inventory",
  version: "1.0.0",
  dependencies: ["organisations"],
  permissions: [
    { name: "inventory.read", description: "View inventory records" },
    { name: "inventory.create", description: "Create inventory records" },
    { name: "inventory.update", description: "Update inventory records" },
    { name: "inventory.delete", description: "Delete inventory records" },
    { name: "inventory.import", description: "Import inventory from file" },
    { name: "inventory.export", description: "Export inventory to file" },
  ],
  // ...
};
```

The feature system validates that all `can()` / `require()` calls in the feature reference permissions declared in the manifest. Undeclared permission usage fails the build-time validator.

---

## UI permission integration

The authorization engine exposes effective permissions to the UI:

```typescript
// In React components — use the hook, never evaluate roles directly
const { can } = useAuthorization();

// Navigation item visibility
{ can('inventory.read') && <NavItem href="/inventory" label="Inventory" /> }

// Button visibility
{ can('inventory.create', { warehouseId }) && (
  <Button onClick={handleCreate}>Add Item</Button>
)}
```

The authorization hook reads the current session's effective permissions. UI hiding is a UX convenience — the backend service always re-checks permissions. UI hiding does not constitute a security boundary.

## Current implementation status

`packages/authorization` currently resolves persisted user-role bindings scoped to an organisation, evaluates exact permissions and `*`, applies resource scope matching, and returns typed decisions. Security tests cover scoped access and caller role injection. The actual API is asynchronous and accepts a `Subject`; there is no trusted authenticated-context boundary yet. Hierarchical parent matching, automatic permission-call validation, and universal service-level `require()` enforcement are not implemented. Feature mutation services must not be treated as authorization-complete until those checks are added.

Preserve deny-by-default behavior, persisted tenant-scoped role resolution, backend re-checks, and security regression tests. Treat role names and caller-assembled subjects as untrusted input.
