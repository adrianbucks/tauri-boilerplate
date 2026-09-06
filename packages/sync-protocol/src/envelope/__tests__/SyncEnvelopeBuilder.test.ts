import { describe, it, expect } from "vitest";
import { SyncEnvelopeBuilder } from "../SyncEnvelopeBuilder.js";
import type { SyncOperation } from "../../types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A fake 64-byte (128-hex-char) signature used for deterministic tests. */
const FAKE_SIG = "a".repeat(128);
/** A valid `ed25519_pk_<64-hex>` format public key (75 chars). */
const FAKE_PK = "ed25519_pk_" + "b".repeat(64);

const makeOperation = (overrides?: Partial<SyncOperation>): SyncOperation => ({
  operationId: "op_test_001",
  applicationId: "com.platform.test",
  organisationId: "org_acme",
  syncGroupId: "grp_warehouse",
  featureId: "inventory",
  entityType: "widgets",
  entityId: "entity_001",
  operation: "create",
  payload: { name: "Widget A", stock: 10 },
  authorId: "user_admin",
  deviceId: "dev_node_1",
  logicalTimestamp: "2026-09-06T12:00:00.000Z|0|dev_node_1",
  schemaVersion: 1,
  protocolVersion: 1,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncEnvelopeBuilder", () => {
  describe("canonicalize()", () => {
    it("produces the same bytes for the same operation regardless of key insertion order", () => {
      const op1 = makeOperation();
      const op2: SyncOperation = {
        protocolVersion: op1.protocolVersion,
        schemaVersion: op1.schemaVersion,
        logicalTimestamp: op1.logicalTimestamp,
        deviceId: op1.deviceId,
        authorId: op1.authorId,
        payload: op1.payload,
        operation: op1.operation,
        entityId: op1.entityId,
        entityType: op1.entityType,
        featureId: op1.featureId,
        syncGroupId: op1.syncGroupId,
        organisationId: op1.organisationId,
        applicationId: op1.applicationId,
        operationId: op1.operationId,
      };

      const bytes1 = SyncEnvelopeBuilder.canonicalize(op1);
      const bytes2 = SyncEnvelopeBuilder.canonicalize(op2);
      expect(bytes1).toEqual(bytes2);
    });

    it("produces different bytes for different operations", () => {
      const op1 = makeOperation({ entityId: "entity_001" });
      const op2 = makeOperation({ entityId: "entity_002" });
      const bytes1 = SyncEnvelopeBuilder.canonicalize(op1);
      const bytes2 = SyncEnvelopeBuilder.canonicalize(op2);
      expect(bytes1).not.toEqual(bytes2);
    });

    it("produces different bytes when payload differs", () => {
      const op1 = makeOperation({ payload: { stock: 10 } });
      const op2 = makeOperation({ payload: { stock: 11 } });
      const bytes1 = SyncEnvelopeBuilder.canonicalize(op1);
      const bytes2 = SyncEnvelopeBuilder.canonicalize(op2);
      expect(bytes1).not.toEqual(bytes2);
    });
  });

  describe("build()", () => {
    it("builds a valid signed envelope", async () => {
      const op = makeOperation();
      const signFn = async (_bytes: Uint8Array) => FAKE_SIG;

      const envelope = await SyncEnvelopeBuilder.build(op, FAKE_PK, signFn);

      expect(envelope.envelopeId).toBe(op.operationId);
      expect(envelope.signerPublicKey).toBe(FAKE_PK);
      expect(envelope.signature).toBe(FAKE_SIG);
      expect(envelope.operation).toStrictEqual(op);
      expect(envelope.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("rejects an invalid public key format", async () => {
      const op = makeOperation();
      const signFn = async (_bytes: Uint8Array) => FAKE_SIG;

      await expect(
        SyncEnvelopeBuilder.build(op, "not_a_valid_key", signFn),
      ).rejects.toThrow("Invalid signer public key format");
    });

    it("rejects if signFn returns an invalid signature format", async () => {
      const op = makeOperation();
      const badSignFn = async (_bytes: Uint8Array) => "tooshort";

      await expect(
        SyncEnvelopeBuilder.build(op, FAKE_PK, badSignFn),
      ).rejects.toThrow("Invalid signature format");
    });
  });

  describe("verify()", () => {
    it("returns true when verifyFn confirms the signature", async () => {
      const op = makeOperation();
      const signFn = async (_bytes: Uint8Array) => FAKE_SIG;
      const envelope = await SyncEnvelopeBuilder.build(op, FAKE_PK, signFn);

      const verifyFn = async (
        _pk: string,
        _bytes: Uint8Array,
        _sig: string,
      ) => true;
      const isValid = await SyncEnvelopeBuilder.verify(envelope, verifyFn);
      expect(isValid).toBe(true);
    });

    it("returns false when verifyFn rejects the signature", async () => {
      const op = makeOperation();
      const signFn = async (_bytes: Uint8Array) => FAKE_SIG;
      const envelope = await SyncEnvelopeBuilder.build(op, FAKE_PK, signFn);

      const verifyFn = async (
        _pk: string,
        _bytes: Uint8Array,
        _sig: string,
      ) => false;
      const isValid = await SyncEnvelopeBuilder.verify(envelope, verifyFn);
      expect(isValid).toBe(false);
    });

    it("returns false for an envelope with an invalid signature format", async () => {
      const op = makeOperation();
      const envelope = {
        envelopeId: op.operationId,
        signedAt: new Date().toISOString(),
        signerPublicKey: FAKE_PK,
        signature: "badformat",
        operation: op,
      };

      const verifyFn = async () => true;
      const isValid = await SyncEnvelopeBuilder.verify(envelope, verifyFn);
      expect(isValid).toBe(false);
    });

    it("verifyFn receives the canonical bytes matching those used at sign time", async () => {
      const op = makeOperation();
      const capturedSignBytes: Uint8Array[] = [];
      const capturedVerifyBytes: Uint8Array[] = [];

      const signFn = async (bytes: Uint8Array) => {
        capturedSignBytes.push(bytes);
        return FAKE_SIG;
      };
      const verifyFn = async (
        _pk: string,
        bytes: Uint8Array,
        _sig: string,
      ) => {
        capturedVerifyBytes.push(bytes);
        return true;
      };

      const envelope = await SyncEnvelopeBuilder.build(op, FAKE_PK, signFn);
      await SyncEnvelopeBuilder.verify(envelope, verifyFn);

      expect(capturedSignBytes[0]).toEqual(capturedVerifyBytes[0]);
    });
  });
});
