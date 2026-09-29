# Feature System

## Current Implementation

**Status**: ✅ Feature manifest registration, dependency ordering, and lifecycle implemented.

`packages/feature-system` supports:
- Explicit registration with manifest validation.
- Dependency graph resolution with cycle detection.
- Duplicate feature and permission rejection.
- Migration owner assignment.
- Sync policy and navigation aggregation.

Feature validator (`tooling/feature-validator`) validates manifests and dependency resolution. Build-time source scanning (proving `can()` calls match declared permissions) is not yet a CI gate.

---

## Purpose

The feature system is the mechanism by which domain-specific capabilities are added to a platform application **without modifying the platform packages**.

A feature is a self-contained package that declares its:
- Identity and version
- Dependencies on other features
- Permissions it uses
- Database migrations it owns
- Sync policies for its entities
- UI navigation items

**Platform packages stay domain-free** — all business logic belongs in `features/`.

---

## FeatureManifest contract

```typescript
// packages/feature-system/src/manifest/FeatureManifest.ts

interface FeatureManifest {
  /** Unique stable identifier. Use kebab-case. NEVER change after first deployment. */
  id: string;

  /** SemVer. Increment on breaking schema or API changes. */
  version: string;

  /** Feature IDs that must be installed for this feature to function. */
  dependencies: string[];

  /** Feature IDs that enhance this feature if present but are not required. */
  optionalDependencies?: string[];

  /** All permissions this feature declares. Must match ALL can()/requireTrusted() calls. */
  permissions: PermissionDefinition[];

  /** Schema migrations in version order. Applied after platform migrations. */
  migrations: MigrationDefinition[];

  /** Sync policies for each synchronisable entity. Required if any entity syncs. */
  syncPolicies?: SyncPolicyDefinition[];

  /** Navigation items contributed to the application shell. */
  navigation?: NavigationItem[];
}

interface SyncPolicyDefinition {
  entityType: string;     // Must match a table in this feature's schema
  namespace: string;      // "{application}/{organisation}/{syncGroup}/{feature}/{entityType}"
  conflictPolicy: ConflictPolicy;
  syncable: boolean;      // Must be true to include in replication
}
```

---

## Feature registration

Features are registered **explicitly** at application startup. No magic file discovery.

```typescript
// apps/demo/src/bootstrap/features.ts
import { platform } from "@platform/platform";
import { exampleFeatureManifest, exampleFeatureRoutes } from "@features/example-feature";
import { organisationsManifest } from "@features/organisations";
import { identityAdminManifest } from "@features/identity-admin";

platform.registerFeature({
  manifest: exampleFeatureManifest,
  routes: exampleFeatureRoutes,
});

platform.registerFeature({ manifest: organisationsManifest });
platform.registerFeature({ manifest: identityAdminManifest });

// Platform validates dependency order, detects cycles, and rejects duplicates
await platform.initialize();
```

**Why explicit registration?** It is easier to validate, easier for AI agents to understand, and eliminates implicit filesystem-based loading that can silently fail.

---

## Dependency resolution

```
Read all registered feature manifests
        ↓
Validate ID format (kebab-case, no spaces, unique)
        ↓
Build dependency graph
        ↓
Detect circular dependencies → FAIL
        ↓
Resolve hard dependencies (all must be present) → FAIL if missing
        ↓
Resolve optional dependencies (skip if absent)
        ↓
Validate migrations (versions unique per feature, no gaps)
        ↓
Validate permissions (all can()/require() calls reference declared permissions) [target]
        ↓
Validate sync policies (any syncable entity must have a registered policy)
        ↓
Generate application feature registry (used at runtime)
```

---

## `features/example-feature` — reference implementation

`features/example-feature` is the definitive starting point for new features. It demonstrates every platform capability a feature can use.

### Structure

```
features/example-feature/
├── src/
│   ├── index.ts                  ← Export manifest, routes
│   ├── manifest.ts               ← Complete FeatureManifest
│   ├── permissions.ts            ← Permission name constants
│   ├── schema/
│   │   └── widgets.ts            ← Drizzle table definitions
│   ├── migrations/
│   │   └── 0001_initial.sql      ← Feature-owned migration
│   ├── repositories/
│   │   └── WidgetRepository.ts   ← BaseRepository usage, tenant scope
│   ├── services/
│   │   └── WidgetService.ts      ← Auth + audit + outbox pattern
│   ├── pages/
│   │   ├── WidgetListPage.tsx    ← TanStack Table + pagination
│   │   └── WidgetDetailPage.tsx
│   └── components/
│       └── WidgetCard.tsx
├── tests/
│   ├── unit/widgetService.test.ts
│   └── integration/widgetCrud.test.ts
├── package.json                  ← name: "@features/example-feature"
└── tsconfig.json
```

### What example-feature demonstrates

| Capability | Where |
|---|---|
| Manifest declaration | `manifest.ts` |
| Permission constants | `permissions.ts` |
| Drizzle schema | `schema/widgets.ts` |
| Feature migrations | `migrations/` |
| Repository with BaseRepository | `repositories/WidgetRepository.ts` |
| Service with auth + audit + sync | `services/WidgetService.ts` |
| Tombstone delete | `services/WidgetService.ts` — `softDelete()` |
| React page with DataTable | `pages/WidgetListPage.tsx` |
| Sync policy registration | `manifest.ts` — `syncPolicies` |
| Unit + integration tests | `tests/` |

Every comment in `example-feature` explains _why_ the code is written the way it is, not just what it does.

---

## Creating a new feature

```bash
# 1. Copy example-feature as a starting point
cp -r features/example-feature features/my-domain

# 2. Update the package name
# features/my-domain/package.json: change name to "@features/my-domain"

# 3. Replace "widget" with your domain entity throughout

# 4. Register in your application
# apps/my-app/src/bootstrap/features.ts: add registerFeature(myDomainManifest, routes)

# 5. Add to pnpm workspace
# pnpm-workspace.yaml already includes features/* — no change needed

# 6. Run the validator
pnpm turbo feature-validator
```

The validator catches: missing sync policies, undeclared permissions, duplicate migration versions, broken dependencies.

---

## Feature ID rules

- All lowercase, kebab-case: `inventory`, `warehouse-locations`, `cycle-count`.
- **Never change a feature ID after deployment** — it is embedded in sync namespaces and audit events.
- Platform features use `platform-` prefix: `platform-identity-admin`, `platform-organisations`.
- Application features use their own domain prefix.

---

## Feature-to-feature communication

Features communicate through services, not direct database access:

```typescript
// ✅ Correct: Feature B calls Feature A's service
const warehouse = await warehouseService.findById(warehouseId, ctx);

// ❌ Forbidden: Feature B queries Feature A's tables directly
const warehouse = await db.query("SELECT * FROM warehouse_sites WHERE id = ?", [id]);
```

Optional dependencies allow a feature to behave differently based on whether another feature is installed:

```typescript
if (featureRegistry.isInstalled("barcode-scanning")) {
  // Show barcode scan button
}
```

---

## Platform features

These features are part of the boilerplate and must not contain domain-specific business logic:

| Feature | Package | Purpose |
|---|---|---|
| Identity Admin | `@features/identity-admin` | User, device, role, and sync group management UI |
| Organisations | `@features/organisations` | Organisation management and membership lifecycle |
| Example Feature | `@features/example-feature` | Reference implementation template |
