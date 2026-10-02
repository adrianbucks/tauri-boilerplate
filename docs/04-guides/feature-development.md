# Feature Development Guide

This guide walks through creating a new domain feature from scratch, adhering to the platform's modular feature system, database repository pattern, scoped authorization, and P2P synchronization architecture.

---

## 1. Feature Lifecycle & Structure

All domain capabilities live under `features/<feature-name>`. A complete feature consists of:

```text
features/my-feature/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Public exports and FeatureManifest
│   ├── manifest.ts            # Typed FeatureManifest definition
│   ├── permissions.ts         # Permission string constants
│   ├── schema/                # Drizzle ORM table definitions
│   │   └── my-feature-schema.ts
│   ├── migrations/            # SQL migrations
│   │   └── 0001_initial.sql
│   ├── repositories/          # Domain repository (extends BaseRepository)
│   │   └── MyFeatureRepository.ts
│   ├── services/              # Business service layer with authorization
│   │   └── MyFeatureService.ts
│   ├── components/            # React UI components
│   │   └── MyFeatureList.tsx
│   └── __tests__/             # Unit and integration test suites
│       └── MyFeatureService.test.ts
```

---

## 2. Step 1: Define Schema and Permissions

### Permissions (`src/permissions.ts`)

```typescript
export const MY_FEATURE_PERMISSIONS = {
  READ: "my_feature.read",
  CREATE: "my_feature.create",
  UPDATE: "my_feature.update",
  DELETE: "my_feature.delete",
} as const;
```

### Schema (`src/schema/my-feature-schema.ts`)

Always include mandatory sync and tenant fields for synchronisable entities:

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const myFeatureTable = sqliteTable("feature_items", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  hlcTimestamp: text("hlc_timestamp").notNull(),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by"),
  deleteOperationId: text("delete_operation_id"),
});
```

---

## 3. Step 2: Implement the Repository

Repositories extend `BaseRepository` and enforce tenant scoping:

```typescript
// src/repositories/MyFeatureRepository.ts
import { BaseRepository, type DatabaseConnection } from "@platform/database";
import { myFeatureTable } from "../schema/my-feature-schema.js";
import { eq, and, isNull } from "drizzle-orm";

export class MyFeatureRepository extends BaseRepository {
  constructor(db: DatabaseConnection) {
    super(db);
  }

  async findByIdWithinOrg(id: string, organisationId: string) {
    return this.db.transaction(async (tx) => {
      const results = await tx
        .select()
        .from(myFeatureTable)
        .where(
          and(
            eq(myFeatureTable.id, id),
            eq(myFeatureTable.organisationId, organisationId),
            isNull(myFeatureTable.deletedAt),
          ),
        );
      return results[0] ?? null;
    });
  }
}
```

---

## 4. Step 3: Implement the Service Layer

The service layer validates authorization, opens transactions, and coordinates audit logs and sync envelopes:

```typescript
// src/services/MyFeatureService.ts
import type {
  AuthorizationEngine,
  TrustedOperationContext,
} from "@platform/authorization";
import type { AuditService } from "@platform/audit";
import type { OutboxSyncWorker } from "@platform/tasks";
import { MY_FEATURE_PERMISSIONS } from "../permissions.js";
import { MyFeatureRepository } from "../repositories/MyFeatureRepository.js";

export class MyFeatureService {
  constructor(
    private readonly repo: MyFeatureRepository,
    private readonly auth: AuthorizationEngine,
    private readonly audit: AuditService,
    private readonly outbox: OutboxSyncWorker,
  ) {}

  async createItem(
    ctx: TrustedOperationContext,
    input: { title: string; status: string },
  ) {
    // 1. Authorize operation
    await this.auth.requireTrusted(ctx, MY_FEATURE_PERMISSIONS.CREATE, {
      organisationId: ctx.organisationId,
    });

    const item = {
      id: crypto.randomUUID(),
      organisationId: ctx.organisationId,
      title: input.title,
      status: input.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hlcTimestamp: ctx.hlcClock.now(),
      version: 1,
    };

    // 2. Commit transactionally
    await this.repo.transaction(async (tx) => {
      await this.repo.withTx(tx).insert(item);
      await this.audit.withTx(tx).record({
        eventType: "RECORD_CREATED",
        userId: ctx.userId,
        organisationId: ctx.organisationId,
        metadata: { itemId: item.id },
      });
      await this.outbox.withTx(tx).enqueue({
        namespace: "feature.my_feature",
        entityId: item.id,
        operation: "UPSERT",
        payload: item,
      });
    });

    return item;
  }
}
```

---

## 5. Step 4: Declare the Feature Manifest

```typescript
// src/manifest.ts
import type { FeatureManifest } from "@platform/feature-system";
import { MY_FEATURE_PERMISSIONS } from "./permissions.js";

export const MyFeatureManifest: FeatureManifest = {
  id: "feature.my-feature",
  name: "My Feature",
  version: "1.0.0",
  description: "Custom domain capability",
  dependencies: ["core.auth", "core.database"],
  permissions: Object.values(MY_FEATURE_PERMISSIONS),
  syncPolicies: [
    {
      namespace: "feature.my_feature",
      schemaVersion: 1,
      conflictStrategy: "LWW_HLC",
      tombstoneRetentionDays: 30,
    },
  ],
  navItems: [
    {
      id: "my-feature",
      label: "Items",
      path: "/items",
      permission: MY_FEATURE_PERMISSIONS.READ,
    },
  ],
};
```

---

## 6. Step 5: Register Feature in the Application

In `apps/demo/src/main.tsx` or application bootstrap:

```typescript
import { featureRegistry } from "@platform/feature-system";
import { MyFeatureManifest } from "@features/my-feature";

featureRegistry.register(MyFeatureManifest);
await featureRegistry.initializeAll();
```
