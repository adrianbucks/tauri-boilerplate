import { generateCorrelationId, getUtcIsoTimestamp } from "@platform/core";
import type { SyncEnvelope, SyncOperation } from "../types.js";

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
    const canonical = JSON.stringify(sortedKeys(operation));
    return new TextEncoder().encode(canonical);
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
    validatePublicKeyFormat(signerPublicKey);
    const canonicalBytes = SyncEnvelopeBuilder.canonicalize(operation);
    const signature = await signFn(canonicalBytes);
    validateSignatureFormat(signature);

    return {
      envelopeId: operation.operationId,
      signedAt: getUtcIsoTimestamp(),
      signerPublicKey,
      signature,
      operation,
    };
  }

  /**
   * Verifies the signature on an existing SyncEnvelope.
   *
   * @returns `true` if the signature is valid; `false` if verification fails.
   */
  static async verify(
    envelope: SyncEnvelope,
    verifyFn: VerifyFn,
  ): Promise<boolean> {
    validatePublicKeyFormat(envelope.signerPublicKey);
    if (!isValidSignatureHex(envelope.signature)) {
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
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortedKeys(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

function validatePublicKeyFormat(publicKey: string): void {
  if (!publicKey.startsWith("ed25519_pk_") || publicKey.length !== 75) {
    throw new Error(
      `Invalid signer public key format. Expected 'ed25519_pk_<64-hex-chars>', got: '${publicKey}'`,
    );
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
