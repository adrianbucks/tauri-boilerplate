# 10 — Feature System

| | |
| **Current** | Manifest validation, explicit registration, dependency/cycle checks, duplicate rejection, migration owner assignment, sync-policy and navigation aggregation. Validator does not scan source or prove table-to-policy correspondence. |
| **Target** | Features as the only place for domain schema, permissions, migrations, sync policies, and UI; platform packages stay domain-free. |
| **Remaining** | Full validator rules. [S-08](../specifications/S-08-feature-system-and-migrations.md). |

## Purpose

The feature system is the mechanism by which domain-specific capabilities are added to a platform application without modifying the platform packages. A feature is a self-contained package that declares its identity, dependencies, permissions, migrations, sync policies, and UI.

The platform treats features as first-class citizens. **Target:** validate manifests at build time, resolve the dependency graph, run feature migrations, register permissions, and route UI.

**Current:** registration and validation happen in TypeScript (`ManifestValidator`, `DependencyResolver`). `tooling/feature-validator` exists but is not a Turbo/CI gate, and it does not scan `can()`/`require()` calls or prove table-to-policy correspondence.

---

## Package: `packages/feature-system`

```
packages/feature-system/src/    ← current
├── index.ts
├── manifest/
│   ├── FeatureManifest.ts
│   └── ManifestValidator.ts
└── registry/
    ├── FeatureRegistry.ts
    └── DependencyResolver.ts
```

---

## Feature manifest

Every feature must export a `FeatureManifest` as its primary contract with the platform.

```typescript
// packages/feature-system/src/manifest/FeatureManifest.ts

interface FeatureManifest {
  /** Unique stable identifier. Use kebab-case. Never change after first release. */
  id: string;

  /** SemVer. Increment on breaking schema or API changes. */
  version: string;

  /** Feature IDs that must be installed for this feature to work. */
  dependencies: string[];

  /** Feature IDs that enhance this feature if present but are not required. */
  optionalDependencies?: string[];

  /** All permissions this feature declares. Must match all can()/require() calls. */
  permissions: PermissionDefinition[];

  /** Schema migrations in version order. Applied after platform migrations. */
  migrations: MigrationDefinition[];

  /** Sync policies for each synchronisable entity type. Required if feature syncs data. */
  syncPolicies?: SyncPolicyDefinition[];

  /** Navigation items contributed to the app shell. */
  navigation?: NavigationItem[];
}

interface PermissionDefinition {
  name: string; // e.g., 'inventory.read'
  description: string;
}

interface MigrationDefinition {
  version: number; // Monotonic integer, unique per feature
  name: string; // Human-readable description
  sql: string; // The migration SQL
}

interface SyncPolicyDefinition {
  entityType: string; // Must match a table in this feature's schema
  namespace: string; // Namespace template: '{application}/{organisation}/{syncGroup}/{feature}/{entityType}'
  conflictPolicy: ConflictPolicy;
  syncable: boolean; // Must be true for the entity to be included in replication
}
```

---

## Feature registration

Features are registered explicitly at application startup. No magic file discovery.

```typescript
// apps/demo/src/App.tsx (or bootstrap/features.ts)

import { platform } from "@platform/platform";
import { exampleFeatureManifest } from "@features/example-feature";
import { organisationsManifest } from "@features/organisations";
import { identityAdminManifest } from "@features/identity-admin";

platform.registerFeature({
  manifest: exampleFeatureManifest,
  routes: exampleFeatureRoutes,
  permissions: exampleFeatureManifest.permissions,
  migrations: exampleFeatureManifest.migrations,
  syncPolicies: exampleFeatureManifest.syncPolicies,
});

// ... register other features
```

**Rationale for explicit registration**: It is easier to validate, easier for AI agents to understand, and eliminates implicit filesystem-based loading that can silently fail.

---

## Build-time dependency resolution (target)

`tooling/feature-validator/` is the intended Turborepo/CI step. Today it can validate manifests and dependency order when invoked; it is not listed in `turbo.json` and is not run by `.github/workflows/ci.yml`. The steps below remain the required gate before production.

```
read all registered feature manifests
        ↓
validate ID format (kebab-case, no spaces, unique)
        ↓
build dependency graph
        ↓
detect circular dependencies → FAIL BUILD
        ↓
resolve hard dependencies (all must be present) → FAIL if missing
        ↓
resolve optional dependencies (skip if absent)
        ↓
validate migrations (versions unique per feature, no gaps, no overwrites)
        ↓
validate permissions (all can()/require() calls reference declared permissions)
        ↓
validate sync policies (any syncable entity must have a registered policy)
        ↓
generate application feature registry (type-safe, used at runtime)
```

