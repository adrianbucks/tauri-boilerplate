import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");

describe("Security Regression Suite — Diagnostics Command Governance", () => {
  it("keeps renderer diagnostics on the fixed native API instead of caller-supplied SQL", () => {
    const diagnosticsPage = fs.readFileSync(
      path.join(workspaceRoot, "apps/demo/src/pages/DiagnosticsPage.tsx"),
      "utf8",
    );
    const nativeCommands = fs.readFileSync(
      path.join(workspaceRoot, "apps/demo/src-tauri/src/lib.rs"),
      "utf8",
    );

    expect(diagnosticsPage).toContain('("get_diagnostics_counts")');
    expect(diagnosticsPage).not.toContain('invoke("db_query"');
    expect(diagnosticsPage).not.toMatch(/SELECT\s+COUNT\s*\(/i);
    expect(nativeCommands).toContain("fn get_diagnostics_counts(");
    expect(nativeCommands).toContain('"SELECT COUNT(*) AS cnt FROM core_sync_outbox');
    expect(nativeCommands).toContain("get_diagnostics_counts,");
  });
});
