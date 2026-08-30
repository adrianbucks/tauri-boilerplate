import { describe, it, expect } from "vitest";

// Static imports — resolved at bundle time, no async WASM initialization delay.
// DOM/interaction tests live in the Tauri E2E Playwright suite.
import { exampleFeatureManifest } from "@features/example-feature";
import { organisationsManifest } from "@features/organisations";
import { identityAdminManifest } from "@features/identity-admin";
import { Platform } from "@platform/platform";

describe("@apps/demo (smoke)", () => {
  it("Platform class is constructable", () => {
    expect(Platform).toBeDefined();
    expect(typeof Platform).toBe("function");
  });

  it("resolves example-feature manifest", () => {
    expect(exampleFeatureManifest.id).toBe("example-feature");
    expect(exampleFeatureManifest.permissions.length).toBeGreaterThan(0);
  });

  it("resolves organisations manifest", () => {
    expect(organisationsManifest.id).toBe("organisations");
    expect(organisationsManifest.permissions.length).toBeGreaterThan(0);
  });

  it("resolves identity-admin manifest", () => {
    expect(identityAdminManifest.id).toBe("identity-admin");
    expect(identityAdminManifest.dependencies).toContain("organisations");
  });
});