A feature without a sync policy for a synchronisable entity **must fail this gate**. That check is not enforced by the current validator.

---

## `features/example-feature` — reference implementation

The `example-feature` package is the definitive starting point for downstream developers. It demonstrates every platform capability a feature can use.

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
│   │   ├── 0001_initial.sql      ← Feature migrations
│   │   └── 0002_add_color.sql
│   ├── repositories/
│   │   └── widgetRepository.ts   ← BaseRepository usage
│   ├── services/
│   │   └── widgetService.ts      ← Business logic with auth + audit + sync
│   ├── pages/
│   │   ├── WidgetListPage.tsx    ← TanStack Table + pagination
│   │   └── WidgetDetailPage.tsx
│   └── components/
│       └── WidgetCard.tsx
├── tests/
│   ├── unit/
│   │   ├── widgetService.test.ts
│   │   └── manifest.test.ts       ← Validates manifest structure
│   └── integration/
│       └── widgetCrud.test.ts
├── package.json                   ← name: "@features/example-feature"
└── tsconfig.json
```

### What example-feature demonstrates

| Capability                       | Where                                        |
| -------------------------------- | -------------------------------------------- |
| Manifest declaration             | `manifest.ts`                                |
| Permission constants             | `permissions.ts`                             |
| Drizzle schema                   | `schema/widgets.ts`                          |
| Migration files                  | `migrations/`                                |
| Repository with BaseRepository   | `repositories/widgetRepository.ts`           |
| Service with auth + audit + sync | `services/widgetService.ts`                  |
| Tombstone delete                 | `services/widgetService.ts` — `softDelete()` |
| React page with DataTable        | `pages/WidgetListPage.tsx`                   |
| React page with form             | `pages/WidgetDetailPage.tsx`                 |
| Sync policy registration         | `manifest.ts` — `syncPolicies`               |
| Unit tests                       | `tests/unit/`                                |
| Integration test                 | `tests/integration/`                         |

Every comment in `example-feature` explains _why_ the code is written the way it is, not just what it does. This is documentation through code.

---

## How downstream developers create a feature

```bash
# 1. Copy example-feature as a starting point
cp -r features/example-feature features/my-domain

# 2. Rename the package
# In features/my-domain/package.json: change name to "@features/my-domain"

# 3. Replace "widget" with your domain entity throughout

# 4. Register in your app
# In apps/my-app/src/bootstrap/features.ts: add registerFeature(myDomainManifest)

# 5. Run the validator
pnpm turbo feature-validator
```

The validator will catch: missing sync policies, undeclared permissions, duplicate migration versions, and broken dependencies.

---

## Feature ID rules

- All lowercase, kebab-case: `inventory`, `warehouse-locations`, `cycle-count`
- Never change a feature ID after it has been deployed — it is embedded in sync namespaces and audit events
- Platform features use the `platform-` prefix: `platform-identity-admin`, `platform-organisations`
- Application features use their own domain prefix or no prefix

---

## Feature-to-feature communication

Features may communicate with each other through services, not direct database access:

```typescript
// ✅ Correct: Feature B calls Feature A's service
const warehouse = await warehouseService.findById(warehouseId);

// ❌ Forbidden: Feature B queries Feature A's tables directly
const warehouse = await db.query("SELECT * FROM warehouse_sites WHERE id = ?", [
  id,
]);
```

Optional dependencies allow a feature to behave differently based on whether another feature is installed:

```typescript
// In inventory feature: check if barcode feature is available
if (featureRegistry.isInstalled("barcode-scanning")) {
  // Show barcode scan button
}
```

## Current implementation status

`packages/feature-system` currently supports explicit registration, manifest validation, dependency ordering, cycle detection, duplicate feature and permission rejection, migration owner assignment, sync policy aggregation, navigation aggregation, and registry tests. The standalone feature validator currently validates manifests and dependency resolution only; it does not scan source calls, prove table-to-policy correspondence, or enforce every architecture boundary. The example feature is a compact reference implementation and does not contain every page and migration shown in this target document.

Keep stable feature IDs, explicit registration, dependency resolution, owned migrations, declared permissions, and declared sync policies as the required extension pattern.
