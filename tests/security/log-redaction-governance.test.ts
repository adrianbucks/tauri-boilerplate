import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleLogger } from "@platform/core";

describe("Security Regression Suite — log redaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redacts sensitive values recursively inside arrays and circular metadata", () => {
    const logSink = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    cyclic.signing_key = "private-signing-material";

    new ConsoleLogger("info").info("security event", {
      data: {
        records: [
          {
            private_key: "private-key-material",
            ed25519Seed: "private-seed-material",
            refreshToken: "refresh-token-material",
            safeValue: "visible",
          },
        ],
        cyclic,
        largeCount: 12n,
      },
    });

    const serialized = String(logSink.mock.calls[0]?.[0]);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[Circular]");
    expect(serialized).toContain("visible");
    expect(serialized).toContain('"largeCount":"12"');
    expect(serialized).not.toContain("private-key-material");
    expect(serialized).not.toContain("private-seed-material");
    expect(serialized).not.toContain("refresh-token-material");
    expect(serialized).not.toContain("private-signing-material");
  });
});
