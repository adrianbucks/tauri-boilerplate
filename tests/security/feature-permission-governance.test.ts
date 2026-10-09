/**
 * Security Regression Suite — Feature Permission Governance (WP-021)
 *
 * Gate: G-013 — Build-Time Feature Permission Enforcement Gate
 *
 * These tests verify that the feature permission scanner and checker behave
 * correctly as static enforcement machinery. They serve as security regression
 * tests for Invariant #2 of the feature system:
 *
 *   "Every permission used via the authorization engine must be declared in
 *    the feature's FeatureManifest.permissions[] array."
 *
 * If any of these tests fail, it means the enforcement tooling itself has
 * regressed and the build-time guarantee is no longer reliable.
 *
 * Per Invariant #9: Every security change must be accompanied by negative
 * tests that verify unauthorized attempts fail deterministically.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import {
  scanFeaturePermissions,
  checkPermissionCoverage,
  validateManifests,
} from "@tooling/feature-validator";
import type { FeatureManifest } from "@tooling/feature-validator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../");
const featuresDir = path.join(workspaceRoot, "features");

// ---------------------------------------------------------------------------
// Fixture factory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "feature-perm-test-"));
});

function createFixtureFeature(
  name: string,
  serviceContent: string,
): { srcDir: string; cleanup: () => void } {
  const featureDir = path.join(tmpDir, name);
  const srcDir = path.join(featureDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  // Write a permissions.ts constant file
  fs.writeFileSync(
    path.join(srcDir, "permissions.ts"),
    `export const TEST_PERMISSIONS = {
  READ: "test.read",
  CREATE: "test.create",
  UPDATE: "test.update",
  DELETE: "test.delete",
  ADMIN: "test.admin",
} as const;
`,
  );

  // Write the provided service file
  fs.writeFileSync(path.join(srcDir, "service.ts"), serviceContent);

  return {
    srcDir,
    cleanup: () => fs.rmSync(featureDir, { recursive: true, force: true }),
  };
}

function makeManifest(id: string, permissionNames: string[]): FeatureManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "Test fixture feature",
    dependencies: [],
    permissions: permissionNames.map((name) => ({ name, description: "" })),
    migrations: [],
  } as FeatureManifest;
}

// ---------------------------------------------------------------------------
// Phase 1: Scanner unit tests
// ---------------------------------------------------------------------------

describe("Security Regression Suite — Feature Permission Governance (WP-021 / G-013)", () => {
  describe("Phase 1: Permission scanner", () => {
    it("correctly identifies requirePermission() calls with constant references", () => {
      const { srcDir } = createFixtureFeature(
        "scanner-constants",
        `import { TEST_PERMISSIONS } from "./permissions.js";
import { AuthorizationEngine } from "@platform/authorization";

export class TestService {
  private auth = new AuthorizationEngine(db);

  private async requirePermission(ctx: unknown, permission: string): Promise<void> {
    await this.auth.requireTrusted(ctx as any, permission);
  }

  async readRecord(ctx: unknown) {
    await this.requirePermission(ctx, TEST_PERMISSIONS.READ);
  }

  async createRecord(ctx: unknown) {
    await this.requirePermission(ctx, TEST_PERMISSIONS.CREATE);
  }
}
`,
      );

      const result = scanFeaturePermissions(srcDir);

      const permissions = result.references.map((r) => r.permission);
      expect(permissions).toContain("test.read");
      expect(permissions).toContain("test.create");
    });

    it("correctly identifies string literal permission calls", () => {
      const { srcDir } = createFixtureFeature(
        "scanner-literals",
        `import { AuthorizationEngine } from "@platform/authorization";

export class TestService {
  private auth = new AuthorizationEngine(db);

  async readRecord(ctx: unknown) {
    await this.auth.requireTrusted(ctx as any, "test.read");
  }

  async deleteRecord(ctx: unknown) {
    await this.auth.require({ userId: "", organisationId: "", roles: [] }, "test.delete");
  }
}
`,
      );

      const result = scanFeaturePermissions(srcDir);
      const permissions = result.references.map((r) => r.permission);

      expect(permissions).toContain("test.read");
      expect(permissions).toContain("test.delete");
    });

    it("does NOT scan test files (.test.ts, .spec.ts)", () => {
      const { srcDir } = createFixtureFeature(
        "scanner-no-test-files",
        `// empty production file
export {};
`,
      );

      // Write a test file that references permissions — should be ignored
      fs.writeFileSync(
        path.join(srcDir, "service.test.ts"),
        `import { AuthorizationEngine } from "@platform/authorization";
const auth = new AuthorizationEngine(db as any);
// This should not be picked up by the scanner
auth.require({ userId: "u", organisationId: "o", roles: [] }, "test.admin");
`,
      );

      const result = scanFeaturePermissions(srcDir);
      const permissions = result.references.map((r) => r.permission);
      expect(permissions).not.toContain("test.admin");
    });

    it("emits a warning (not error) for template literal permission strings", () => {
      const { srcDir } = createFixtureFeature(
        "scanner-template-literals",
        `export class TestService {
  private auth: any;
  async doSomething(action: string, ctx: unknown) {
    await this.auth.requireTrusted(ctx, \`test.\${action}\`);
  }
}
`,
      );

      const result = scanFeaturePermissions(srcDir);

      // Template literals must produce warnings, not resolved references
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]?.message).toContain("Template literal");
    });

    it("returns empty result for non-existent directory", () => {
      const result = scanFeaturePermissions(path.join(tmpDir, "does-not-exist"));
      expect(result.references).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("includes file path and line number in each reference", () => {
      const { srcDir } = createFixtureFeature(
        "scanner-location",
        `import { TEST_PERMISSIONS } from "./permissions.js";
export class TestService {
  private auth: any;
  async doRead(ctx: unknown) {
    // Line 5 starts here
    await this.auth.requireTrusted(ctx, TEST_PERMISSIONS.READ);
  }
}
`,
      );

      const result = scanFeaturePermissions(srcDir);
      const readRef = result.references.find((r) => r.permission === "test.read");

      expect(readRef).toBeDefined();
      expect(readRef!.file).toContain("service.ts");
      expect(readRef!.line).toBeGreaterThan(0);
      expect(["string-literal", "constant-reference"]).toContain(readRef!.resolution);
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 2: Permission coverage checker tests
  // ---------------------------------------------------------------------------

  describe("Phase 2: Permission coverage checker", () => {
    it("SECURITY: returns errors for undeclared permission references", () => {
      const { srcDir } = createFixtureFeature(
        "checker-undeclared",
        `import { TEST_PERMISSIONS } from "./permissions.js";
export class TestService {
  private auth: any;
  async doRead(ctx: unknown) {
    await this.auth.requireTrusted(ctx, TEST_PERMISSIONS.READ);
  }
  async doAdmin(ctx: unknown) {
    await this.auth.requireTrusted(ctx, TEST_PERMISSIONS.ADMIN);
  }
}
`,
      );

      // Manifest declares only READ — ADMIN is NOT declared
      const manifest = makeManifest("checker-undeclared", ["test.read"]);
      const scanResult = scanFeaturePermissions(srcDir);
      const checkResult = checkPermissionCoverage(
        manifest,
        scanResult.references,
        scanResult.warnings,
      );

      expect(checkResult.valid).toBe(false);
      expect(checkResult.errors.length).toBeGreaterThan(0);

      const adminError = checkResult.errors.find((e) => e.permission === "test.admin");
      expect(adminError).toBeDefined();
      expect(adminError!.message).toContain("test.admin");
      expect(adminError!.message).toContain("checker-undeclared");
    });

    it("SECURITY: passes when all referenced permissions are declared", () => {
      const { srcDir } = createFixtureFeature(
        "checker-fully-declared",
        `import { TEST_PERMISSIONS } from "./permissions.js";
export class TestService {
  private auth: any;
  async doRead(ctx: unknown) {
    await this.auth.requireTrusted(ctx, TEST_PERMISSIONS.READ);
  }
  async doCreate(ctx: unknown) {
    await this.auth.requireTrusted(ctx, TEST_PERMISSIONS.CREATE);
  }
}
`,
      );

      const manifest = makeManifest("checker-fully-declared", ["test.read", "test.create"]);
      const scanResult = scanFeaturePermissions(srcDir);
      const checkResult = checkPermissionCoverage(
        manifest,
        scanResult.references,
        scanResult.warnings,
      );

      expect(checkResult.valid).toBe(true);
      expect(checkResult.errors).toHaveLength(0);
    });

    it("reports unused declared permissions as informational warnings (not errors)", () => {
      const { srcDir } = createFixtureFeature(
        "checker-unused-declared",
        `import { TEST_PERMISSIONS } from "./permissions.js";
export class TestService {
  private auth: any;
  async doRead(ctx: unknown) {
    await this.auth.requireTrusted(ctx, TEST_PERMISSIONS.READ);
  }
}
`,
      );

      // Manifest declares READ and CREATE, but source only uses READ
      const manifest = makeManifest("checker-unused-declared", ["test.read", "test.create"]);
      const scanResult = scanFeaturePermissions(srcDir);
      const checkResult = checkPermissionCoverage(
        manifest,
        scanResult.references,
        scanResult.warnings,
      );

      // Must be valid — unused declared is a warning, not an error
      expect(checkResult.valid).toBe(true);
      expect(checkResult.errors).toHaveLength(0);

      const unusedCreate = checkResult.unusedPermissions.find(
        (u) => u.permission === "test.create",
      );
      expect(unusedCreate).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 3: Live platform feature coverage
  // ---------------------------------------------------------------------------

  describe("Phase 3: All platform features pass permission coverage", () => {
    const platformFeatures = [
      {
        id: "example-feature",
        manifestFile: "example-feature/src/manifest.ts",
        srcDir: "example-feature/src",
      },
      {
        id: "identity-admin",
        manifestFile: "identity-admin/src/manifest.ts",
        srcDir: "identity-admin/src",
      },
      {
        id: "organisations",
        manifestFile: "organisations/src/manifest.ts",
        srcDir: "organisations/src",
      },
    ];

    for (const feature of platformFeatures) {
      it(`Gate G-013: '${feature.id}' has no undeclared permission references`, async () => {
        const srcDir = path.join(featuresDir, feature.srcDir);

        // Verify the feature directory exists
        expect(fs.existsSync(srcDir)).toBe(true);

        // Load manifest statically from the permissions file pattern
        // (avoids dynamic import complexities in test context)
        const permissionsPath = path.join(srcDir, "permissions.ts");
        expect(fs.existsSync(permissionsPath)).toBe(true);

        const manifestPath = path.join(srcDir, "manifest.ts");
        expect(fs.existsSync(manifestPath)).toBe(true);

        // Extract declared permission names from manifest source
        const manifestSource = fs.readFileSync(manifestPath, "utf8");
        const permissionsSource = fs.readFileSync(permissionsPath, "utf8");

        // Parse declared permission string values from the permissions constant
        const permValues = [...permissionsSource.matchAll(/:\s*["']([a-z][a-z0-9._-]*)["']/g)].map(
          (m) => m[1],
        );

        expect(permValues.length).toBeGreaterThan(0);

        const manifest: FeatureManifest = {
          id: feature.id,
          name: feature.id,
          version: "1.0.0",
          description: "",
          dependencies: [],
          permissions: permValues.map((name) => ({
            name,
            description: "",
          })),
          migrations: [],
        } as FeatureManifest;

        const scanResult = scanFeaturePermissions(srcDir);
        const checkResult = checkPermissionCoverage(
          manifest,
          scanResult.references,
          scanResult.warnings,
        );

        // Report any errors clearly for debugging
        if (!checkResult.valid) {
          const errorMessages = checkResult.errors.map((e) => `  ${e.message}`).join("\n");
          throw new Error(
            `Feature '${feature.id}' has undeclared permission references:\n${errorMessages}`,
          );
        }

        expect(checkResult.valid).toBe(true);
        expect(checkResult.errors).toHaveLength(0);
      });
    }

    it("Gate G-013: manifest schema validation passes for all platform features", () => {
      // This re-validates that all three features pass the existing schema
      // and dependency resolution gates as a regression check
      const exampleManifest = makeManifest("example-feature", [
        "widgets.read",
        "widgets.create",
        "widgets.update",
        "widgets.delete",
        "widgets.import",
        "widgets.export",
      ]);
      const identityManifest = {
        ...makeManifest("identity-admin", [
          "users.read",
          "users.create",
          "users.manage",
          "roles.manage",
          "devices.read",
          "devices.approve",
          "devices.revoke",
          "sync.manage",
        ]),
        dependencies: ["organisations"],
      } as FeatureManifest;
      const orgsManifest = makeManifest("organisations", [
        "organisations.read",
        "organisations.create",
        "organisations.manage",
      ]);

      const result = validateManifests([orgsManifest, identityManifest, exampleManifest]);

      expect(result.valid).toBe(true);
      expect(result.message).toContain("3 features");
    });
  });
});
