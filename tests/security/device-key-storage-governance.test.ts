import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");

describe("Security Regression Suite — Device Key Storage Governance", () => {
  it("creates keys exclusively with restrictive permissions and rejects symlink paths", () => {
    const provider = fs.readFileSync(
      path.join(workspaceRoot, "crates/identity-core/src/provider.rs"),
      "utf8",
    );

    expect(provider).toContain("OpenOptions::new()");
    expect(provider).toContain("options.mode(0o600)");
    expect(provider).toContain("fs::hard_link(&temp_path, path)");
    expect(provider).toContain("fs::symlink_metadata(path)");
    expect(provider).toContain("metadata.file_type().is_symlink()");
    expect(provider).toContain("concurrent_creators_use_the_same_persisted_identity");
    expect(provider).toContain("existing_key_permissions_are_restricted_on_load");
  });

  it("zeroizes seed buffers and the Ed25519 signing key on drop", () => {
    const provider = fs.readFileSync(
      path.join(workspaceRoot, "crates/identity-core/src/provider.rs"),
      "utf8",
    );
    const manifest = fs.readFileSync(
      path.join(workspaceRoot, "crates/identity-core/Cargo.toml"),
      "utf8",
    );

    expect(provider).toContain("use zeroize::Zeroizing;");
    expect(provider).toContain("Zeroizing::new([0u8; 32])");
    expect(provider).toContain("key_file.take(33).read_to_end(&mut bytes)?");
    const unixPermissionRestriction = provider.indexOf("key_file.set_permissions(");
    const boundedKeyRead = provider.indexOf("key_file.take(33).read_to_end(&mut bytes)?");
    expect(unixPermissionRestriction).toBeGreaterThan(-1);
    expect(boundedKeyRead).toBeGreaterThan(unixPermissionRestriction);
    expect(manifest).toMatch(/ed25519-dalek\s*=.*"zeroize"/);
    expect(manifest).toContain('zeroize = { version = "1.9"');
  });
});
