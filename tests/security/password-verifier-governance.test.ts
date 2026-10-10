import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");

describe("Security Regression Suite — Password Verifier Bounds", () => {
  it("bounds stored PHC input and pins the accepted Argon2id profile", () => {
    const source = fs.readFileSync(
      path.join(workspaceRoot, "crates/crypto-core/src/password.rs"),
      "utf8",
    );

    expect(source).toContain("MAX_STORED_VERIFIER_BYTES: usize = 512");
    expect(source).toContain('EXPECTED_PARAMS: &str = "m=19456,t=2,p=1"');
    expect(source).toContain('parsed.algorithm.as_str() != "argon2id"');
    expect(source).toContain("parsed.version != Some(19)");
    expect(source).toContain("rejects_untrusted_verification_costs_before_argon2_work");
  });
});
