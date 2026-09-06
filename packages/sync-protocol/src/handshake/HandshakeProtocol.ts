import { ValidationError } from "@platform/core";
import type { DevicePlatform } from "../types.js";

/**
 * Callback for verifying an Ed25519 signature over the canonical handshake payload.
 * Returns true if valid.
 */
export type HandshakeVerifyFn = (
  signerPublicKey: string,
  canonicalBytes: Uint8Array,
  signatureHex: string,
) => Promise<boolean>;

export interface HandshakeMessage {
  readonly applicationId: string;
  readonly applicationVersion: string;
  readonly protocolVersion: number;
  readonly deviceId: string;
  readonly organisationId: string;
  readonly platform: DevicePlatform;
  readonly supportedFeatures: readonly string[];
  readonly supportedEntityVersions: Readonly<Record<string, number>>;
  readonly timestamp: string; // ISO-8601 UTC
  /**
   * 32-character lowercase hex nonce (16 random bytes).
   * MUST be unique per handshake; replayed nonces are rejected.
   */
  readonly nonce: string;
  /**
   * Canonical `ed25519_pk_<64-hex-chars>` of the sending device.
   * Used to verify the handshake signature.
   */
  readonly signerPublicKey: string;
  /**
   * Hex-encoded 64-byte Ed25519 signature (128 lowercase hex chars).
   * Covers the canonical serialization of all other fields (sorted keys, no `signature` field).
   */
  readonly signature: string;
}

export interface HandshakeValidationOptions {
  expectedApplicationId: string;
  expectedOrganisationId: string;
  minimumProtocolVersion: number;
  currentProtocolVersion: number;
  /**
   * Maximum tolerated clock skew in milliseconds.
   * Defaults to 30 000 ms (30 seconds).
   */
  maxTimestampSkewMs?: number | undefined;
  /**
   * Set of nonces already seen in this session. Updated in-place on success.
   * If omitted, replay protection is skipped (only appropriate for tests).
   */
  seenNonces?: Set<string> | undefined;
  /**
   * Signature verification callback. If omitted, signature verification is skipped.
   * Must be provided in production contexts.
   */
  verifyFn?: HandshakeVerifyFn | undefined;
}

export interface HandshakeValidationResult {
  valid: boolean;
  code?:
    | "APP_ID_MISMATCH"
    | "ORG_ID_MISMATCH"
    | "PROTOCOL_INCOMPATIBLE"
    | "TIMESTAMP_SKEW"
    | "NONCE_REPLAYED"
    | "NONCE_INVALID"
    | "SIGNATURE_INVALID"
    | "PUBLIC_KEY_INVALID"
    | "INVALID_PAYLOAD";
  reason?: string;
}

