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
        namespacePattern:
          "{application}/{organisation}/{syncGroup}/inventory/items",
        conflictPolicy: { strategy: "lww" },
        syncable: true,
      },
    ],
  };

  describe("ManifestValidator", () => {
    it("validates a correct manifest without error", () => {
      expect(() => ManifestValidator.validate(orgManifest)).not.toThrow();
    });

    it("rejects invalid kebab-case IDs", () => {
      const invalid = { ...orgManifest, id: "Invalid_Name" };
      expect(() => ManifestValidator.validate(invalid)).toThrow(
        "must be lowercase kebab-case",
      );
    });

    it("rejects invalid permission format", () => {
      const invalid: FeatureManifest = {
        ...orgManifest,
        permissions: [{ name: "invalidpermission", description: "desc" }],
      };
      expect(() => ManifestValidator.validate(invalid)).toThrow(
        "hierarchical dot-notation",
      );
    });

    it("rejects duplicate migration versions", () => {
      const invalid: FeatureManifest = {
        ...orgManifest,
        migrations: [
          { version: 1, name: "m1", sql: "...", checksum: "c1" },
          { version: 1, name: "m2", sql: "...", checksum: "c2" },
        ],
      };
      expect(() => ManifestValidator.validate(invalid)).toThrow(
        "Duplicate migration version",
      );
    });
  });

  describe("DependencyResolver", () => {
    it("resolves dependency order correctly", () => {
      const result = DependencyResolver.resolve([
        inventoryManifest,
        orgManifest,
      ]);
      expect(result.orderedManifests.map((m) => m.id)).toEqual([
        "organisations",
        "inventory",
      ]);
    });

    it("throws error when hard dependency is missing", () => {
      expect(() => DependencyResolver.resolve([inventoryManifest])).toThrow(
        "requires missing dependency 'organisations'",
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
  });
});
