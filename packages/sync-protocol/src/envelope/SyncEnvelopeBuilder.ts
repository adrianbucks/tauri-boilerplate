import { generateCorrelationId, getUtcIsoTimestamp } from "@platform/core";
import { HybridLogicalClock } from "../hlc/HybridLogicalClock.js";
import type { OperationType, SyncEnvelope, SyncOperation } from "../types.js";

export const MAX_SYNC_ENVELOPE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Callback signature for native Ed25519 signing.
 * The signing function receives the canonical UTF-8 bytes of the operation
 * and must return a hex-encoded 64-byte signature string.
 *
 * This callback pattern ensures the native private key is NEVER passed to or
 * held within the TypeScript runtime (Invariant #5).
 */
export type SignFn = (canonicalBytes: Uint8Array) => Promise<string>;

/**
 * Callback signature for Ed25519 signature verification.
 * Returns true if the signature is valid for the given public key and bytes.
 */
export type VerifyFn = (
  signerPublicKey: string,
  canonicalBytes: Uint8Array,
  signatureHex: string,
) => Promise<boolean>;

/**
 * Builds and verifies signed SyncEnvelopes.
 *
 * Canonical serialization: the SyncOperation's fields are serialized as JSON
 * with keys sorted alphabetically. This produces a deterministic byte sequence
 * that both the signer and verifier independently reproduce.
 */
export class SyncEnvelopeBuilder {
  /**
   * Serializes a SyncOperation to its canonical UTF-8 bytes for signing/verification.
   * Keys are sorted alphabetically at every nesting level.
   */
  static canonicalize(operation: SyncOperation): Uint8Array {
    validateOperation(operation);
    const canonical = JSON.stringify(sortedKeys(operation));
    return new TextEncoder().encode(canonical);
  }

  /** Validates an untrusted runtime value before treating it as an envelope. */
  static validateEnvelope(envelope: unknown): asserts envelope is SyncEnvelope {
    if (!isRecord(envelope)) {
      throw new Error("Invalid sync envelope");
    }
    validateOperation(envelope.operation);
    if (envelope.envelopeId !== envelope.operation.operationId) {
      throw new Error("Envelope ID must match operation ID");
    }
    if (
      typeof envelope.signedAt !== "string" ||
      !Number.isFinite(Date.parse(envelope.signedAt)) ||
      new Date(envelope.signedAt).toISOString() !== envelope.signedAt
    ) {
      throw new Error("Invalid envelope signing timestamp");
    }
    validatePublicKeyFormat(envelope.signerPublicKey);
    if (typeof envelope.signature !== "string" || !isValidSignatureHex(envelope.signature)) {
      throw new Error("Invalid envelope signature format");
    }

    let serializedEnvelope: string | undefined;
    try {
      serializedEnvelope = JSON.stringify(envelope);
    } catch {
      throw new Error("Sync envelope is not serializable");
    }
    if (typeof serializedEnvelope !== "string") {
      throw new Error("Sync envelope is not serializable");
    }
    if (new TextEncoder().encode(serializedEnvelope).byteLength > MAX_SYNC_ENVELOPE_SIZE_BYTES) {
      throw new Error(
        `Sync envelope exceeds the ${MAX_SYNC_ENVELOPE_SIZE_BYTES}-byte transport limit`,
      );
    }
  }

  /**
   * Builds a signed SyncEnvelope by calling the provided `signFn` over the
   * canonical bytes of the inner SyncOperation.
   *
   * @param operation - The sync operation to wrap.
   * @param signerPublicKey - The canonical `ed25519_pk_<hex>` string.
   * @param signFn - Async native signing callback (must not expose private key).
   */
  static async build(
    operation: SyncOperation,
    signerPublicKey: string,
    signFn: SignFn,
  ): Promise<SyncEnvelope> {
    // Keep the operation stable across the asynchronous native signing call.
    // Otherwise a caller could mutate its object after canonicalization and
    // cause the returned envelope to contain data the signature does not cover.
    const operationSnapshot = structuredClone(operation);
    validateOperation(operationSnapshot);
    validatePublicKeyFormat(signerPublicKey);
    const canonicalBytes = SyncEnvelopeBuilder.canonicalize(operationSnapshot);
    if (canonicalBytes.byteLength > MAX_SYNC_ENVELOPE_SIZE_BYTES) {
      throw new Error(
        `Sync operation exceeds the ${MAX_SYNC_ENVELOPE_SIZE_BYTES}-byte transport limit`,
      );
    }
    const signature = await signFn(canonicalBytes);
    validateSignatureFormat(signature);

    const envelope: SyncEnvelope = {
      envelopeId: operationSnapshot.operationId,
      signedAt: getUtcIsoTimestamp(),
      signerPublicKey,
      signature,
      operation: operationSnapshot,
    };
    SyncEnvelopeBuilder.validateEnvelope(envelope);
    return envelope;
  }

  /**
   * Verifies the signature on an existing SyncEnvelope.
   *
   * @returns `true` if the signature is valid; `false` if verification fails.
   */
  static async verify(envelope: SyncEnvelope, verifyFn: VerifyFn): Promise<boolean> {
    try {
      SyncEnvelopeBuilder.validateEnvelope(envelope);
    } catch {
      return false;
    }
    const canonicalBytes = SyncEnvelopeBuilder.canonicalize(envelope.operation);
    return verifyFn(envelope.signerPublicKey, canonicalBytes, envelope.signature);
  }

  /**
   * Creates a deterministic envelope ID (aliased to operationId for idempotency).
   */
  static generateEnvelopeId(): string {
    return generateCorrelationId("env");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deep-sorts all keys of an object alphabetically, recursively.
 * Arrays are preserved in order; array elements that are objects are sorted.
 */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortedKeys);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      // Assignment to `__proto__` changes an ordinary object's prototype
      // instead of preserving that own property. Canonical bytes must include
      // every own key so signatures bind the complete payload.
      Object.defineProperty(sorted, key, {
        configurable: true,
        enumerable: true,
        value: sortedKeys(obj[key]),
        writable: true,
      });
    }
    return sorted;
  }
  return value;
}

