import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../");

interface TauriCapabilityFile {
  $schema?: string;
  identifier: string;
  description?: string;
  windows: string[];
  webviews?: string[];
  permissions: string[];
}

interface TauriConfig {
  app?: {
    security?: {
      csp?: string | null;
    };
  };
}

describe("Security Regression Suite — Tauri Capability & Boundary Governance (WP-020)", () => {
  const capabilitiesDir = path.join(
    workspaceRoot,
    "apps/demo/src-tauri/capabilities",
  );
  const tauriConfPath = path.join(
    workspaceRoot,
    "apps/demo/src-tauri/tauri.conf.json",
  );

  it("Invariant #8: every capability file must be scoped narrowly, non-empty, and contain justification", () => {
    expect(fs.existsSync(capabilitiesDir)).toBe(true);
    const files = fs
      .readdirSync(capabilitiesDir)
      .filter((f) => f.endsWith(".json"));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const fullPath = path.join(capabilitiesDir, file);
      const content = JSON.parse(
        fs.readFileSync(fullPath, "utf8"),
      ) as TauriCapabilityFile;

      // Invariant #8: Must have explicit identifier
      expect(content.identifier).toBeDefined();
      expect(typeof content.identifier).toBe("string");
      expect(content.identifier.length).toBeGreaterThan(0);

      // Invariant #8: Must have commented/descriptive justification
      expect(content.description).toBeDefined();
      expect(typeof content.description).toBe("string");
      expect(content.description!.trim().length).toBeGreaterThanOrEqual(20);

      // Invariant #8: Must specify explicit window bindings (no wildcard)
      expect(Array.isArray(content.windows)).toBe(true);
      expect(content.windows.length).toBeGreaterThan(0);
      expect(content.windows).not.toContain("*");

      // Invariant #8: Must NOT grant broad blanket permissions
      expect(content.permissions).not.toContain("core:default");
      expect(content.permissions).not.toContain("core:event:default"); // Must be granular allow-listen/unlisten

      // Never grant shell, filesystem, or OS process execution to webview
      for (const perm of content.permissions) {
        expect(perm).not.toMatch(/^core:shell/);
        expect(perm).not.toMatch(/^core:fs/);
        expect(perm).not.toMatch(/^core:process/);
      }
    }
  });

  it("Gate G-05: Tauri CSP is strictly least-privilege without unsafe-inline or unsafe-eval", () => {
    expect(fs.existsSync(tauriConfPath)).toBe(true);
    const config = JSON.parse(
      fs.readFileSync(tauriConfPath, "utf8"),
    ) as TauriConfig;

    const csp = config.app?.security?.csp;
    expect(csp).toBeDefined();
    expect(typeof csp).toBe("string");

    // Must restrict default-src to 'self'
    expect(csp).toContain("default-src 'self'");

    // Must NOT allow arbitrary inline scripts or eval
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
