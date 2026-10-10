import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");

describe("Security Regression Suite — Native Signature Input Bounds", () => {
  it("bounds message and signature input before hex decoding", () => {
    const provider = fs.readFileSync(
      path.join(workspaceRoot, "crates/identity-core/src/provider.rs"),
      "utf8",
    );
    expect(provider).toContain("MAX_SIGNED_MESSAGE_BYTES: usize = 10 * 1024 * 1024");
    expect(provider).toContain("validate_message_hex_length(encoded_length: usize)");
    expect(provider).toContain(
      "pub fn sign(&self, message: &[u8]) -> Result<Vec<u8>, DeviceKeyError>",
    );
    expect(provider).toContain("signing_rejects_messages_above_the_provider_limit");
    expect(provider).toContain("if signature_hex.len() != 128");
    expect(provider).toContain("if clean_hex.len() != 64");
    expect(provider).toContain("message_hex_length_is_bounded_before_decoding");

    for (const app of ["demo", "minimal-consumer"]) {
      const source = fs.readFileSync(
        path.join(workspaceRoot, `apps/${app}/src-tauri/src/lib.rs`),
        "utf8",
      );
      expect(source).toContain("validate_message_hex_length(request.message_hex.len())");
    }
  });
});
