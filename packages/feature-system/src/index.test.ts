import { describe, it, expect } from "vitest";
import {
  FeatureRegistry,
  ManifestValidator,
  DependencyResolver,
  type FeatureManifest,
} from "./index.js";

describe("@platform/feature-system", () => {
  const orgManifest: FeatureManifest = {
    id: "organisations",
    name: "Organisations",
    version: "1.0.0",
    dependencies: [],
    permissions: [
      { name: "organisations.read", description: "Read organisations" },
      { name: "organisations.manage", description: "Manage organisations" },
    ],
    migrations: [
      {
        version: 1,
        name: "init_orgs",
        sql: "CREATE TABLE orgs (id TEXT PRIMARY KEY);",
        checksum: "chk_org_1",
      },
    ],
  };

  const inventoryManifest: FeatureManifest = {
    id: "inventory",
    name: "Inventory Management",
    version: "1.0.0",
    dependencies: ["organisations"],
    permissions: [
      { name: "inventory.read", description: "Read inventory" },
      { name: "inventory.create", description: "Create inventory" },
    ],
    migrations: [
      {
        version: 1,
        name: "init_inv",
        sql: "CREATE TABLE inv (id TEXT PRIMARY KEY);",
        checksum: "chk_inv_1",
      },
    ],
    syncPolicies: [
      {
        entityType: "inventory_item",
        namespacePattern: "{application}/{organisation}/{syncGroup}/inventory/items",
        conflictPolicy: { strategy: "lww" },
        syncable: true,
      },
    ],
  };

  describe("ManifestValidator", () => {
    it("rejects malformed manifest structure with a validation error", () => {
      const malformedPermission = {
        ...orgManifest,
        permissions: [null],
      } as unknown as FeatureManifest;

      expect(() => ManifestValidator.validate(malformedPermission)).toThrow(
        "invalid or missing 'permissions[]'",
      );
      expect(() => ManifestValidator.validate(null as unknown as FeatureManifest)).toThrow(
        "invalid or missing 'manifest'",
      );
    });

    it("validates a correct manifest without error", () => {
      expect(() => ManifestValidator.validate(orgManifest)).not.toThrow();
    });

    it("rejects invalid kebab-case IDs", () => {
      const invalid = { ...orgManifest, id: "Invalid_Name" };
      expect(() => ManifestValidator.validate(invalid)).toThrow("must be lowercase kebab-case");
    });

    it("rejects invalid permission format", () => {
      const invalid: FeatureManifest = {
        ...orgManifest,
        permissions: [{ name: "invalidpermission", description: "desc" }],
      };
      expect(() => ManifestValidator.validate(invalid)).toThrow("hierarchical dot-notation");
    });

    it("rejects duplicate migration versions", () => {
      const invalid: FeatureManifest = {
        ...orgManifest,
        migrations: [
          { version: 1, name: "m1", sql: "...", checksum: "c1" },
          { version: 1, name: "m2", sql: "...", checksum: "c2" },
        ],
      };
      expect(() => ManifestValidator.validate(invalid)).toThrow("Duplicate migration version");
    });

    it("rejects non-integer migration versions", () => {
      const invalid: FeatureManifest = {
        ...orgManifest,
        migrations: [{ version: 1.5, name: "fractional", sql: "SELECT 1", checksum: "c" }],
      };
      expect(() => ManifestValidator.validate(invalid)).toThrow("invalid version");
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
      "rejects invalid pruning retention days (%s)",
      (retentionDays) => {
        const invalid: FeatureManifest = {
          ...orgManifest,
          pruningPolicies: [
            {
              id: "feature.records",
              displayName: "Records",
              tableName: "records",
              timestampColumn: "created_at",
              defaultRetentionDays: retentionDays,
            },
          ],
        };
        expect(() => ManifestValidator.validate(invalid)).toThrow("positive finite");
      },
    );

    it("allows simple pruning comparisons and rejects broadening SQL predicates", () => {
      const valid: FeatureManifest = {
        ...orgManifest,
        pruningPolicies: [
          {
            id: "feature.records",
            displayName: "Records",
            tableName: "records",
            timestampColumn: "created_at",
            defaultRetentionDays: 30,
            filterCondition: "status = 'ARCHIVED'",
          },
        ],
      };
      expect(() => ManifestValidator.validate(valid)).not.toThrow();

      const invalid: FeatureManifest = {
        ...valid,
        pruningPolicies: [
          {
            ...valid.pruningPolicies![0]!,
            filterCondition: "status = 'ARCHIVED' OR 1 = 1",
          },
        ],
      };
      expect(() => ManifestValidator.validate(invalid)).toThrow("unsafe filterCondition");
    });

    it("rejects unsafe or incomplete sync namespace patterns", () => {
      const invalid: FeatureManifest = {
        ...inventoryManifest,
        syncPolicies: [
          {
            ...inventoryManifest.syncPolicies![0]!,
            namespacePattern: "{application}/../{organisation}/{syncGroup}/items",
          },
        ],
      };
      expect(() => ManifestValidator.validate(invalid)).toThrow("safe path segments");
    });

    it("rejects unsupported sync conflict strategies", () => {
      const invalid = structuredClone(inventoryManifest);
      (invalid.syncPolicies![0]!.conflictPolicy as { strategy: string }).strategy = "unknown";
      expect(() => ManifestValidator.validate(invalid)).toThrow("unsupported conflict strategy");
    });

    it("rejects a missing sync conflict policy with a validation error", () => {
      const invalid = structuredClone(inventoryManifest);
      (invalid.syncPolicies![0] as { conflictPolicy?: unknown }).conflictPolicy = null;

      expect(() => ManifestValidator.validate(invalid)).toThrow("unsupported conflict strategy");
    });

    it("rejects duplicate permission names across features", () => {
      const duplicate = {
        ...inventoryManifest,
        permissions: [{ name: "organisations.read", description: "Duplicate" }],
      };

      expect(() => DependencyResolver.resolve([orgManifest, duplicate])).toThrow(
        "declared by both",
      );
    });
  });

  describe("DependencyResolver", () => {
    it("resolves dependency order correctly", () => {
      const result = DependencyResolver.resolve([inventoryManifest, orgManifest]);
      expect(result.orderedManifests.map((m) => m.id)).toEqual(["organisations", "inventory"]);
    });

    it("throws error when hard dependency is missing", () => {
      expect(() => DependencyResolver.resolve([inventoryManifest])).toThrow(
        "requires missing dependency 'organisations'",
      );
    });

    it("rejects duplicate feature IDs", () => {
      expect(() => DependencyResolver.resolve([orgManifest, { ...orgManifest }])).toThrow(
        "Duplicate feature ID",
      );
    });

    it("detects and reports circular dependencies", () => {
      const featA: FeatureManifest = {
        id: "feat-a",
        name: "Feature A",
        version: "1.0.0",
        dependencies: ["feat-b"],
        permissions: [],
        migrations: [],
      };
      const featB: FeatureManifest = {
        id: "feat-b",
        name: "Feature B",
        version: "1.0.0",
        dependencies: ["feat-a"],
        permissions: [],
        migrations: [],
      };
      expect(() => DependencyResolver.resolve([featA, featB])).toThrow(
        "Circular dependency detected",
      );
    });

    it("resolves long dependency chains without using the call stack", () => {
      const manifests: FeatureManifest[] = Array.from({ length: 12_000 }, (_, index) => ({
        id: `feature-${index}`,
        name: `Feature ${index}`,
        version: "1.0.0",
        dependencies: index === 0 ? [] : [`feature-${index - 1}`],
        permissions: [],
        migrations: [],
      }));

      const result = DependencyResolver.resolve(manifests);

      expect(result.orderedManifests).toHaveLength(manifests.length);
      expect(result.orderedManifests[0]?.id).toBe("feature-0");
      expect(result.orderedManifests.at(-1)?.id).toBe("feature-11999");
    });
  });

  describe("FeatureRegistry", () => {
    it("registers features, resolves graph, and exposes sorted migrations and permissions", () => {
      const registry = new FeatureRegistry();
      registry.registerFeature({ manifest: orgManifest });
      registry.registerFeature({ manifest: inventoryManifest });

      expect(registry.isInstalled("organisations")).toBe(true);
      expect(registry.isInstalled("inventory")).toBe(true);
      expect(registry.isInstalled("unknown")).toBe(false);

      const features = registry.getAllFeatures();
      expect(features.map((f) => f.id)).toEqual(["organisations", "inventory"]);

      const permissions = registry.getAllPermissions();
      expect(permissions).toHaveLength(4);

      const syncPolicies = registry.getAllSyncPolicies();
      expect(syncPolicies).toHaveLength(1);
      expect(syncPolicies[0]?.entityType).toBe("inventory_item");
    });

    it("rejects duplicate feature registration", () => {
      const registry = new FeatureRegistry();
      registry.registerFeature({ manifest: orgManifest });

      expect(() => registry.registerFeature({ manifest: orgManifest })).toThrow(
        "already been registered",
      );
    });

    it("snapshots registered manifests and protects resolved collections from mutation", () => {
      const registry = new FeatureRegistry();
      const manifest: FeatureManifest = {
        ...orgManifest,
        permissions: [...orgManifest.permissions],
        migrations: [...orgManifest.migrations],
      };
      registry.registerFeature({ manifest });

      (manifest as { name: string }).name = "Mutated after registration";
      (manifest.permissions as { name: string; description: string }[]).push({
        name: "invalid.permission",
        description: "Mutation",
      });

      const exposedFeatures = registry.getAllFeatures();
      exposedFeatures.pop();
      registry.getAllMigrations().pop();

      expect(registry.getFeature("organisations")?.name).toBe("Organisations");
      expect(registry.getAllFeatures()).toHaveLength(1);
      expect(registry.getAllPermissions()).toHaveLength(2);
      expect(registry.getAllMigrations()).toHaveLength(1);
    });

    it("freezes cyclic extra manifest data without overflowing", () => {
      const registry = new FeatureRegistry();
      const metadata: { self?: unknown } = {};
      metadata.self = metadata;
      const manifest = { ...orgManifest, metadata } as FeatureManifest;

      expect(() => registry.registerFeature({ manifest })).not.toThrow();
      const registered = registry.getFeature("organisations") as
        (FeatureManifest & { metadata?: unknown }) | undefined;
      expect(registered).toBeDefined();
      expect(Object.isFrozen(registered?.metadata)).toBe(true);
    });
  });
});