export class HandshakeValidator {
  /**
   * Validates an incoming peer handshake against local platform constraints.
   * All checks are independent; the first failing check short-circuits.
   *
   * Validation order:
   * 1. Payload shape
   * 2. Application ID
   * 3. Organisation ID
   * 4. Protocol version
   * 5. Timestamp skew (if `maxTimestampSkewMs` is configured)
   * 6. Nonce uniqueness (if `seenNonces` is configured)
   * 7. Public key format
   * 8. Signature format
   * (Cryptographic signature verification is performed asynchronously by requireValid)
   */
  static validate(
    message: HandshakeMessage,
    options: HandshakeValidationOptions,
  ): HandshakeValidationResult {
    if (!message || typeof message !== "object") {
      return {
        valid: false,
        code: "INVALID_PAYLOAD",
        reason: "Handshake message is malformed or missing",
      };
    }

    // 1. Verify Application ID
    if (message.applicationId !== options.expectedApplicationId) {
      return {
        valid: false,
        code: "APP_ID_MISMATCH",
        reason: `Application ID mismatch: expected '${options.expectedApplicationId}', received '${message.applicationId}'`,
      };
    }

    // 2. Verify Organisation ID
    if (message.organisationId !== options.expectedOrganisationId) {
      return {
        valid: false,
        code: "ORG_ID_MISMATCH",
        reason: `Organisation ID mismatch: expected '${options.expectedOrganisationId}', received '${message.organisationId}'`,
      };
    }

    // 3. Verify Protocol Version
    if (message.protocolVersion < options.minimumProtocolVersion) {
      return {
        valid: false,
        code: "PROTOCOL_INCOMPATIBLE",
        reason: `Protocol version ${message.protocolVersion} is below minimum supported version ${options.minimumProtocolVersion}`,
      };
    }

    // 4. Timestamp skew check
    const maxSkewMs = options.maxTimestampSkewMs ?? 30_000;
    const msgTs = Date.parse(message.timestamp);
    if (isNaN(msgTs)) {
      return {
        valid: false,
        code: "TIMESTAMP_SKEW",
        reason: `Handshake timestamp is not a valid ISO-8601 date: '${message.timestamp}'`,
      };
    }
    const skewMs = Math.abs(Date.now() - msgTs);
    if (skewMs > maxSkewMs) {
      return {
        valid: false,
        code: "TIMESTAMP_SKEW",
        reason: `Handshake timestamp skew of ${skewMs}ms exceeds maximum allowed ${maxSkewMs}ms`,
      };
    }

    // 5. Nonce format — must be 32 lowercase hex chars (16 bytes)
    if (!/^[0-9a-f]{32}$/.test(message.nonce)) {
      return {
        valid: false,
        code: "NONCE_INVALID",
        reason: `Nonce must be a 32-character lowercase hex string, got: '${message.nonce}'`,
      };
    }

    // 6. Nonce replay check
    if (options.seenNonces !== undefined) {
      if (options.seenNonces.has(message.nonce)) {
        return {
          valid: false,
          code: "NONCE_REPLAYED",
          reason: `Nonce '${message.nonce}' has already been seen — possible replay attack`,
        };
      }
    }

    // 7. Public key format
    if (
      !message.signerPublicKey.startsWith("ed25519_pk_") ||
      message.signerPublicKey.length !== 75
    ) {
      return {
        valid: false,
        code: "PUBLIC_KEY_INVALID",
        reason: `signerPublicKey must be 'ed25519_pk_<64-hex-chars>' (75 chars), got length ${message.signerPublicKey.length}`,
      };
    }

    // 8. Signature format — must be 128 lowercase hex chars (64 bytes)
    if (!/^[0-9a-f]{128}$/.test(message.signature)) {
      return {
        valid: false,
        code: "SIGNATURE_INVALID",
        reason: `signature must be a 128-character lowercase hex string (64 bytes), got length ${message.signature.length}`,
      };
    }

    return { valid: true };
  }

  /**
   * Validates synchronous checks then verifies the Ed25519 signature asynchronously.
   * Throws a ValidationError on any failure.
   *
   * On success, records the nonce in `options.seenNonces` (if provided) to
   * prevent future replay of the same nonce.
   */
  static async requireValid(
    message: HandshakeMessage,
    options: HandshakeValidationOptions,
    correlationId: string,
  ): Promise<void> {
    const result = this.validate(message, options);
    if (!result.valid) {
      throw new ValidationError({
        message: `Handshake verification failed: ${result.reason} (${result.code})`,
        userMessage:
          "Peer handshake rejected due to compatibility or security constraints",
        correlationId,
      });
    }

    // Cryptographic signature verification (async)
    if (options.verifyFn) {
      const canonicalBytes = canonicalizeHandshake(message);
      const sigValid = await options.verifyFn(
        message.signerPublicKey,
        canonicalBytes,
        message.signature,
      );
      if (!sigValid) {
        throw new ValidationError({
          message: `Handshake signature verification failed for device '${message.deviceId}': cryptographic signature is invalid`,
          userMessage:
            "Peer handshake rejected: cryptographic signature is invalid",
          correlationId,
        });
      }
    }

    // Record nonce after all checks pass
    if (options.seenNonces !== undefined) {
      options.seenNonces.add(message.nonce);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produces the canonical UTF-8 bytes of a HandshakeMessage for signing and
 * verification. All fields are included EXCEPT `signature`, and keys are
 * sorted alphabetically at every level.
 */
export function canonicalizeHandshake(message: HandshakeMessage): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _sig, ...rest } = message;
  const canonical = JSON.stringify(sortedKeys(rest));
  return new TextEncoder().encode(canonical);
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
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