function validatePublicKeyFormat(publicKey: unknown): asserts publicKey is string {
  if (typeof publicKey !== "string" || !/^ed25519_pk_[0-9a-f]{64}$/.test(publicKey)) {
    throw new Error(
      `Invalid signer public key format. Expected 'ed25519_pk_<64-hex-chars>', got: '${publicKey}'`,
    );
  }
}

const OPERATION_TYPES = new Set<OperationType>(["create", "update", "delete"]);
const REQUIRED_OPERATION_FIELDS = [
  "operationId",
  "applicationId",
  "organisationId",
  "syncGroupId",
  "featureId",
  "entityType",
  "entityId",
  "authorId",
  "deviceId",
  "logicalTimestamp",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOperation(operation: unknown): asserts operation is SyncOperation {
  if (!isRecord(operation)) {
    throw new Error("Invalid sync operation");
  }
  for (const field of REQUIRED_OPERATION_FIELDS) {
    const value = operation[field];
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 1_024) {
      throw new Error(`Invalid sync operation field: ${field}`);
    }
  }
  if (!OPERATION_TYPES.has(operation.operation as OperationType)) {
    throw new Error("Invalid sync operation type");
  }
  if (
    !Number.isSafeInteger(operation.schemaVersion) ||
    (operation.schemaVersion as number) < 1 ||
    !Number.isSafeInteger(operation.protocolVersion) ||
    (operation.protocolVersion as number) < 1
  ) {
    throw new Error("Invalid sync operation version");
  }
  if (!Object.hasOwn(operation, "payload") || operation.payload === undefined) {
    throw new Error("Sync operation payload is required");
  }
  HybridLogicalClock.parse(operation.logicalTimestamp as string);
  const serialized = JSON.stringify(sortedKeys(operation));
  if (typeof serialized !== "string") {
    throw new Error("Sync operation is not serializable");
  }
}

function isValidSignatureHex(signature: string): boolean {
  return /^[0-9a-f]{128}$/.test(signature);
}

function validateSignatureFormat(signature: string): void {
  if (!isValidSignatureHex(signature)) {
    throw new Error(
      `Invalid signature format: expected 128-char lowercase hex string (64 raw bytes), got length ${signature.length}`,
    );
  }
}
