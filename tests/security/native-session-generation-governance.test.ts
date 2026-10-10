import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");

describe("Security Regression Suite — Native Session Transition Ordering", () => {
  it("prevents stale authentication from restoring a logged-out session", () => {
    const source = fs.readFileSync(
      path.join(workspaceRoot, "crates/native-core/src/session.rs"),
      "utf8",
    );

    expect(source).toContain("generation: AtomicU64");
    expect(source).toContain("fn commit_authentication(");
    expect(source).toContain("self.generation.load(Ordering::Acquire) != generation");
    expect(source).toContain("self.generation.fetch_add(1, Ordering::AcqRel)");
    expect(source).toContain("stale_authentication_cannot_restore_a_session_after_logout");
  });
});
