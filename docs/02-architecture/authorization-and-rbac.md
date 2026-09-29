# Authorization & RBAC

## Current Implementation

**Status**: ✅ Central authorization enforced at all privileged service boundaries.

Implemented in `packages/authorization` with full integration across all platform services and features:

- Central `authorization.requireTrusted()` enforced at every mutation boundary.
- Mandatory `organisationId` scope in all repository queries.
- Cross-tenant access rejected at the service layer.
- 12+ security regression tests in `tests/security/rbac-security.test.ts`.

### Test evidence

```
pnpm --filter @tests/security test
test result: 4 test files passed; 30+ passed
# Covers: TrustedOperationContext RBAC, scope enforcement,
#          cross-tenant rejection, unprivileged rejection
```

---

## Authorization engine API

```typescript
// packages/authorization/src/index.ts
interface AuthorizationEngine {
  /**
   * Check if the trusted context has permission. Returns a typed decision — does not throw.
   */
  can(
    ctx: TrustedOperationContext,
    permission: PermissionName,
    resource?: ResourceScope,
  ): AuthorizationDecision;

  /**
   * Require permission or throw AuthorizationError.
   * Use inside service methods where denial means operation cannot proceed.
   */
  requireTrusted(
    ctx: TrustedOperationContext,
    permission: PermissionName,
    resource?: ResourceScope,
  ): Promise<void>;

  /**
   * Returns effective permissions for UI display.
   */
  effectivePermissions(ctx: TrustedOperationContext): EffectivePermissions;
}

type AuthorizationDecision =
  | { granted: true }
  | { granted: false; reason: string; code: AuthorizationDeniedCode };
```

---

## Permission naming convention

Permissions are hierarchical dot-separated strings:

```
<resource>.<action>
<resource>.<sub-resource>.<action>
```

### Platform permissions (built-in)

```
users.read          users.create        users.update        users.delete
roles.read          roles.manage
devices.read        devices.approve     devices.revoke
sync.read           sync.request        sync.approve        sync.manage     sync.revoke
organisations.read  organisations.manage
audit.read          audit.export
```

### Feature permissions (registered per feature)

```
widgets.read        widgets.create      widgets.update      widgets.delete
inventory.read      inventory.create    inventory.import    inventory.export
warehouse.manage
barcode.scan
```

### Rules

- Always two parts minimum (`resource.action`).
- All lowercase with dots.
- Avoid generic names: `is_admin`, `can_do_everything`.
- **Roles are collections of permissions — roles are not permissions.**

---

## Scoped authorization

Permissions are evaluated against a resource scope:

```typescript
// Check: can user read widgets at any scope?
can(ctx, "widgets.read");

// Check: can user read widgets within a specific organisation?
can(ctx, "widgets.read", { organisationId: ctx.organisationId });

// Check: can user read inventory at a specific warehouse?
can(ctx, "inventory.read", { warehouseId: "COV" });
```

### Scope resolution rule

A permission is granted if **any** role assignment for the subject matches both:
- The permission name (exact or hierarchical parent match).
- The resource scope constraints (scoped grants must be at least as specific as the request).

```typescript
// Subject has: inventory.read scoped to { warehouseId: 'COV' }
can(ctx, "inventory.read", { warehouseId: "BHM" }) // → DENIED
can(ctx, "inventory.read", { warehouseId: "COV" }) // → GRANTED
can(ctx, "inventory.read")                          // → DENIED (unscoped vs scoped grant)
```

---

## Correct and forbidden patterns

### ❌ Forbidden anti-patterns

```typescript
// ❌ Hardcoded role checking
if (user.role === "admin") { deleteWidget(id); }
if (user.roles.includes("manager")) { approve(req); }

// ❌ Session-identity comparison as authorization
if (session.userId === ownerId) { update(widget); }

// ❌ Caller-constructed operation context with trust
const ctx = { userId: req.body.userId, permissions: ["widgets.delete"] };
```

### ✅ Required patterns

