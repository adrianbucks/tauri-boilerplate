import { describe, it, expect } from "vitest";
import { HandshakeValidator, canonicalizeHandshake } from "../HandshakeProtocol.js";
import type { HandshakeMessage, HandshakeValidationOptions } from "../HandshakeProtocol.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_NONCE = "a".repeat(32); // 32 lowercase hex chars
const FAKE_SIG = "b".repeat(128); // 128 lowercase hex chars
const FAKE_PK = "ed25519_pk_" + "c".repeat(64); // 75 chars

const makeValidMessage = (
  overrides?: Partial<HandshakeMessage>,
): HandshakeMessage => ({
  applicationId: "tauri-boilerplate-demo",
  applicationVersion: "0.1.0",
  protocolVersion: 1,
  deviceId: "dev_peer_1",
  organisationId: "org_acme",
  platform: "windows",
  supportedFeatures: ["example-feature"],
  supportedEntityVersions: { widgets: 1 },
  timestamp: new Date().toISOString(),
  nonce: VALID_NONCE,
  signerPublicKey: FAKE_PK,
  signature: FAKE_SIG,
  ...overrides,
});

const makeOptions = (
  overrides?: Partial<HandshakeValidationOptions>,
): HandshakeValidationOptions => ({
  expectedApplicationId: "tauri-boilerplate-demo",
  expectedOrganisationId: "org_acme",
  minimumProtocolVersion: 1,
  currentProtocolVersion: 1,
  maxTimestampSkewMs: 30_000,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Sync validation
// ---------------------------------------------------------------------------

describe("HandshakeValidator.validate()", () => {
  it("accepts a valid handshake message", () => {
    const result = HandshakeValidator.validate(
      makeValidMessage(),
      makeOptions(),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a mismatched application ID", () => {
    const result = HandshakeValidator.validate(
      makeValidMessage({ applicationId: "other-app" }),
      makeOptions(),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("APP_ID_MISMATCH");
  });

  it("rejects a cross-organisation handshake", () => {
    const result = HandshakeValidator.validate(
      makeValidMessage({ organisationId: "org_other" }),
      makeOptions(),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("ORG_ID_MISMATCH");
  });

  it("rejects an incompatible protocol version", () => {
    const result = HandshakeValidator.validate(
      makeValidMessage({ protocolVersion: 0 }),
      makeOptions(),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("PROTOCOL_INCOMPATIBLE");
  });

  it("rejects a timestamp that is too old", () => {
    const oldTimestamp = new Date(Date.now() - 60_000).toISOString();
    const result = HandshakeValidator.validate(
      makeValidMessage({ timestamp: oldTimestamp }),
      makeOptions({ maxTimestampSkewMs: 30_000 }),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TIMESTAMP_SKEW");
  });

  it("rejects a timestamp that is too far in the future", () => {
    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
    const result = HandshakeValidator.validate(
      makeValidMessage({ timestamp: futureTimestamp }),
      makeOptions({ maxTimestampSkewMs: 30_000 }),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TIMESTAMP_SKEW");
  });

  it("rejects an invalid (non-ISO) timestamp", () => {
    const result = HandshakeValidator.validate(
      makeValidMessage({ timestamp: "not-a-date" }),
      makeOptions(),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TIMESTAMP_SKEW");
  });

  it("rejects a nonce with invalid format", () => {
    const result = HandshakeValidator.validate(
      makeValidMessage({ nonce: "tooshort" }),
      makeOptions(),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("NONCE_INVALID");
  });

  it("rejects a replayed nonce", () => {
    const seenNonces = new Set([VALID_NONCE]);
    const result = HandshakeValidator.validate(
      makeValidMessage({ nonce: VALID_NONCE }),
      makeOptions({ seenNonces }),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("NONCE_REPLAYED");
  });

  it("accepts a nonce that has not been seen before", () => {
    const seenNonces = new Set(["d".repeat(32)]);
    const result = HandshakeValidator.validate(
      makeValidMessage({ nonce: VALID_NONCE }),
      makeOptions({ seenNonces }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an invalid signer public key format", () => {
    const result = HandshakeValidator.validate(
      makeValidMessage({ signerPublicKey: "not_a_key" }),
      makeOptions(),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("PUBLIC_KEY_INVALID");
  });

  it("rejects a signature with invalid format", () => {
    const result = HandshakeValidator.validate(
      makeValidMessage({ signature: "short" }),
      makeOptions(),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("SIGNATURE_INVALID");
  });
});

// ---------------------------------------------------------------------------
// Async requireValid
// ---------------------------------------------------------------------------

describe("HandshakeValidator.requireValid()", () => {
  it("passes when all checks and verifyFn succeed", async () => {
    const seenNonces = new Set<string>();
    const verifyFn = async () => true;

    await expect(
      HandshakeValidator.requireValid(
        makeValidMessage(),
        makeOptions({ seenNonces, verifyFn }),
        "corr_001",
      ),
    ).resolves.toBeUndefined();

    // Nonce should be recorded after success
    expect(seenNonces.has(VALID_NONCE)).toBe(true);
  });

  it("throws when verifyFn returns false (signature mismatch)", async () => {
    const verifyFn = async () => false;

    await expect(
      HandshakeValidator.requireValid(
        makeValidMessage(),
        makeOptions({ verifyFn }),
        "corr_002",
      ),
    ).rejects.toThrow("cryptographic signature is invalid");
  });

  it("throws on replayed nonce before calling verifyFn", async () => {
    const seenNonces = new Set([VALID_NONCE]);
    let verifyFnCalled = false;
    const verifyFn = async () => {
      verifyFnCalled = true;
      return true;
    };

    await expect(
      HandshakeValidator.requireValid(
        makeValidMessage(),
        makeOptions({ seenNonces, verifyFn }),
        "corr_003",
      ),
    ).rejects.toThrow("NONCE_REPLAYED");

    expect(verifyFnCalled).toBe(false);
  });

  it("does not record nonce when validation fails", async () => {
    const seenNonces = new Set<string>();
    const verifyFn = async () => false;

    try {
      await HandshakeValidator.requireValid(
        makeValidMessage(),
        makeOptions({ seenNonces, verifyFn }),
        "corr_004",
      );
    } catch {
      // expected
    }

    // Nonce should NOT be recorded after signature failure
    expect(seenNonces.has(VALID_NONCE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

describe("canonicalizeHandshake()", () => {
  it("excludes the signature field from canonical bytes", () => {
    const msg = makeValidMessage({ signature: FAKE_SIG });
    const bytes = canonicalizeHandshake(msg);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).not.toContain("signature");
  });

  it("is deterministic regardless of insertion order", () => {
    const msg1 = makeValidMessage();
    const msg2 = makeValidMessage();
    expect(canonicalizeHandshake(msg1)).toEqual(canonicalizeHandshake(msg2));
  });

  it("differs when any field value differs", () => {
    const msg1 = makeValidMessage({ nonce: "a".repeat(32) });
    const msg2 = makeValidMessage({ nonce: "f".repeat(32) });
    expect(canonicalizeHandshake(msg1)).not.toEqual(canonicalizeHandshake(msg2));
  });
});