```typescript
// ✅ Central authorization engine check before mutation
await this.authorization.requireTrusted(ctx, "widgets.delete", {
  organisationId: ctx.organisationId,
});

// ✅ Typed decision without throwing
const decision = this.authorization.can(ctx, "widgets.update", {
  organisationId: ctx.organisationId,
});
if (!decision.granted) {
  return { error: decision.reason };
}

// ✅ UI: use can() to show/hide — backend ALWAYS re-checks
const { can } = useAuthorization();
{can("widgets.create") && <Button>Add Widget</Button>}
```

---

## Feature permission registration

Every feature registers its permissions in its `FeatureManifest`:

```typescript
// features/example-feature/src/manifest.ts
export const exampleFeatureManifest: FeatureManifest = {
  id: "example-feature",
  version: "1.0.0",
  dependencies: ["organisations"],
  permissions: [
    { name: "widgets.read",   description: "View widget records" },
    { name: "widgets.create", description: "Create widget records" },
    { name: "widgets.update", description: "Update widget records" },
    { name: "widgets.delete", description: "Delete widget records" },
  ],
  syncPolicy: { /* ... */ },
  migrations: { /* ... */ },
};
```

The feature validator (`tooling/feature-validator`) checks that all `can()` / `requireTrusted()` calls reference permissions declared in the manifest.

---

## Tenant isolation

Cross-tenant access is denied by default (ADR-025). Every service method that accesses tenant data must:

1. Extract `organisationId` from the `TrustedOperationContext` (not from input).
2. Pass it as a mandatory scope to `requireTrusted`.
3. Scope all repository queries to `organisationId`.
4. Reject any input `organisationId` that differs from the context's `organisationId`.

```typescript
// ✅ Correct tenant isolation
async createUser(
  input: CreateUserInput,
  ctx: TrustedOperationContext,
): Promise<User> {
  // 1. Reject cross-tenant input
  if (input.organisationId !== ctx.organisationId) {
    throw new AuthorizationError("Cross-tenant operation rejected");
  }

  // 2. Authorize using the context's org (not the input)
  await this.authorization.requireTrusted(ctx, "users.create", {
    organisationId: ctx.organisationId,
  });

  // 3. Repository query is also scoped
  return this.userRepo.createWithinOrganisation(input, ctx.organisationId);
}
```

---

## Sync groups

Sync groups determine which replication streams a device participates in.

```typescript
interface SyncGroupService {
  createGroup(input: CreateGroupInput, ctx: TrustedOperationContext): Promise<SyncGroup>;
  requestMembership(groupId: string, ctx: TrustedOperationContext): Promise<MembershipRequest>;
  approve(requestId: string, ctx: TrustedOperationContext): Promise<void>;
  reject(requestId: string, reason: string, ctx: TrustedOperationContext): Promise<void>;
  revoke(deviceId: string, groupId: string, reason: string, ctx: TrustedOperationContext): Promise<void>;
  listMembers(groupId: string): Promise<SyncGroupMember[]>;
  getAuthorisedNamespaces(deviceId: string): Promise<string[]>;
  canSync(deviceId: string, groupId: string): Promise<boolean>;
}
```

**Core security principle**: Never `download all → filter locally`. Always `authorised namespaces → synchronise only those namespaces`.

### Membership state machine

```
REQUESTED
    ↓ approve           ↓ reject
  APPROVED           REJECTED
    ↓ first sync
   ACTIVE ←───────────┐
    ↓ suspend    reinstate
  SUSPENDED ──────────┘
    ↓ revoke         ← also from ACTIVE
   REVOKED
```

| Transition | Actor |
|---|---|
| REQUESTED → APPROVED/REJECTED | Admin |
| APPROVED → ACTIVE | System (on first sync) |
| ACTIVE → SUSPENDED | Admin |
| SUSPENDED → ACTIVE | Admin |
| ACTIVE/SUSPENDED → REVOKED | Admin |

Invalid transitions throw `ValidationError`. `REVOKED → ACTIVE` is not permitted.

---

## UI authorization integration

```tsx
// In React components — use the hook, never evaluate roles directly
const { can } = useAuthorization();

// Navigation item visibility
{can("widgets.read") && <NavItem href="/widgets" label="Widgets" />}

// Button visibility
{can("widgets.create", { organisationId }) && (
  <Button onClick={handleCreate}>Add Widget</Button>
)}
```

UI hiding is a **UX convenience only** — the backend service always re-checks permissions independently. UI hiding does not constitute a security boundary.
